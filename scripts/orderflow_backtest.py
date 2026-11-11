"""Historical study of taker-flow imbalance on Binance BTCUSDT (read-only).

The repo akenshaw/btcusdt-orderflow only visualises order flow; this script
tests the tradable half of the idea. Historical L2 depth is not available for
free, so book imbalance can only be forward-tested (see orderflow_live.py).
Taker flow is available in klines, so it is evaluated here: predictive
correlation, flow deciles and a fee-aware momentum/contrarian simulation.

Binance futures (fapi.binance.com) is geo-blocked from this location, so spot
klines are fetched from the public data mirror (data-api.binance.vision).
Spot taker flow is used as a proxy for perp flow. No API keys, no orders.

Usage:
    python scripts/orderflow_backtest.py
    python scripts/orderflow_backtest.py --interval 5m --days 180 --hold 6
    python scripts/orderflow_backtest.py --symbol ETHUSDT --mode contrarian
"""

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from orderflow_core import (
    TAKER_FEE_BPS,
    bucket_stats,
    flow_correlation,
    flows_from_bars,
    parse_kline,
    simulate,
    summarize,
    thresholds,
)

BASE = "https://data-api.binance.vision/api/v3/klines"
HORIZONS = {"1m": (1, 3, 5, 15, 30), "5m": (1, 3, 6, 12, 24),
            "15m": (1, 2, 4, 8, 16)}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Studi trade-flow imbalance BTCUSDT (read-only, tanpa order)")
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--interval", choices=sorted(HORIZONS), default="1m")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--hold", type=int, default=None,
                        help="bar tahan posisi (default: 5 untuk 1m, 6 untuk 5m, 4 untuk 15m)")
    parser.add_argument("--q", type=float, default=0.95,
                        help="kuantil ekstrem flow untuk entry (default 0.95)")
    parser.add_argument("--mode", choices=("momentum", "contrarian", "both"),
                        default="both")
    return parser.parse_args()


def fetch_klines(symbol, interval, days):
    end = int(time.time() * 1000)
    start = end - days * 86400 * 1000
    rows = []
    while True:
        url = f"{BASE}?symbol={symbol}&interval={interval}&limit=1000&endTime={end}"
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            batch = json.load(urllib.request.urlopen(request, timeout=20))
        except urllib.error.HTTPError as exc:
            raise SystemExit(
                f"Binance data API menolak ({exc.code}). Coba lagi / ganti jaringan.")
        except Exception as exc:
            raise SystemExit(f"Gagal mengambil klines: {exc}")
        if not batch:
            break
        batch = [row for row in batch if row[0] >= start]
        if not batch:
            break
        rows = batch + rows
        if batch[0][0] <= start:
            break
        end = batch[0][0] - 1
        time.sleep(0.05)
    return rows


def fmt(value, digits=2):
    return f"{value:+.{digits}f}"


def main():
    args = parse_args()
    hold = args.hold or {"1m": 5, "5m": 6, "15m": 4}[args.interval]
    raw = fetch_klines(args.symbol, args.interval, args.days)
    if len(raw) < 100:
        raise SystemExit("Data terlalu sedikit untuk dianalisis.")
    bars = [parse_kline(row) for row in raw]
    flows = flows_from_bars(bars)
    first = datetime.fromtimestamp(bars[0]["t"] / 1000, timezone.utc)
    last = datetime.fromtimestamp(bars[-1]["t"] / 1000, timezone.utc)
    valid = [f for f in flows if f is not None]
    mean_flow = sum(valid) / len(valid)
    sd = (sum((f - mean_flow) ** 2 for f in valid) / len(valid)) ** 0.5

    print("\n== ORDER-FLOW IMBALANCE ==")
    print(f"Data     : {args.symbol} {args.interval} | {len(bars)} bar | "
          f"{first:%Y-%m-%d} .. {last:%Y-%m-%d} UTC")
    print(f"Sumber   : Binance spot (data-api.binance.vision); flow taker buy/sell")
    print(f"TFI      : mean {mean_flow:+.4f} | sd {sd:.4f} | "
          f"|TFI|>0.5 pada {sum(1 for f in valid if abs(f) > 0.5) / len(valid):.1%} bar")
    print("Catatan  : depth L2 historis tidak tersedia gratis; book imbalance "
          "hanya bisa diuji live (orderflow_live.py).")

    print("\n-- Korelasi TFI vs return ke depan --")
    print(f"  {'horizon':>8}{'corr':>9}{'n':>8}")
    for horizon in HORIZONS[args.interval]:
        corr, n = flow_correlation(bars, flows, horizon)
        print(f"  {horizon:>7}b{corr:>+9.3f}{n:>8}")

    print(f"\n-- Desil TFI -> rata-rata return {args.interval} x{hold} --")
    print(f"  {'D':>3}{'TFI low':>10}{'TFI high':>10}{'ret bps':>10}")
    for row in bucket_stats(bars, flows, hold, buckets=10):
        print(f"  {row['bucket']:>3}{row['flow_low']:>+10.3f}"
              f"{row['flow_high']:>+10.3f}{row['mean_ret']:>+10.2f}")

    bounds = thresholds(flows, args.q)
    if bounds is None:
        raise SystemExit("Sampel flow tidak cukup untuk ambang kuantil.")
    low, high = bounds
    print(f"\n-- Simulasi ekstrem (q={args.q:g}: entry TFI <= {low:+.3f} / >= {high:+.3f}, "
          f"hold {hold} bar, entry open bar berikutnya) --")
    modes = ("momentum", "contrarian") if args.mode == "both" else (args.mode,)
    print(f"  {'mode':<11}{'fee/side':>9}{'trade':>7}{'winrate':>9}"
          f"{'gross':>9}{'net':>9}{'total':>10}{'PF':>7}{'maxDD':>9}")
    for mode in modes:
        for label, fee in TAKER_FEE_BPS.items():
            trades = simulate(bars, flows, low, high, hold=hold,
                              fee_bps=fee, mode=mode)
            stats = summarize(trades)
            pf = "inf" if stats["profit_factor"] is None else f"{stats['profit_factor']:.2f}"
            print(f"  {mode:<11}{label:>9}{stats['trades']:>7}"
                  f"{stats['winrate']:>8.1%}{fmt(stats['avg_gross']):>9}"
                  f"{fmt(stats['avg_net']):>9}{fmt(stats['total_net'], 0):>10}"
                  f"{pf:>7}{stats['max_dd']:>9.1f}")

    print("\nKesimpulan cepat: sinyal dianggap layak hanya bila edge gross/bar "
          "konsisten melebihi 2 x fee taker. Winrate rendah di atas normal karena "
          "PnL bersih dihitung setelah biaya.")


if __name__ == "__main__":
    main()
