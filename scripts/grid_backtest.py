"""Historical backtest of the breakout-grid executor (read-only, no orders).

Fetches M1/M5 bars from the connected MT5 terminal, replays the same grid /
SL / TP / BE / session / news rules as scripts/mt5_grid_hft.py and reports
winrate, expectancy and an FOMC-day breakdown.

Usage:
    python scripts/grid_backtest.py
    python scripts/grid_backtest.py --timeframe M5
    python scripts/grid_backtest.py --no-news
    python scripts/grid_backtest.py --spread-pips 1.2 --csv bridge/backtest_trades.csv
"""

import argparse
import csv
import json
import time
from datetime import datetime, timedelta, timezone

import MetaTrader5 as mt5

from backtest_core import (
    europe_is_dst,
    server_epoch_to_utc,
    simulate,
    subset_by_dates,
    summarize,
    summarize_by_pair,
)
from grid_core import pip_size
from mt5_bridge import BASE_DIR, PAIR_SYMBOLS, parse_dt, resolve_symbol

DEFAULT_PAIRS = ("EUR/USD", "GBP/USD", "USD/JPY")
TIMEFRAMES = {"M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
              "M15": mt5.TIMEFRAME_M15}
# Fed decisions 2026 (14:00 ET): 18:00 UTC during EDT, 19:00 UTC during EST.
FOMC_2026 = [("2026-01-28", 19), ("2026-03-18", 18), ("2026-04-29", 18),
             ("2026-06-17", 18), ("2026-07-29", 18), ("2026-09-16", 18),
             ("2026-10-28", 18), ("2026-12-09", 19)]
FOMC_DATES = {day for day, _hour in FOMC_2026}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Backtest historis grid HFT (read-only, tidak mengirim order)")
    parser.add_argument("--pairs", default=",".join(DEFAULT_PAIRS))
    parser.add_argument("--timeframe", choices=sorted(TIMEFRAMES), default="M1")
    parser.add_argument("--bars", type=int, default=50000,
                        help="jumlah bar per pair yang diambil (default 50000)")
    parser.add_argument("--spread-pips", type=float, default=0.8,
                        help="spread tetap dalam pips (default 0.8)")
    parser.add_argument("--balance", type=float, default=1000.0,
                        help="saldo awal virtual (default 1000)")
    parser.add_argument("--lot", type=float, default=0.01)
    parser.add_argument("--grid-pips", type=float, default=15.0)
    parser.add_argument("--sl-pips", type=float, default=15.0)
    parser.add_argument("--tp-pips", type=float, default=30.0)
    parser.add_argument("--scale-out", action="store_true",
                        help="tutup sebagian di TP1, SL ke BE, sisa ke TP2")
    parser.add_argument("--tp1-pips", type=float, default=None,
                        help="jarak TP1 dalam pips (default = --sl-pips)")
    parser.add_argument("--tp1-fraction", type=float, default=0.5,
                        help="porsi posisi yang ditutup di TP1 (default 0.5)")
    parser.add_argument("--be-buffer-pips", type=float, default=2.0)
    parser.add_argument("--chase-pips", type=float, default=3.0)
    parser.add_argument("--max-spread-pips", type=float, default=1.5)
    parser.add_argument("--ema-period", type=int, default=20)
    parser.add_argument("--max-open", type=int, default=3)
    parser.add_argument("--max-trades-per-day", type=int, default=10)
    parser.add_argument("--max-daily-loss", type=float, default=5.0)
    parser.add_argument("--cooldown", type=int, default=120)
    parser.add_argument("--friday-close-hour", type=int, default=16)
    parser.add_argument("--confirm-bars", type=int, default=2,
                        help="bar konfirmasi breakout (live=2 poll 1 detik)")
    parser.add_argument("--no-news", action="store_true",
                        help="matikan filter blackout & volatilitas news")
    parser.add_argument("--news", default=str(BASE_DIR / "data" / "calendar.json"))
    parser.add_argument("--server-offset", type=float, default=None,
                        help="offset jam server (default: deteksi DST Eropa +2/+3)")
    parser.add_argument("--path", default=None, help="path terminal MT5 opsional")
    parser.add_argument("--csv", default=None, help="simpan daftar trade ke file CSV")
    return parser.parse_args()


def load_news(path):
    events = []
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except Exception as exc:
        print(f"news: gagal membaca {path}: {exc}", flush=True)
        raw = []
    if isinstance(raw, dict):
        raw = raw.get("events", [])
    for ev in raw or []:
        moment = parse_dt(ev.get("Date"))
        if moment is None:
            continue
        events.append({
            "dt": moment.astimezone(timezone.utc),
            "importance": int(ev.get("Importance") or 0),
            "currency": str(ev.get("Country") or "").upper(),
            "name": ev.get("Event") or "news",
        })
    for day, hour in FOMC_2026:
        year, month, dom = (int(part) for part in day.split("-"))
        decision = datetime(year, month, dom, hour, 0, tzinfo=timezone.utc)
        events.append({"dt": decision, "importance": 3, "currency": "USD",
                       "name": "FOMC Statement"})
        events.append({"dt": decision + timedelta(minutes=30), "importance": 3,
                       "currency": "USD", "name": "FOMC Press Conference"})
    events.sort(key=lambda ev: ev["dt"])
    return events


def fetch_rates(pair, base, timeframe, count, offset):
    name = resolve_symbol(base)
    if not name:
        return None
    info = mt5.symbol_info(name)
    if info is None:
        mt5.symbol_select(name, True)
        info = mt5.symbol_info(name)
    if info is None:
        return None
    rates = mt5.copy_rates_from_pos(name, timeframe, 0, count)
    if rates is None or len(rates) < 100:
        return None
    by_time = {}
    for row in rates:
        by_time[server_epoch_to_utc(int(row["time"]), offset)] = {
            "o": float(row["open"]), "h": float(row["high"]),
            "l": float(row["low"]), "c": float(row["close"]),
        }
    stamps = sorted(by_time)
    stamps = stamps[:-1]  # last bar may still be forming
    bars = [{"t": t, **by_time[t]} for t in stamps]
    return {"symbol": name, "bars": bars, "info": info}


def print_money(value):
    return f"{value:+.2f}"


def print_pf(value):
    return "inf" if value is None else f"{value:.2f}"


def print_summary(label, stats, indent="  "):
    status = stats["status"]
    print(f"{indent}{label}: trade={stats['trades']} "
          f"(TP {status['TP']} / SL {status['SL']} / BE {status['BE']}) | "
          f"winrate={stats['winrate']:.1f}% | TP-rate={stats['tp_rate']:.1f}%")
    if stats.get("partial"):
        print(f"{indent}TP1 tercapai: {stats['partial']} "
              f"({stats['partial_rate']:.1f}%) | sisa ditutup di BE/TP2")
    print(f"{indent}PnL=${print_money(stats['pnl'])} | "
          f"expectancy=${print_money(stats['expectancy'])}/trade | "
          f"PF={print_pf(stats['profit_factor'])} | "
          f"max DD=${stats['max_drawdown']:.2f}")


def write_csv(path, trades):
    fields = ["pair", "dir", "opened_at", "closed_at", "entry", "exit", "sl", "tp",
              "level", "status", "pnl", "factor", "opened_date", "closed_date"]
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for trade in trades:
            row = dict(trade)
            row["pnl"] = round(float(trade["pnl"]), 2)
            for key in ("entry", "exit", "sl", "tp", "level"):
                row[key] = round(float(trade[key]), 5)
            writer.writerow(row)
    print(f"CSV trade: {path}", flush=True)


def main():
    args = parse_args()
    pairs = [p.strip() for p in args.pairs.split(",") if p.strip()]
    unknown = [p for p in pairs if p not in PAIR_SYMBOLS]
    if unknown:
        raise SystemExit(f"Pair tidak dikenal: {', '.join(unknown)}")

    if not mt5.initialize(**({"path": args.path} if args.path else {})):
        raise SystemExit(f"MT5 initialize gagal: {mt5.last_error()}")
    timeframe = TIMEFRAMES[args.timeframe]
    try:
        now = datetime.now(timezone.utc)
        symbols = [resolve_symbol(PAIR_SYMBOLS[p]) for p in pairs]
        tick = mt5.symbol_info_tick(next((s for s in symbols if s), ""))
        if tick and tick.time and args.server_offset is None:
            drift = (int(tick.time) - time.time()) / 3600.0
            if abs(drift) < 4:
                expected = 3 if europe_is_dst(now) else 2
                if abs(drift - expected) > 0.5:
                    print(f"PERINGATAN: offset server {drift:+.1f} jam, "
                          f"perkiraan DST Eropa {expected:+d}. Pakai --server-offset.",
                          flush=True)
        data = {}
        for pair in pairs:
            got = fetch_rates(pair, PAIR_SYMBOLS[pair], timeframe, args.bars,
                              args.server_offset)
            if got is None:
                print(f"{pair}: data {args.timeframe} tidak tersedia.", flush=True)
                continue
            data[pair] = got
    finally:
        mt5.shutdown()
    if not data:
        raise SystemExit("Tidak ada data untuk di-backtest.")

    cfg = {
        "pip": {}, "digits": {}, "contract": {}, "quote_ccy": {},
        "spread_pips": args.spread_pips, "lot": args.lot,
        "max_spread_pips": args.max_spread_pips,
        "grid_pips": args.grid_pips, "sl_pips": args.sl_pips,
        "tp_pips": args.tp_pips, "be_buffer_pips": args.be_buffer_pips,
        "scale_out": args.scale_out,
        "tp1_pips": args.tp1_pips if args.tp1_pips is not None else args.sl_pips,
        "tp1_fraction": args.tp1_fraction,
        "chase_pips": args.chase_pips, "ema_period": args.ema_period,
        "max_open": args.max_open, "max_trades_day": args.max_trades_per_day,
        "max_loss": args.max_daily_loss, "cooldown": args.cooldown,
        "friday_close_hour": args.friday_close_hour, "ignore_session": False,
        "balance": args.balance, "confirm_bars": args.confirm_bars,
        "news": [] if args.no_news else load_news(args.news),
        "use_news": not args.no_news, "news_window": 30,
        "vol_factor": 1.5, "vol_window": 60, "fomc_dates": FOMC_DATES,
    }
    for pair, got in data.items():
        info = got["info"]
        cfg["pip"][pair] = pip_size(info.digits, info.point)
        cfg["digits"][pair] = int(info.digits)
        cfg["contract"][pair] = float(info.trade_contract_size)
        cfg["quote_ccy"][pair] = str(info.currency_profit or "USD").upper()

    bars_by_pair = {pair: got["bars"] for pair, got in data.items()}
    result = simulate(bars_by_pair, cfg)
    trades = result["trades"]
    stats = summarize(trades)
    per_pair = summarize_by_pair(trades)
    first = min(bars[0]["t"] for bars in bars_by_pair.values())
    last = max(bars[-1]["t"] for bars in bars_by_pair.values())
    first_dt = datetime.fromtimestamp(first, timezone.utc)
    last_dt = datetime.fromtimestamp(last, timezone.utc)
    span = (last_dt.date() - first_dt.date()).days + 1

    print("\n== BACKTEST GRID-HFT ==", flush=True)
    print(f"Data      : {args.timeframe} | {span} hari | "
          f"{first_dt:%Y-%m-%d %H:%M} .. {last_dt:%Y-%m-%d %H:%M} UTC | "
          f"{min(len(b) for b in bars_by_pair.values())}-{max(len(b) for b in bars_by_pair.values())} bar/pair")
    print(f"Pair      : {', '.join(data)}")
    print(f"Setelan   : grid {args.grid_pips:g}p | SL {args.sl_pips:g}p | "
          f"TP {args.tp_pips:g}p | BE +{args.sl_pips:g}p | lot {args.lot:g} | "
          f"max {args.max_open} open | {args.max_trades_per_day} trade/hari | "
          f"rugi max ${args.max_daily_loss:g}/hari")
    if args.scale_out:
        tp1 = args.tp1_pips if args.tp1_pips is not None else args.sl_pips
        print(f"Scale-out : TP1 {tp1:g}p x{args.tp1_fraction:.0%} -> SL BE -> "
              f"sisa TP {args.tp_pips:g}p")
    print(f"Asumsi    : spread tetap {args.spread_pips:g} pips | entry di close bar | "
          f"SL didahulukan bila SL & TP kena di bar yang sama | "
          f"SL BE aktif mulai bar berikutnya | tanpa swap/komisi/slippage")
    news_txt = "nonaktif (--no-news)" if args.no_news else (
        f"aktif (blackout +-30 mnt, vol x1.5 60 mnt) dari {args.news}")
    print(f"News      : {news_txt}")
    if not args.no_news:
        print("            kalender lokal hanya mencakup 2026-10-27..30; "
              "sebelumnya hanya jadwal FOMC yang dikenali")

    skips = result["skips"]
    active = ", ".join(f"{k}={v}" for k, v in skips.items() if v)
    print(f"Sinyal ditolak: {active or '-'}")

    print("\n-- Keseluruhan --")
    print_summary("total", stats)
    if stats["trades"]:
        print(f"  hari dengan trade={stats['days_with_trades']} | "
              f"hari terbaik=${print_money(stats['best_day'])} | "
              f"hari terburuk=${print_money(stats['worst_day'])}")
        print(f"  breakeven TP-rate (RR 1:2 sebelum biaya) > 33.3%")
    if result["open"]:
        floating = sum(pos["pnl"] for pos in result["open"])
        print(f"  posisi masih terbuka: {len(result['open'])} | floating ${print_money(floating)}")
    print(f"  saldo akhir virtual: ${result['final_balance']:.2f}")

    print("\n-- Per pair --")
    print(f"  {'Pair':<10}{'Trade':>6}{'TP':>5}{'SL':>5}{'BE':>5}"
          f"{'Winrate':>9}{'TP-rate':>9}{'PnL':>10}{'Exp/trade':>11}")
    for pair, pair_stats in per_pair.items():
        status = pair_stats["status"]
        print(f"  {pair:<10}{pair_stats['trades']:>6}{status['TP']:>5}"
              f"{status['SL']:>5}{status['BE']:>5}{pair_stats['winrate']:>8.1f}%"
              f"{pair_stats['tp_rate']:>8.1f}%{print_money(pair_stats['pnl']):>10}"
              f"{print_money(pair_stats['expectancy']):>11}")

    fomc_in_data = sorted(day for day in FOMC_DATES
                          if first_dt.strftime("%Y-%m-%d") <= day <= last_dt.strftime("%Y-%m-%d"))
    print("\n-- FOMC (hari keputusan Fed) --")
    if not fomc_in_data:
        print("  tidak ada hari FOMC dalam rentang data")
    else:
        print(f"  {'Tanggal':<12}{'Trade':>6}{'TP':>5}{'SL':>5}{'BE':>5}"
              f"{'PnL':>10}{'News blokir':>12}")
        for day in fomc_in_data:
            subset = subset_by_dates(trades, {day})
            day_stats = summarize(subset)
            status = day_stats["status"]
            blocked = result["news_blocked_by_date"].get(day, 0)
            print(f"  {day:<12}{day_stats['trades']:>6}{status['TP']:>5}"
                  f"{status['SL']:>5}{status['BE']:>5}"
                  f"{print_money(day_stats['pnl']):>10}{blocked:>12}")
        fomc_trades = subset_by_dates(trades, fomc_in_data)
        fomc_stats = summarize(fomc_trades)
        others = [t for t in trades if t["opened_date"] not in set(fomc_in_data)]
        print_summary("total FOMC", fomc_stats)
        print_summary("hari biasa", summarize(others))
        print("  catatan: sampel hari FOMC sangat kecil; keputusan Fed 18:00 UTC,")
        print("          blackout 17:30-19:00 UTC memblokir entry sore hari.")

    print("\nCatatan: backtest ini aproksimasi. Live memeriksa tiap detik; di sini "
          "konfirmasi dihitung per bar, jadi jumlah trade bisa berbeda.")
    if args.timeframe != "M1":
        print(f"         Timeframe {args.timeframe} lebih kasar dari polling 1 detik; "
              "pakai sebagai uji sensitivitas, bukan hasil utama.")
    if args.csv:
        if trades:
            write_csv(args.csv, trades)
        else:
            print("Tidak ada trade untuk ditulis ke CSV.")


if __name__ == "__main__":
    main()
