"""Run the repo's Asian-range sweep idea on MT5 M15 data (read-only).

The upstream repo (MrPotatoHead-Dev/Forex-trading-strategy-development) only
counts how often London sweeps both sides of the Asian range. This script
reproduces that statistic on the user's broker data and adds a conservative
fade test (entry after the second sweep, stop beyond the extreme, target the
range midpoint or opposite side). No orders are sent.

Usage:
    python scripts/session_sweep_backtest.py
    python scripts/session_sweep_backtest.py --pairs EUR/USD,GBP/USD
    python scripts/session_sweep_backtest.py --tp-mode opposite --sl-buffer-pips 5
"""

import argparse
from collections import Counter
from datetime import datetime, timezone

import MetaTrader5 as mt5

from grid_core import pip_size
from mt5_bridge import PAIR_SYMBOLS, resolve_symbol
from session_sweep_core import fade_result, find_events, hm, summarize

DEFAULT_PAIRS = ("EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD")
WEEKDAYS = ("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Uji ide session sweep dari repo Forex-trading-strategy-development")
    parser.add_argument("--pairs", default=",".join(DEFAULT_PAIRS))
    parser.add_argument("--bars", type=int, default=50000,
                        help="bar M15 per pair (default 50000 ~ 520 hari)")
    parser.add_argument("--asia-start", default="03:00",
                        help="awal range Asia, jam server (default 03:00)")
    parser.add_argument("--asia-end", default="07:00",
                        help="akhir range Asia / awal London (default 07:00)")
    parser.add_argument("--london-end", default="15:00",
                        help="akhir jendela London (default 15:00)")
    parser.add_argument("--spread-pips", type=float, default=None,
                        help="spread tetap; default pakai spread simbol saat ini")
    parser.add_argument("--sl-buffer-pips", type=float, default=3.0)
    parser.add_argument("--tp-mode", choices=("mid", "opposite"), default="mid")
    parser.add_argument("--min-forward-bars", type=int, default=4,
                        help="minimal bar tersisa setelah sweep (default 4)")
    parser.add_argument("--path", default=None, help="path terminal MT5 opsional")
    return parser.parse_args()


def fetch(pair, count):
    base = PAIR_SYMBOLS[pair]
    name = resolve_symbol(base)
    if not name:
        return None
    info = mt5.symbol_info(name)
    if info is None:
        mt5.symbol_select(name, True)
        info = mt5.symbol_info(name)
    if info is None:
        return None
    rates = mt5.copy_rates_from_pos(name, mt5.TIMEFRAME_M15, 0, count)
    if rates is None or len(rates) < 500:
        return None
    rows = {}
    for row in rates:
        stamp = int(row["time"])
        rows[stamp] = {
            "t": stamp,
            "dt": datetime.fromtimestamp(stamp, timezone.utc),
            "o": float(row["open"]), "h": float(row["high"]),
            "l": float(row["low"]), "c": float(row["close"]),
        }
    stamps = sorted(rows)[:-1]  # last bar may still be forming
    return {"name": name, "info": info, "bars": [rows[t] for t in stamps]}


def spread_of(info, pip, override):
    if override is not None:
        return override
    live = info.spread * info.point / pip
    return max(live, 0.5)


def print_stats(label, stats, indent="  "):
    status = stats["status"]
    pf = "inf" if stats["profit_factor"] is None else f"{stats['profit_factor']:.2f}"
    rr = stats["avg_rr"]
    rr_txt = f"RR={rr:.2f} | " if rr else ""
    print(f"{indent}{label:<10} trade={stats['trades']:>4} "
          f"(TP {status['TP']:>3} / SL {status['SL']:>3} / TIME {status['TIME']:>3}) | "
          f"winrate={stats['winrate']:>5.1f}% | {rr_txt}"
          f"avg={stats['avg_pips']:+.1f}p | "
          f"W/L={stats['avg_win']:+.1f}/{stats['avg_loss']:+.1f}p | "
          f"total={stats['total_pips']:+.1f}p | PF={pf} | maxDD={stats['max_drawdown']:.1f}p",
          flush=True)


def main():
    args = parse_args()
    pairs = [p.strip() for p in args.pairs.split(",") if p.strip()]
    unknown = [p for p in pairs if p not in PAIR_SYMBOLS]
    if unknown:
        raise SystemExit(f"Pair tidak dikenal: {', '.join(unknown)}")

    if not mt5.initialize(**({"path": args.path} if args.path else {})):
        raise SystemExit(f"MT5 initialize gagal: {mt5.last_error()}")
    try:
        data = {}
        for pair in pairs:
            got = fetch(pair, args.bars)
            if got is None:
                print(f"{pair}: data M15 tidak tersedia.", flush=True)
                continue
            data[pair] = got
    finally:
        mt5.shutdown()
    if not data:
        raise SystemExit("Tidak ada data untuk diuji.")

    asia_start = hm(args.asia_start)
    asia_end = hm(args.asia_end)
    london_end = hm(args.london_end)

    print("\n== SESSION SWEEP (port SeekAndDestroy) ==", flush=True)
    first = min(got["bars"][0]["dt"] for got in data.values())
    last = max(got["bars"][-1]["dt"] for got in data.values())
    print(f"Data      : M15 | {first:%Y-%m-%d} .. {last:%Y-%m-%d} UTC | "
          f"{min(len(g['bars']) for g in data.values())}-"
          f"{max(len(g['bars']) for g in data.values())} bar/pair", flush=True)
    print(f"Sesi      : Asia {args.asia_start}-{args.asia_end} server | "
          f"London {args.asia_end}-{args.london_end} server", flush=True)
    print(f"Aturan    : entry di close bar sweep kedua | SL extreme "
          f"{args.sl_buffer_pips:g}p | TP {args.tp_mode} | "
          f"min {args.min_forward_bars} bar | SL didahulukan di bar yang sama", flush=True)
    print("Asumsi    : spread saat ini (bisa di-override), tanpa komisi/swap/slippage;"
          " repo asli tidak punya entry/SL/TP/biaya", flush=True)

    pattern_rows = []
    raw_all = []
    trade_all = []
    events_by_pair = {}
    raw_by_pair = {}
    trades_by_pair = {}
    for pair, got in data.items():
        bars = got["bars"]
        pip = pip_size(got["info"].digits, got["info"].point)
        spread = spread_of(got["info"], pip, args.spread_pips)
        events = find_events(bars, asia_start, asia_end, london_end)
        raw = [res for res in (fade_result(bars, ev, pip, spread,
                                           tp_mode=None,
                                           min_forward_bars=args.min_forward_bars)
                               for ev in events) if res]
        trades = [res for res in (fade_result(bars, ev, pip, spread,
                                              args.sl_buffer_pips, args.tp_mode,
                                              args.min_forward_bars)
                                  for ev in events) if res]
        days = len({b["dt"].date() for b in bars})
        orders = Counter(ev["order"] for ev in events)
        pattern_rows.append({
            "pair": pair, "days": days, "events": len(events),
            "rate": len(events) / days * 100 if days else 0.0,
            "high_low": orders.get("high_low", 0),
            "low_high": orders.get("low_high", 0),
            "spread": spread, "skipped": len(events) - len(trades),
        })
        raw_all.extend(raw)
        trade_all.extend(trades)
        events_by_pair[pair] = events
        raw_by_pair[pair] = raw
        trades_by_pair[pair] = trades

    print("\n-- Pola: kedua sisi range Asia tersapu di London --", flush=True)
    print(f"  {'Pair':<10}{'Hari':>6}{'Event':>7}{'Rate':>8}"
          f"{'High->Low':>11}{'Low->High':>11}{'Spread':>8}{'Skip':>6}")
    for row in pattern_rows:
        print(f"  {row['pair']:<10}{row['days']:>6}{row['events']:>7}"
              f"{row['rate']:>7.1f}%{row['high_low']:>11}{row['low_high']:>11}"
              f"{row['spread']:>7.2f}p{row['skipped']:>6}")

    print("\n-- Fade: tahan sampai akhir London (tanpa SL/TP) --", flush=True)
    for pair in data:
        print_stats(pair, summarize(raw_by_pair[pair]))
    print_stats("TOTAL", summarize(raw_all))

    print(f"\n-- Fade: SL extreme+{args.sl_buffer_pips:g}p, TP {args.tp_mode} --", flush=True)
    for pair in data:
        print_stats(pair, summarize(trades_by_pair[pair]))
    print_stats("TOTAL", summarize(trade_all))

    print("\n-- Per arah (SL/TP) --", flush=True)
    for direction, label in (("long", "Long (sweep low kedua)"),
                             ("short", "Short (sweep high kedua)")):
        subset = [t for t in trade_all if t["direction"] == direction]
        print_stats(label, summarize(subset))

    print("\n-- Per hari (SL/TP, agregat semua pair) --", flush=True)
    print(f"  {'Hari':<7}{'Event':>7}{'Trade':>7}{'Winrate':>9}{'Total':>9}")
    counts = Counter(ev["date"].weekday()
                     for events in events_by_pair.values() for ev in events)
    for day in range(5):
        subset = [t for t in trade_all if t["date"].weekday() == day]
        stats = summarize(subset)
        print(f"  {WEEKDAYS[day]:<7}{counts.get(day, 0):>7}{stats['trades']:>7}"
              f"{stats['winrate']:>8.1f}%{stats['total_pips']:>+9.1f}")

    print("\nCatatan: hasil ini aproksimasi. Repo asli hanya menghitung pola; "
          "aturan entry/SL/TP di sini adalah interpretasi kita.", flush=True)
    print("         Timeframe M15 membatasi presisi; spread historis bisa lebih "
          "lebar dari spread saat ini.", flush=True)
    print("         Tidak ada order yang dikirim; backtest hanya membaca data.", flush=True)


if __name__ == "__main__":
    main()
