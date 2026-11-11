"""Order-flow metrics ported from akenshaw/btcusdt-orderflow (visualiser only).

Upstream is a PyQt/PyQtGraph app: it maintains a Binance BTCUSDT book from the
100 ms depth diff stream, bins depth into $1 buckets, accumulates taker buys /
sells by price, and plots book skew, book imbalance, trade-size skew and volume
imbalance. It contains no entry rule, exit rule, fee model or backtest.

This module keeps the two quantities that can be computed from public data --
book imbalance inside a band around mid, and taker-flow imbalance -- and adds a
read-only evaluation harness: forward returns, decile buckets and a fee-aware
momentum/contrarian simulation. Pure functions: no network, no orders.
"""

TAKER_FEE_BPS = {"spot": 10.0, "futures": 5.0}
MODES = ("momentum", "contrarian")


def book_skew(bid_qty, ask_qty):
    """log(bid) - log(ask), the upstream `book_skew`."""
    if bid_qty <= 0 or ask_qty <= 0:
        return None
    from math import log
    return log(bid_qty) - log(ask_qty)


def book_imbalance(bid_qty, ask_qty):
    """(bid - ask) / (bid + ask), the upstream `book_imb`."""
    total = bid_qty + ask_qty
    return (bid_qty - ask_qty) / total if total > 0 else 0.0


def taker_imbalance(buy_vol, sell_vol):
    """(buy - sell) / (buy + sell); +1 all taker buys, -1 all taker sells."""
    total = buy_vol + sell_vol
    return (buy_vol - sell_vol) / total if total > 0 else 0.0


def flow_from_kline(volume, taker_buy_volume):
    """Binance klines expose taker buy base volume; sells are the remainder."""
    if volume <= 0:
        return None
    buy = min(max(taker_buy_volume, 0.0), volume)
    return taker_imbalance(buy, volume - buy)


def parse_kline(row):
    """Binance kline array -> bar dict (`taker_buy_volume` at index 9)."""
    return {
        "t": int(row[0]),
        "open": float(row[1]),
        "high": float(row[2]),
        "low": float(row[3]),
        "close": float(row[4]),
        "volume": float(row[5]),
        "trades": int(row[8]),
        "taker_buy_volume": float(row[9]),
    }


def flows_from_bars(bars):
    return [flow_from_kline(bar["volume"], bar["taker_buy_volume"]) for bar in bars]


def forward_return(bars, index, horizon):
    """Close-to-close return in bps over `horizon` bars, or None at the edge."""
    exit_index = index + horizon
    if index < 0 or exit_index >= len(bars):
        return None
    entry = bars[index]["close"]
    if entry <= 0:
        return None
    return (bars[exit_index]["close"] - entry) / entry * 10000.0


def correlation(pairs):
    if len(pairs) < 2:
        return 0.0
    xs = [a for a, _ in pairs]
    ys = [b for _, b in pairs]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    cov = sum((a - mx) * (b - my) for a, b in pairs) / len(pairs)
    vx = sum((a - mx) ** 2 for a in xs) / len(xs)
    vy = sum((b - my) ** 2 for b in ys) / len(ys)
    if vx <= 0 or vy <= 0:
        return 0.0
    return cov / (vx ** 0.5 * vy ** 0.5)


def flow_correlation(bars, flows, horizon):
    pairs = []
    for i, flow in enumerate(flows):
        if flow is None:
            continue
        ret = forward_return(bars, i, horizon)
        if ret is not None:
            pairs.append((flow, ret))
    return correlation(pairs), len(pairs)


def thresholds(flows, quantile=0.95):
    values = sorted(f for f in flows if f is not None)
    if len(values) < 20:
        return None
    quantile = min(max(quantile, 0.5), 0.999)
    high_index = min(int(round(len(values) * quantile)), len(values) - 1)
    low_index = max(int(round(len(values) * (1.0 - quantile))), 0)
    return values[low_index], values[high_index]


def bucket_stats(bars, flows, horizon, buckets=10):
    """Mean forward return per flow bucket, low to high."""
    pairs = [(f, forward_return(bars, i, horizon))
             for i, f in enumerate(flows) if f is not None]
    pairs = [(f, r) for f, r in pairs if r is not None]
    pairs.sort()
    size = len(pairs) // buckets
    if size < 1:
        return []
    out = []
    for b in range(buckets):
        seg = pairs[b * size:(b + 1) * size]
        out.append({
            "bucket": b,
            "flow_low": seg[0][0],
            "flow_high": seg[-1][0],
            "mean_ret": sum(r for _, r in seg) / len(seg),
            "n": len(seg),
        })
    return out


def simulate(bars, flows, low, high, hold=5, fee_bps=10.0,
             mode="momentum"):
    """Non-overlapping trades on extreme flow, entry at the next bar open.

    `low` / `high` are the extreme flow thresholds. A flow >= high goes long
    (momentum) or short (contrarian); <= low mirrored. Exit at the close of
    bar `i + hold`; each trade reserves `hold + 1` bars.
    """
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    trades = []
    i = 0
    while i + hold < len(bars):
        flow = flows[i]
        if flow is None:
            i += 1
            continue
        if flow >= high:
            side = 1
        elif flow <= low:
            side = -1
        else:
            i += 1
            continue
        if mode == "contrarian":
            side = -side
        entry = bars[i + 1]["open"]
        exit_price = bars[i + hold]["close"]
        if entry <= 0:
            i += 1
            continue
        gross = side * (exit_price - entry) / entry * 10000.0
        trades.append({
            "index": i,
            "side": side,
            "flow": flow,
            "entry": entry,
            "exit": exit_price,
            "gross_bps": gross,
            "net_bps": gross - 2.0 * fee_bps,
        })
        i += hold + 1
    return trades


def summarize(trades):
    n = len(trades)
    if n == 0:
        return {"trades": 0, "winrate": 0.0, "avg_gross": 0.0,
                "avg_net": 0.0, "total_net": 0.0, "profit_factor": 0.0,
                "max_dd": 0.0}
    wins = [t["net_bps"] for t in trades if t["net_bps"] > 0]
    losses = [t["net_bps"] for t in trades if t["net_bps"] <= 0]
    gross_profit = sum(wins)
    gross_loss = -sum(losses)
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for trade in trades:
        equity += trade["net_bps"]
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)
    return {
        "trades": n,
        "winrate": len(wins) / n,
        "avg_gross": sum(t["gross_bps"] for t in trades) / n,
        "avg_net": sum(t["net_bps"] for t in trades) / n,
        "total_net": sum(t["net_bps"] for t in trades),
        "profit_factor": (gross_profit / gross_loss) if gross_loss > 0 else None,
        "max_dd": max_dd,
    }
