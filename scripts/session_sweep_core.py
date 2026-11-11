"""Session sweep statistics and a conservative fade test.

Ported from MrPotatoHead-Dev/Forex-trading-strategy-development
(`SeekAndDestroy.ipynb`). The repo counts how often London takes both sides of
the Asian range, but has no entry, stop, target, cost model, or backtest, and
its Python script counts sweeps outside the London window (so `low to high`
comes out as zero). This module uses a corrected detector, one event per day,
and adds a fade test:

  - after the second sweep, trade against that sweep,
  - stop beyond the sweep extreme plus a buffer,
  - target the range midpoint or the opposite side,
  - resolve on the remaining London bars, stop first on the same bar.

Pure functions; no MetaTrader5 import.
"""


def minutes_of(dt):
    return dt.hour * 60 + dt.minute


def hm(text):
    hour, minute = str(text).split(":")
    return int(hour) * 60 + int(minute)


def find_events(bars, asia_start=180, asia_end=420, london_end=900):
    """One event per server day where both Asian extremes are taken.

    `bars` must be sorted by `dt` and carry `o/h/l/c` plus `dt`. Session bounds
    are minutes after midnight in server time (03:00 = 180, 07:00 = 420,
    15:00 = 900), matching the notebook.
    """
    events = []
    start = 0
    while start < len(bars):
        day = bars[start]["dt"].date()
        end = start
        while end < len(bars) and bars[end]["dt"].date() == day:
            end += 1
        event = _day_event(bars, start, end, asia_start, asia_end, london_end)
        if event:
            events.append(event)
        start = end
    return events


def _day_event(bars, lo, hi, asia_start, asia_end, london_end):
    range_idx = [i for i in range(lo, hi)
                 if asia_start <= minutes_of(bars[i]["dt"]) < asia_end]
    london_idx = [i for i in range(lo, hi)
                  if asia_end < minutes_of(bars[i]["dt"]) < london_end]
    if len(range_idx) < 2 or not london_idx:
        return None
    asia_high = max(bars[i]["h"] for i in range_idx)
    asia_low = min(bars[i]["l"] for i in range_idx)
    order = None
    first_time = None
    for i in london_idx:
        bar = bars[i]
        if order is None:
            if bar["h"] > asia_high:
                order, first_time = "high_low", bar["dt"]
            elif bar["l"] < asia_low:
                order, first_time = "low_high", bar["dt"]
            continue
        if order == "high_low" and bar["l"] < asia_low:
            second_extreme = bar["l"]
        elif order == "low_high" and bar["h"] > asia_high:
            second_extreme = bar["h"]
        else:
            continue
        return {"date": bars[lo]["dt"].date(), "order": order,
                "asia_high": asia_high, "asia_low": asia_low,
                "first_time": first_time, "second_time": bar["dt"],
                "second_extreme": second_extreme,
                "index": i, "day_end_index": london_idx[-1]}
    return None


def fade_result(bars, event, pip, spread_pips=0.8, sl_buffer_pips=3.0,
                tp_mode="mid", min_forward_bars=4):
    """Simulate the fade after the second sweep; None when unusable.

    tp_mode None holds to the London close without a stop or target. Entry is
    the close of the second-sweep bar at the executable side (ask for longs,
    bid for shorts); exits are at the opposite side, so the spread is paid.
    """
    first = event["index"]
    end = event["day_end_index"]
    if end - first < min_forward_bars:
        return None
    direction = "long" if event["order"] == "high_low" else "short"
    half = spread_pips * pip / 2.0
    entry_mid = bars[first]["c"]
    entry = entry_mid + half if direction == "long" else entry_mid - half
    sl = tp = None
    if tp_mode is not None:
        target = ((event["asia_high"] + event["asia_low"]) / 2.0
                  if tp_mode == "mid" else
                  (event["asia_high"] if direction == "long" else event["asia_low"]))
        if direction == "long":
            sl = event["second_extreme"] - sl_buffer_pips * pip
            tp = target
            if not sl < entry < tp:
                return None
        else:
            sl = event["second_extreme"] + sl_buffer_pips * pip
            tp = target
            if not tp < entry < sl:
                return None

    mfe = mae = 0.0
    status = "TIME"
    exit_price = None
    for i in range(first + 1, end + 1):
        bar = bars[i]
        if direction == "long":
            low, high = bar["l"] - half, bar["h"] - half
            mae = min(mae, (low - entry) / pip)
            mfe = max(mfe, (high - entry) / pip)
            if sl is not None and low <= sl:
                exit_price, status = sl, "SL"
                break
            if tp is not None and high >= tp:
                exit_price, status = tp, "TP"
                break
        else:
            high, low = bar["h"] + half, bar["l"] + half
            mae = min(mae, (entry - high) / pip)
            mfe = max(mfe, (entry - low) / pip)
            if sl is not None and high >= sl:
                exit_price, status = sl, "SL"
                break
            if tp is not None and low <= tp:
                exit_price, status = tp, "TP"
                break
    if exit_price is None:
        last = bars[end]["c"]
        exit_price = last - half if direction == "long" else last + half

    pips = ((exit_price - entry) if direction == "long"
            else (entry - exit_price)) / pip
    risk = abs(entry - sl) / pip if sl is not None else None
    reward = abs(tp - entry) / pip if tp is not None else None
    return {"date": event["date"], "order": event["order"],
            "direction": direction, "entry": entry, "sl": sl, "tp": tp,
            "exit": exit_price, "status": status, "pips": pips,
            "mfe": mfe, "mae": mae,
            "rr": reward / risk if risk else None,
            "bars_forward": end - first}


def summarize(results):
    pips = [r["pips"] for r in results]
    gross_profit = sum(p for p in pips if p > 0)
    gross_loss = sum(p for p in pips if p < 0)
    cumulative = peak = max_dd = 0.0
    for value in pips:
        cumulative += value
        peak = max(peak, cumulative)
        max_dd = max(max_dd, peak - cumulative)
    rr = [r["rr"] for r in results if r["rr"] is not None]
    wins = [p for p in pips if p > 0]
    losses = [p for p in pips if p < 0]
    return {
        "trades": len(results),
        "status": {key: sum(1 for r in results if r["status"] == key)
                   for key in ("TP", "SL", "TIME")},
        "wins": len(wins),
        "winrate": (len(wins) / len(pips) * 100) if pips else 0.0,
        "total_pips": sum(pips),
        "avg_pips": (sum(pips) / len(pips)) if pips else 0.0,
        "expectancy": (sum(pips) / len(pips)) if pips else 0.0,
        "avg_win": (sum(wins) / len(wins)) if wins else 0.0,
        "avg_loss": (sum(losses) / len(losses)) if losses else 0.0,
        "profit_factor": (gross_profit / abs(gross_loss)) if gross_loss else None,
        "max_drawdown": max_dd,
        "avg_mfe": (sum(r["mfe"] for r in results) / len(results)) if results else 0.0,
        "avg_mae": (sum(r["mae"] for r in results) / len(results)) if results else 0.0,
        "avg_rr": (sum(rr) / len(rr)) if rr else None,
    }
