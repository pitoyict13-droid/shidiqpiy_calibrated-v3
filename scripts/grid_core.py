"""Pure math and guard helpers for the forex breakout-grid executor.

No MetaTrader5 import here so the logic is unit-testable anywhere.
"""

import math
from datetime import timedelta


def pip_size(digits, point):
    return point * 10 if digits in (3, 5) else point


def grid_index(price, step):
    return math.floor(price / step + 1e-9)


def grid_level(index, step):
    return index * step


def round_price(price, digits):
    return round(price, digits)


def sl_tp(entry, direction, sl_pips, tp_pips, pip):
    sign = 1 if direction == "long" else -1
    return entry - sign * sl_pips * pip, entry + sign * tp_pips * pip


def risk_usd(entry, sl, contract_size, lot, quote_to_usd=1.0):
    return abs(entry - sl) * contract_size * lot * quote_to_usd


def be_price(entry, direction, spread_pips, buffer_pips, pip, digits):
    sign = 1 if direction == "long" else -1
    return round_price(entry + sign * (spread_pips + buffer_pips) * pip, digits)


def should_breakeven(direction, entry, current_price, trigger_pips, pip):
    if direction == "long":
        return current_price >= entry + trigger_pips * pip
    return current_price <= entry - trigger_pips * pip


def should_breakeven_dist(direction, entry, current_price, distance):
    if direction == "long":
        return current_price >= entry + distance
    return current_price <= entry - distance


def within_chase(price, level, max_pips, pip):
    return abs(price - level) <= max_pips * pip + 1e-12


def in_session(now, friday_close_hour=16):
    if now.weekday() >= 5:
        return False
    if now.weekday() == 4:
        return 7 <= now.hour < friday_close_hour
    return 7 <= now.hour < 19


def news_blackout(events, currencies, now, window_minutes=30):
    lo = now - timedelta(minutes=window_minutes)
    hi = now + timedelta(minutes=window_minutes)
    wanted = {str(c).upper() for c in currencies}
    for ev in events or []:
        dt = ev.get("dt")
        if dt is None or not lo <= dt <= hi:
            continue
        if int(ev.get("importance") or 0) < 2:
            continue
        if str(ev.get("currency") or "").upper() not in wanted:
            continue
        return ev.get("name") or "news"
    return None


def news_volatility(events, currencies, now, window_minutes=60, min_importance=3):
    lo = now - timedelta(minutes=window_minutes)
    wanted = {str(c).upper() for c in currencies}
    for ev in events or []:
        dt = ev.get("dt")
        if dt is None or not lo <= dt <= now:
            continue
        if int(ev.get("importance") or 0) < min_importance:
            continue
        if str(ev.get("currency") or "").upper() not in wanted:
            continue
        return ev.get("name") or "news"
    return None


def guard_tripped(day, equity, max_loss):
    return equity <= float(day.get("start_equity", equity)) - float(max_loss)
