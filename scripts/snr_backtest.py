"""Calibration backtest of the SnR LNY Pine indicator (read-only, no orders).

Fetches M15 / M30 / H1 / D1 bars from the connected MT5 terminal for the nine
PAIR_SYMBOLS, replays scripts/snr_core.py (faithful port of pineSnR.txt) for
presets C1 / C2 / C4 / C5 and reports winrate vs the TP/SL breakeven, Wilson
confidence interval, expectancy in R and expectancy after the current spread.

Usage:
    python scripts/snr_backtest.py
    python scripts/snr_backtest.py --pairs XAU/USD,EUR/USD --presets C1,C4
    python scripts/snr_backtest.py --start 2025-07-01 --no-news
"""

import argparse
import csv
import re
import statistics
from datetime import datetime

import MetaTrader5 as mt5

from backtest_core import server_epoch_to_utc
from mt5_bridge import BASE_DIR, PAIR_SYMBOLS, resolve_symbol
from snr_core import (ET, PRESETS, align_prev_atr, atr_series, build_asset,
                      build_events, ema_series, ms_flags, prepare, simulate,
                      summarize)

TF_FOR = {"C1": "M30", "C2": "M30", "C4": "M15", "C5": "H1"}
TF_MT5 = {"M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
          "H1": mt5.TIMEFRAME_H1, "D1": mt5.TIMEFRAME_D1}
TF_MIN = {"M15": 15, "M30": 30, "H1": 60}
COUNT = {"M15": 50000, "M30": 60000, "H1": 60000, "D1": 3000}
WARMUP_DAYS = 120


def parse_args():
    ap = argparse.ArgumentParser(description="Kalibrasi SnR LNY (read-only)")
    ap.add_argument("--pairs", default=",".join(PAIR_SYMBOLS))
    ap.add_argument("--presets", default="C1,C2,C4,C5")
    ap.add_argument("--start", default="2025-01-01", help="awal statistik (ET)")
    ap.add_argument("--grid-k", type=float, default=0.25)
    ap.add_argument("--hyst", type=float, default=25.0)
    ap.add_argument("--mkt-pct", type=float, default=2.0)
    ap.add_argument("--no-news", action="store_true")
    ap.add_argument("--tag", default="", help="akhiran nama file CSV (mis. _k020)")
    ap.add_argument("--path", default=None, help="path terminal MT5 (opsional)")
    return ap.parse_args()


def load_news_text():
    text = (BASE_DIR / "pineSnR.txt").read_text(encoding="utf-8")
    i = text.find("string BUILTIN")
    if i < 0:
        raise SystemExit("Kalender BUILTIN tidak ditemukan di pineSnR.txt")
    j = text.find("\n\n", i)
    seg = text[i:j if j > 0 else len(text)]
    return "\n".join(re.findall(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z]+", seg))


def fetch(symbol, tf, count):
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    if rates is None or len(rates) == 0:
        return []
    return [(server_epoch_to_utc(int(r["time"])), float(r["open"]), float(r["high"]),
             float(r["low"]), float(r["close"])) for r in rates]


def trim(bars, cutoff):
    return [b for b in bars if b[0] >= cutoff]


def pair_setup(pair):
    name = resolve_symbol(PAIR_SYMBOLS[pair])
    if not name:
        return None
    info = mt5.symbol_info(name)
    if info is None:
        return None
    if not info.visible:
        mt5.symbol_select(name, True)
        info = mt5.symbol_info(name)
    tick = mt5.symbol_info_tick(name)
    tick_size = float(getattr(info, "trade_tick_size", 0.0) or info.point)
    if tick and tick.bid and tick.ask:
        spread_px = float(tick.ask) - float(tick.bid)
    else:
        spread_px = float(info.spread) * float(info.point)
    return {"name": name, "tick": tick_size, "spread": abs(spread_px),
            "digits": int(info.digits)}


def fmt(x, w=8, d=2):
    return f"{x:>{w}.{d}f}"


def main():
    args = parse_args()
    pairs = [p.strip() for p in args.pairs.split(",") if p.strip()]
    preset_keys = [p.strip().upper() for p in args.presets.split(",") if p.strip()]
    unknown = [p for p in preset_keys if p not in PRESETS]
    if unknown:
        raise SystemExit(f"Preset tidak dikenal: {unknown}")
    start_ts = int(datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=ET).timestamp())
    cutoff = start_ts - WARMUP_DAYS * 86400

    kwargs = {"path": args.path} if args.path else {}
    if not mt5.initialize(**kwargs):
        raise SystemExit(f"MT5 initialize gagal: {mt5.last_error()}")
    acc = mt5.account_info()
    term = mt5.terminal_info()
    if acc is None or term is None:
        mt5.shutdown()
        raise SystemExit(f"Tidak bisa membaca akun/terminal: {mt5.last_error()}")
    mode = {0: "DEMO", 1: "CONTEST", 2: "REAL"}.get(acc.trade_mode, str(acc.trade_mode))
    print(f"SNR | {acc.company} | {acc.server} | {mode} | balance={acc.balance} "
          f"{acc.currency} | READ-ONLY (tidak ada order)", flush=True)

    news_text = load_news_text()
    events = build_events(news_text)
    print(f"Kalender news: {len(news_text.splitlines())} event, "
          f"{len(events)} hari dagang server", flush=True)
    print(f"Periode statistik: {args.start} ET s/d sekarang · grid-k={args.grid_k} "
          f"hyst={args.hyst:.0f}% mkt={args.mkt_pct:.1f}% "
          f"news={'OFF' if args.no_news else 'ON'}", flush=True)

    tfs_needed = sorted({TF_FOR[p] for p in preset_keys})
    rows = []
    all_trades = []

    header = ("pair      preset  n    WR%   CI95%          avgR   totR    PF    maxDD  "
              "TP   SL   JUMAT  beWR%  netR   grid_atr  verdict")
    print("\n" + header)
    print("-" * len(header))

    for pair in pairs:
        st = pair_setup(pair)
        if st is None:
            print(f"{pair:<9} -- simbol tidak ditemukan; dilewati")
            continue
        asset = build_asset(PAIR_SYMBOLS[pair], st["tick"])
        d1 = fetch(st["name"], TF_MT5["D1"], COUNT["D1"])
        d1_atr = atr_series(d1, 14) if d1 else []
        d1_times = [b[0] for b in d1]

        cache = {}
        for tf in tfs_needed:
            bars = trim(fetch(st["name"], TF_MT5[tf], COUNT[tf]), cutoff)
            if len(bars) < 200:
                cache[tf] = None
                continue
            tf_min = TF_MIN[tf]
            prep = prepare(bars, asset, tf_min)
            ema = ema_series([b[4] for b in bars], 50)
            bull, bear = ms_flags([b[2] for b in bars], [b[3] for b in bars], 5)
            atr_prev = align_prev_atr([b[0] for b in bars], d1_times, d1_atr)
            atr_ok = [a for a in atr_prev if a]
            cache[tf] = (bars, prep, ema, bull, bear, atr_prev,
                         statistics.median(atr_ok) if atr_ok else 0.0,
                         f"{datetime.fromtimestamp(bars[0][0], ET):%Y-%m-%d}")

        for key in preset_keys:
            preset = PRESETS[key]
            tf = TF_FOR[key]
            if cache.get(tf) is None:
                print(f"{pair:<9} {key:<6} data {tf} tidak cukup")
                continue
            bars, prep, ema, bull, bear, atr_prev, atr_med, first_day = cache[tf]
            res = simulate(pair, preset, asset, prep, atr_prev, ema, bull, bear,
                           events, start_ts, grid_k=args.grid_k, hyst_pct=args.hyst,
                           mkt_pct=args.mkt_pct, news_on=not args.no_news)
            trades = res["trades"]
            stats = summarize(trades, preset, spread_px=st["spread"])
            grid_med = statistics.median([t["grid_px"] for t in trades]) if trades else 0.0
            ratio = grid_med / atr_med if atr_med else 0.0

            n = stats["n"]
            if n < 20:
                verdict = "sampel<20"
            elif stats["net_total_r"] <= 0 or stats["pf"] <= 1.0:
                verdict = "tidak"
            elif stats["wr_lo"] > stats["be_wr"]:
                verdict = "PROFIT*"
            else:
                verdict = "marjinal"
            codes = stats["codes"]
            print(f"{pair:<9} {key:<6} {n:<4d} {stats['wr']*100:5.1f} "
                  f"[{stats['wr_lo']*100:4.1f},{stats['wr_hi']*100:5.1f}] "
                  f"{fmt(stats['avg_r'], 7, 3)} {fmt(stats['total_r'], 7)} "
                  f"{fmt(stats['pf'], 5, 2)} {fmt(stats['max_dd'], 6)} "
                  f"{codes['TP']:<4d} {codes['SL']:<4d} {codes['JUMAT']:<6d} "
                  f"{stats['be_wr']*100:5.1f} {fmt(stats['net_total_r'], 7)} "
                  f"{fmt(ratio, 7, 3)}  {verdict}", flush=True)

            row = {"pair": pair, "symbol": st["name"], "preset": key, "tf": tf,
                   "first_bar": first_day, "n": n, "wr": stats["wr"],
                   "wr_lo": stats["wr_lo"], "wr_hi": stats["wr_hi"],
                   "be_wr": stats["be_wr"], "avg_r": stats["avg_r"],
                   "total_r": stats["total_r"], "pf": stats["pf"],
                   "max_dd_r": stats["max_dd"], "tp": codes["TP"],
                   "sl": codes["SL"], "friday": codes["JUMAT"],
                   "spread_px": st["spread"], "spread_cost_r": stats["spread_cost_r"],
                   "net_total_r": stats["net_total_r"], "net_avg_r": stats["net_avg_r"],
                   "grid_median": grid_med, "atr_d1_median": atr_med,
                   "grid_atr": ratio, "verdict": verdict}
            rows.append(row)
            for t in trades:
                all_trades.append({
                    "pair": pair, "preset": key,
                    "fill": datetime.fromtimestamp(t["fill_t"], ET).strftime("%Y-%m-%d %H:%M"),
                    "exit": datetime.fromtimestamp(t["exit_t"], ET).strftime("%Y-%m-%d %H:%M"),
                    "dir": "BUY" if t["dir"] > 0 else "SELL", "code": t["code"],
                    "r": round(t["r"], 4), "fill_px": t["fill_px"],
                    "exit_px": t["exit_px"], "sl_dist": t["sl_dist"],
                    "grid_px": t["grid_px"],
                })
        print("-" * len(header), flush=True)

    outdir = BASE_DIR / "bridge" / "snr"
    outdir.mkdir(parents=True, exist_ok=True)
    summary_path = outdir / f"summary{args.tag}.csv"
    trades_path = outdir / f"trades{args.tag}.csv"
    if rows:
        with summary_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    if all_trades:
        with trades_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(all_trades[0].keys()))
            w.writeheader()
            w.writerows(all_trades)

    print("\nRingkasan per preset (semua pair):")
    for key in preset_keys:
        rs = [r for r in rows if r["preset"] == key]
        if not rs:
            continue
        n = sum(r["n"] for r in rs)
        wr = sum(r["wr"] * r["n"] for r in rs) / n if n else 0.0
        net = sum(r["net_total_r"] for r in rs)
        best = max(rs, key=lambda r: r["net_total_r"])
        print(f"  {key}: trades={n} WR={wr*100:.1f}% (BE {rs[0]['be_wr']*100:.1f}%) "
              f"netR={net:+.2f} · terbaik {best['pair']} {best['net_total_r']:+.2f}R")
    print(f"\nDitulis: {summary_path} dan {trades_path}")
    print("catatan: PROFIT* = batas bawah CI95 WR > breakeven, netR>0, PF>1, n>=20.")
    mt5.shutdown()


if __name__ == "__main__":
    main()
