"""Headless order-flow sampler on OKX public WebSocket (read-only, no orders).

Adapts the metrics of akenshaw/btcusdt-orderflow to a machine without Binance
access: OKX `books` (400 levels) and `trades` replace the Binance depth /
aggTrade streams, the book imbalance is measured inside +-0.1% of mid (the same
band the upstream app filters), and taker flow uses a rolling trade window.

Every second it records mid, book imbalance, book skew and taker-flow
imbalance, then reports how each feature lines up with forward mid returns.
Short runs are indicative only -- use `--seconds 3600` or more for a real
forward test. Exits without sending anything: this is a market-data reader.

Usage:
    python scripts/orderflow_live.py --seconds 300
    python scripts/orderflow_live.py --inst ETH-USDT --seconds 600 --csv bridge/flow.csv
"""

import argparse
import asyncio
import csv
import json
import time

import websockets

from orderflow_core import book_imbalance, book_skew, correlation, taker_imbalance

URL = "wss://ws.okx.com:8443/ws/v5/public"
FORWARD = (1, 5, 15, 30)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Sampler order flow OKX (read-only, tanpa order)")
    parser.add_argument("--inst", default="BTC-USDT")
    parser.add_argument("--seconds", type=int, default=300)
    parser.add_argument("--band", type=float, default=0.001,
                        help="band sekitar mid untuk depth (default 0.1%%)")
    parser.add_argument("--trade-window", type=float, default=30.0,
                        help="jendela flow taker dalam detik (default 30)")
    parser.add_argument("--csv", default=None, help="simpan sampel per detik")
    return parser.parse_args()


def apply_book(books, data):
    for key, book in (("bids", books["bids"]), ("asks", books["asks"])):
        for level in data.get(key) or []:
            price, size = float(level[0]), float(level[1])
            if size == 0:
                book.pop(price, None)
            else:
                book[price] = size


def snapshot(books, trades, now, args):
    if not books["bids"] or not books["asks"]:
        return None
    bid, ask = max(books["bids"]), min(books["asks"])
    mid = (bid + ask) / 2.0
    low, high = mid * (1.0 - args.band), mid * (1.0 + args.band)
    bid_qty = sum(q for p, q in books["bids"].items() if p >= low)
    ask_qty = sum(q for p, q in books["asks"].items() if p <= high)
    cutoff = now - args.trade_window
    trades[:] = [trade for trade in trades if trade[0] >= cutoff]
    buy = sum(size for _, side, size in trades if side == "buy")
    sell = sum(size for _, side, size in trades if side == "sell")
    return {
        "ts": now, "mid": mid, "bid": bid, "ask": ask,
        "bq": bid_qty, "aq": ask_qty, "buy": buy, "sell": sell,
        "book_imb": book_imbalance(bid_qty, ask_qty),
        "book_skew": book_skew(bid_qty, ask_qty) or 0.0,
        "tfi": taker_imbalance(buy, sell),
    }


async def collect(args, rows):
    books = {"bids": {}, "asks": {}}
    trades = []
    started = time.time()
    last = started
    async with websockets.connect(URL, ping_interval=20) as ws:
        await ws.send(json.dumps({"op": "subscribe", "args": [
            {"channel": "books", "instId": args.inst},
            {"channel": "trades", "instId": args.inst}]}))
        while time.time() - started < args.seconds:
            try:
                message = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            except asyncio.TimeoutError:
                message = None
            channel = (message or {}).get("arg", {}).get("channel")
            data = (message or {}).get("data")
            if channel == "books" and data:
                for item in data:
                    apply_book(books, item)
            elif channel == "trades" and data:
                for item in data:
                    trades.append((float(item["ts"]) / 1000.0,
                                   item["side"], float(item["sz"])))
            now = time.time()
            if now - last >= 1.0:
                last = now
                row = snapshot(books, trades, now, args)
                if row:
                    rows.append(row)
                    print(f"{time.strftime('%H:%M:%S')} mid={row['mid']:.2f} "
                          f"imb={row['book_imb']:+.3f} skew={row['book_skew']:+.3f} "
                          f"tfi={row['tfi']:+.3f}", flush=True)
    try:
        await ws.send(json.dumps({"op": "unsubscribe", "args": [
            {"channel": "books", "instId": args.inst},
            {"channel": "trades", "instId": args.inst}]}))
    except Exception:
        pass


def report(rows, args):
    if len(rows) < 120:
        print(f"\nSampel hanya {len(rows)} detik; jalankan beberapa menit untuk statistik.")
        return
    print(f"\n== {args.inst} | {len(rows)} sampel detik ==")
    print(f"book_imb mean {sum(r['book_imb'] for r in rows) / len(rows):+.3f} | "
          f"tfi mean {sum(r['tfi'] for r in rows) / len(rows):+.3f}")
    features = {
        "book_imb": [row["book_imb"] for row in rows],
        "book_skew": [row["book_skew"] for row in rows],
        "tfi": [row["tfi"] for row in rows],
        # A persistent book bias does not predict direction; its change does.
        "d_imb": [None] + [rows[i]["book_imb"] - rows[i - 1]["book_imb"]
                           for i in range(1, len(rows))],
        "d_tfi": [None] + [rows[i]["tfi"] - rows[i - 1]["tfi"]
                           for i in range(1, len(rows))],
    }
    print(f"  {'fitur':<10}{'fwd':>6}{'corr':>9}{'n':>7}")
    for name, values in features.items():
        for horizon in FORWARD:
            pairs = []
            for i in range(len(rows) - horizon):
                if values[i] is None:
                    continue
                move = (rows[i + horizon]["mid"] - rows[i]["mid"]) / rows[i]["mid"]
                pairs.append((values[i], move * 10000.0))
            corr = "n/a" if len(pairs) < 30 else f"{correlation(pairs):+.3f}"
            print(f"  {name:<10}{horizon:>5}s{corr:>9}{len(pairs):>7}")
    print("Catatan: sampel pendek -> korelasi belum signifikan; ini uji kelayakan alat.")


def main():
    args = parse_args()
    rows = []
    asyncio.run(collect(args, rows))
    report(rows, args)
    if args.csv and rows:
        fields = ["ts", "mid", "bid", "ask", "bq", "aq", "buy", "sell",
                  "book_imb", "book_skew", "tfi"]
        with open(args.csv, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: round(row[key], 8) if isinstance(row[key], float)
                                 else row[key] for key in fields})
        print(f"CSV: {args.csv}")


if __name__ == "__main__":
    main()
