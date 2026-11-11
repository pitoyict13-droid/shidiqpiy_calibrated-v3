"""Read-only spot-vs-perpetual basis scanner (OKX public data).

A feasibility probe for the HTF-Nano-Tick cash-and-carry idea: it prints the
executable basis between an OKX spot pair and its USDT perpetual, nets out the
four taker fees, and flags an entry when the edge clears the thresholds.

GET requests only, no API key, no credentials, no order endpoints.
FBS MT5 has no futures leg, so this cannot run on the MT5 account.

Usage:
    python scripts/basis_scanner.py --once
    python scripts/basis_scanner.py --interval 5
    python scripts/basis_scanner.py --once --entry-bps 5 --min-net-bps 0
    python scripts/basis_scanner.py --once --ignore-fees --json
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from basis_core import (
    ENTRY_BPS,
    EXIT_BPS,
    FUT_FEE_BPS,
    LONG_FUT,
    LONG_SPOT,
    MAX_HOLDING_S,
    SPOT_FEE_BPS,
    PaperBook,
    entry_signal,
    round_trip_fee_bps,
    study,
)

BASE_URL = "https://www.okx.com/api/v5"
DEFAULT_UNDERLYINGS = ("BTC", "ETH", "SOL", "XRP", "DOGE")
SIGNAL_LABEL = {LONG_SPOT: "sell fut", LONG_FUT: "buy fut"}


def http_json(path, params, timeout=10):
    url = BASE_URL + path + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "basis-scanner/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    if payload.get("code") != "0":
        raise RuntimeError(payload.get("msg") or f"OKX code {payload.get('code')}")
    data = payload.get("data") or []
    return data[0] if data else None


def book(inst_id):
    row = http_json("/market/ticker", {"instId": inst_id})
    if row is None:
        raise RuntimeError(f"ticker {inst_id} kosong")
    return {"bid": float(row["bidPx"]), "ask": float(row["askPx"])}


def funding(inst_id):
    row = http_json("/public/funding-rate", {"instId": inst_id})
    if row is None:
        return None
    current = int(row["fundingTime"]) // 1000
    upcoming = int(row["nextFundingTime"]) // 1000
    return {"rate": float(row["fundingRate"]),
            "bps": float(row["fundingRate"]) * 10000.0,
            "interval_h": (upcoming - current) / 3600.0,
            "next": upcoming}


def scan_row(underlying, fee_bps, entry_bps, min_net_bps, with_funding):
    spot = book(f"{underlying}-USDT")
    fut = book(f"{underlying}-USDT-SWAP")
    state = study(spot["bid"], spot["ask"], fut["bid"], fut["ask"], fee_bps)
    if state is None:
        return {"underlying": underlying, "error": "book kosong/crossed"}
    signal = entry_signal(spot["bid"], spot["ask"], fut["bid"], fut["ask"],
                          entry_bps=entry_bps, fee_bps=fee_bps,
                          min_net_bps=min_net_bps)
    row = {"underlying": underlying, "spot": spot, "fut": fut,
           "reference": state["reference"], "sides": state["sides"],
           "best": state["best"], "signal": signal}
    if with_funding:
        try:
            row["funding"] = funding(f"{underlying}-USDT-SWAP")
        except Exception as exc:
            row["funding_error"] = str(exc)
    return row


def fmt_price(value):
    return f"{value:.6g}"


def fmt_bps(value):
    return f"{value:+7.2f}"


def print_table(rows, fee_bps, entry_bps, min_net_bps):
    header = (f"{'asset':<10}{'spot bid/ask':<24}{'swap bid/ask':<24}"
              f"{'sell fut':>9}{'buy fut':>9}{'best net':>10}"
              f"{'funding':>15}  signal")
    print(header, flush=True)
    print("-" * len(header), flush=True)
    for row in rows:
        if "error" in row:
            print(f"{row['underlying']:<10}gagal: {row['error']}", flush=True)
            continue
        spot, fut = row["spot"], row["fut"]
        sides = row["sides"]
        best = sides[row["best"]]
        fund = row.get("funding")
        fund_txt = (f"{fund['bps']:+5.2f}bp/{fund['interval_h']:g}h"
                    if fund else "-")
        signal = row["signal"]
        label = SIGNAL_LABEL[signal["side"]] if signal else "-"
        spot_txt = f"{fmt_price(spot['bid'])}/{fmt_price(spot['ask'])}"
        fut_txt = f"{fmt_price(fut['bid'])}/{fmt_price(fut['ask'])}"
        print(f"{row['underlying']:<10}"
              f"{spot_txt:<24}"
              f"{fut_txt:<24}"
              f"{fmt_bps(sides[LONG_SPOT]['bps']):>9}"
              f"{fmt_bps(sides[LONG_FUT]['bps']):>9}"
              f"{fmt_bps(best['net_bps']):>10}"
              f"{fund_txt:>15}  {label}", flush=True)
    print(f"biaya round trip {fee_bps:.1f} bps | entry >= {entry_bps:.1f} bps "
          f"| net >= {min_net_bps:.1f} bps | funding tidak dihitung di PnL",
          flush=True)


def print_json(rows, fee_bps, book=None, now=None):
    payload = {"ts": int(time.time()), "fee_bps": fee_bps, "rows": rows}
    if book is not None:
        payload["paper"] = {"positions": book.snapshot(now), "closed": book.closed}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


PAPER_FIELDS = ("closed_at", "opened_at", "key", "side", "qty", "notional_usd",
                "spot_entry", "fut_entry", "spot_exit", "fut_exit",
                "entry_basis_bps", "close_basis_bps", "min_close_bps",
                "held_s", "pnl_gross", "entry_fee_usd", "exit_fee_usd",
                "pnl_net", "reason")


def write_paper_trade(path, trade, quiet=False):
    new_file = not os.path.exists(path)
    row = {key: trade.get(key) for key in PAPER_FIELDS}
    for key in ("closed_at", "opened_at"):
        row[key] = datetime.fromtimestamp(trade[key], timezone.utc).isoformat(
            timespec="seconds")
    for key in ("qty", "notional_usd", "spot_entry", "fut_entry", "spot_exit",
                "fut_exit", "pnl_gross", "entry_fee_usd", "exit_fee_usd", "pnl_net"):
        row[key] = round(float(trade[key]), 8)
    for key in ("entry_basis_bps", "close_basis_bps", "min_close_bps", "held_s"):
        row[key] = round(float(trade[key]), 4)
    with open(path, "a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=PAPER_FIELDS)
        if new_file:
            writer.writeheader()
        writer.writerow(row)
    if not quiet:
        print(f"paper CSV: {path}", flush=True)


def print_paper(book, events, now):
    print("paper (virtual, tanpa order):", flush=True)
    for line in events:
        print(line, flush=True)
    holdings = book.snapshot(now)
    if holdings:
        parts = [f"{h['underlying']} {SIGNAL_LABEL[h['side']]} {h['age_s']:.0f}s "
                 f"(min close {h['min_close_bps']:+.2f} bps)" for h in holdings]
        print("  posisi: " + " | ".join(parts), flush=True)
    elif not events:
        print("  tidak ada posisi.", flush=True)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Scanner basis spot vs perpetual OKX (read-only, tanpa order)")
    parser.add_argument("--underlyings", default=",".join(DEFAULT_UNDERLYINGS),
                        help="daftar underlying, mis. BTC,ETH,SOL")
    parser.add_argument("--entry-bps", type=float, default=ENTRY_BPS,
                        help=f"ambang basis masuk (default {ENTRY_BPS:g} bps)")
    parser.add_argument("--spot-fee-bps", type=float, default=SPOT_FEE_BPS)
    parser.add_argument("--fut-fee-bps", type=float, default=FUT_FEE_BPS)
    parser.add_argument("--ignore-fees", action="store_true",
                        help="bandingkan dengan biaya 0 (sinyal mentah)")
    parser.add_argument("--min-net-bps", type=float, default=0.0,
                        help="net minimum setelah biaya (default 0)")
    parser.add_argument("--interval", type=float, default=5.0,
                        help="detik antar scan (default 5)")
    parser.add_argument("--once", action="store_true", help="satu kali scan lalu keluar")
    parser.add_argument("--no-funding", action="store_true",
                        help="lewati permintaan funding rate")
    parser.add_argument("--json", action="store_true", help="keluaran JSON per scan")
    parser.add_argument("--paper", action="store_true",
                        help="lacak posisi virtual (tanpa order, state di memori)")
    parser.add_argument("--paper-notional", type=float, default=1000.0,
                        help="notional virtual per posisi dalam USD (default 1000)")
    parser.add_argument("--holding-s", type=float, default=MAX_HOLDING_S,
                        help=f"batas waktu posisi virtual (default {MAX_HOLDING_S:g} s)")
    parser.add_argument("--exit-bps", type=float, default=EXIT_BPS,
                        help=f"ambang keluar posisi virtual (default {EXIT_BPS:g} bps)")
    parser.add_argument("--paper-csv", default=None,
                        help="append trade virtual yang selesai ke file CSV")
    return parser.parse_args()


def main():
    args = parse_args()
    underlyings = [u.strip().upper() for u in args.underlyings.split(",") if u.strip()]
    if not underlyings:
        raise SystemExit("Daftar underlying kosong.")
    fee_bps = 0.0 if args.ignore_fees else round_trip_fee_bps(
        args.spot_fee_bps, args.fut_fee_bps)
    paper = None
    if args.paper:
        spot_fee = 0.0 if args.ignore_fees else args.spot_fee_bps
        fut_fee = 0.0 if args.ignore_fees else args.fut_fee_bps
        paper = PaperBook(args.paper_notional, args.holding_s, args.exit_bps,
                          spot_fee, fut_fee)

    if not args.json:
        print("OKX spot vs USDT-perp | GET publik, tanpa API key, tanpa order",
              flush=True)
    while True:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        rows = []
        paper_lines = []
        for underlying in underlyings:
            try:
                row = scan_row(underlying, fee_bps, args.entry_bps,
                               args.min_net_bps, not args.no_funding)
            except Exception as exc:
                rows.append({"underlying": underlying,
                             "error": f"{type(exc).__name__}: {exc}"})
                continue
            rows.append(row)
            if paper is None:
                continue
            event = paper.update(underlying, row["signal"],
                                 row["spot"]["bid"], row["spot"]["ask"],
                                 row["fut"]["bid"], row["fut"]["ask"],
                                 time.time())
            if event is None:
                continue
            if event["action"] == "open":
                pos = event["position"]
                paper_lines.append(
                    f"  {underlying}: BUKA {SIGNAL_LABEL[pos['side']]} "
                    f"qty={pos['qty']:.6g} @ {pos['entry_basis_bps']:+.2f} bps")
            elif event["action"] == "close":
                trade = event["trade"]
                paper_lines.append(
                    f"  {underlying}: TUTUP {trade['reason']} "
                    f"{trade['held_s']:.0f}s | net ${trade['pnl_net']:+.2f} "
                    f"| basis {trade['entry_basis_bps']:+.1f} -> "
                    f"{trade['close_basis_bps']:+.1f} bps")
                if args.paper_csv:
                    write_paper_trade(args.paper_csv, trade, args.json)
        if args.json:
            print_json(rows, fee_bps, paper, time.time())
        else:
            print(f"\n[{stamp} UTC]", flush=True)
            print_table(rows, fee_bps, args.entry_bps, args.min_net_bps)
            if paper is not None:
                print_paper(paper, paper_lines, time.time())
        if args.once:
            return
        time.sleep(max(args.interval, 1.0))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nberhenti.", flush=True)
        sys.exit(0)
