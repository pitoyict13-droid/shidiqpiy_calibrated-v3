"""HFT-style breakout-grid executor for forex majors on local MT5.

DRY-RUN by default with a paper book; sending orders needs --enable and a
DEMO account. Risk is capped by a hard SL per position, breakeven at +1R,
a daily loss guard, session filter and news blackout, but losses are still
possible: no grid or breakeven setup guarantees profit.

The optional --scale-out mode opens two legs instead of one: leg A takes
TP1 and leg B runs to TP2 with its SL moved to breakeven once leg A fills.

Usage:
    python scripts/mt5_grid_hft.py --once
    python scripts/mt5_grid_hft.py --interval 1
    python scripts/mt5_grid_hft.py --interval 1 --enable
"""

import argparse
import csv
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import MetaTrader5 as mt5

from grid_core import (
    be_price,
    grid_index,
    grid_level,
    guard_tripped,
    in_session,
    news_blackout,
    news_volatility,
    pip_size,
    risk_usd,
    round_price,
    runner_goes_breakeven,
    scale_leg_targets,
    should_breakeven_dist,
    sl_tp,
    within_chase,
)
from mt5_bridge import BASE_DIR, PAIR_SYMBOLS, load_json, load_source, parse_dt, resolve_symbol

MAGIC = 20261029
DEFAULT_PAIRS = ("EUR/USD", "GBP/USD", "USD/JPY")
NEWS_CURRENCIES = {"USD", "EUR", "GBP", "JPY"}
LOG_FIELDS = [
    "logged_at", "mode", "event", "pair", "symbol", "dir", "lot", "price", "sl",
    "tp", "level", "risk_usd", "spread_pips", "retcode", "ticket", "status", "note",
]
_last_say = {}


def say(message, key=None, every=30):
    now = time.time()
    if key is not None:
        if now - _last_say.get(key, 0) < every:
            return
        _last_say[key] = now
    print(message, flush=True)


def fmt(value, digits=5):
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return ""


def append_log(path, row):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    new_file = not path.exists()
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        if new_file:
            writer.writeheader()
        writer.writerow(row)


def log_row(mode, event, pair="", symbol="", direction="", lot="", price="", sl="", tp="",
            level="", risk="", spread="", retcode="", ticket="", status="", note=""):
    return {
        "logged_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode, "event": event, "pair": pair, "symbol": symbol, "dir": direction,
        "lot": lot, "price": price, "sl": sl, "tp": tp, "level": level,
        "risk_usd": risk, "spread_pips": spread, "retcode": retcode, "ticket": ticket,
        "status": status, "note": note,
    }


def save_state(path, state):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, path)


def round_volume(requested, info):
    step = float(info.volume_step or 0.01)
    low = float(info.volume_min or step)
    high = float(info.volume_max or requested)
    volume = min(max(requested, low), high)
    volume = low + round((volume - low) / step) * step
    return round(volume, 8)


def filling_mode(info):
    flags = int(info.filling_mode or 0)
    if flags & 2:
        return mt5.ORDER_FILLING_IOC
    if flags & 1:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


def magic_positions():
    return [p for p in (mt5.positions_get() or []) if p.magic == MAGIC]


def quote_to_usd(info, mid):
    currency = str(getattr(info, "currency_profit", "") or "").upper()
    if currency == "USD":
        return 1.0
    if currency == "JPY" and mid:
        return 1.0 / float(mid)
    return 1.0


def connect(path, enable):
    kwargs = {"path": path} if path else {}
    if not mt5.initialize(**kwargs):
        raise SystemExit(f"MT5 initialize gagal: {mt5.last_error()}")
    account, terminal = mt5.account_info(), mt5.terminal_info()
    if account is None or terminal is None:
        mt5.shutdown()
        raise SystemExit(f"Tidak bisa membaca akun/terminal MT5: {mt5.last_error()}")
    mode = {0: "DEMO", 1: "CONTEST", 2: "REAL"}.get(account.trade_mode, str(account.trade_mode))
    if enable and account.trade_mode != 0:
        mt5.shutdown()
        raise SystemExit("DITOLAK: --enable hanya diizinkan pada akun DEMO.")
    live = enable and account.trade_mode == 0
    label = "SEND (DEMO)" if live else "DRY-RUN"
    print(f"GRID-HFT | {account.company} | {account.server} | {mode} | "
          f"balance={account.balance} {account.currency} | mode={label}", flush=True)
    if account.trade_mode != 0:
        print("PERINGATAN: akun bukan DEMO; pengiriman order dinonaktifkan.", flush=True)
    return account, live


def ensure_connected(path):
    if mt5.terminal_info() is not None and mt5.account_info() is not None:
        return True
    mt5.shutdown()
    kwargs = {"path": path} if path else {}
    if mt5.initialize(**kwargs):
        print("Koneksi MT5 dipulihkan.", flush=True)
        return True
    say("MT5 terputus; mencoba menyambung ulang...", key="conn", every=30)
    return False


def pair_context(pair):
    base = PAIR_SYMBOLS.get(pair)
    if not base:
        return None
    name = resolve_symbol(base)
    if not name:
        return None
    info = mt5.symbol_info(name)
    if info is None:
        return None
    if not info.visible:
        mt5.symbol_select(name, True)
    tick = mt5.symbol_info_tick(name)
    if tick is None or not tick.bid or not tick.ask:
        return None
    pip = pip_size(info.digits, info.point)
    bid, ask = float(tick.bid), float(tick.ask)
    return {
        "pair": pair, "symbol": name, "info": info,
        "bid": bid, "ask": ask, "mid": (bid + ask) / 2,
        "pip": pip, "spread_pips": (ask - bid) / pip,
    }


def m1_ema(symbol_name, period):
    rates = mt5.copy_rates_from_pos(symbol_name, mt5.TIMEFRAME_M1, 0, period + 10)
    if rates is None or len(rates) < period + 2:
        return None, None
    closes = [float(r["close"]) for r in rates[:-1]]
    ema = closes[0]
    k = 2.0 / (period + 1)
    for close in closes[1:]:
        ema = close * k + ema * (1 - k)
    return ema, closes[-1]


def signal_for_pair(state, pair, mid, step):
    ps = state.setdefault("pairs", {}).setdefault(pair, {"index": None, "pending": None})
    if ps.get("step") != step:
        ps["step"] = step
        ps["index"] = None
        ps["pending"] = None
    index = grid_index(mid, step)
    prev = ps.get("index")
    pending = ps.get("pending")
    signal = None
    if prev is None:
        ps["index"] = index
        ps["pending"] = None
        return None
    if index != prev:
        direction = "long" if index > prev else "short"
        level = grid_level(index if direction == "long" else prev, step)
        pending = {"dir": direction, "index": index, "level": level, "count": 1, "fired": False}
    elif pending is not None and pending.get("index") == index:
        pending["count"] = int(pending.get("count") or 0) + 1
        if pending["count"] >= 2 and not pending.get("fired"):
            pending["fired"] = True
            signal = {"dir": pending["dir"], "level": pending["level"], "index": index}
    else:
        pending = None
    ps["pending"] = pending
    ps["index"] = index
    return signal


def load_news(source):
    raw = load_source(source, None, cache_bust=True)
    if raw is None:
        print(f"Gagal memuat news dari {source}; memakai data/calendar.json lokal.", flush=True)
        raw = load_source(str(BASE_DIR / "data" / "calendar.json"), None)
    if isinstance(raw, dict):
        raw = raw.get("events", [])
    events = []
    for ev in raw or []:
        dt = parse_dt(ev.get("Date"))
        if dt is None:
            continue
        try:
            importance = int(ev.get("Importance") or 0)
        except (TypeError, ValueError):
            importance = 0
        events.append({
            "dt": dt, "importance": importance,
            "currency": str(ev.get("Country") or "").upper(),
            "name": ev.get("Event"),
        })
    return events


def roll_day(state, now, equity):
    today = now.strftime("%Y-%m-%d")
    day = state.get("day") or {}
    if day.get("date") != today:
        day = {"date": today, "start_equity": float(equity), "trades": 0,
               "stopped": False, "blocked": {}}
        state["day"] = day
        state["pairs"] = {}
        print(f"[{now:%H:%M:%S}Z] hari dagang baru (UTC {today}); "
              f"equity awal {float(equity):.2f}", flush=True)
    return day


def level_key(level, digits):
    return f"{float(level):.{digits}f}"


def block_level(day, pair, level, digits):
    bucket = day.setdefault("blocked", {}).setdefault(pair, [])
    key = level_key(level, digits)
    if key not in bucket:
        bucket.append(key)


def level_blocked(day, pair, level, digits):
    return level_key(level, digits) in (day.get("blocked") or {}).get(pair, [])


def send_market(symbol_name, info, direction, lot, sl, tp, deviation):
    tick = mt5.symbol_info_tick(symbol_name)
    if tick is None or not tick.bid or not tick.ask:
        return None, None
    price = float(tick.ask if direction == "long" else tick.bid)
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol_name,
        "volume": lot,
        "type": mt5.ORDER_TYPE_BUY if direction == "long" else mt5.ORDER_TYPE_SELL,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": deviation,
        "magic": MAGIC,
        "comment": "grid-hft",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    return mt5.order_send(request), price


def send_sltp(position, sl, tp):
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "position": position.ticket,
        "symbol": position.symbol,
        "sl": sl,
        "tp": tp,
        "magic": MAGIC,
    }
    return mt5.order_send(request)


def close_reason(ticket):
    """TP/SL/OTHER for a closed position ticket, or None while history is not ready."""
    deals = mt5.history_deals_get(position=int(ticket))
    if not deals:
        return None
    for deal in deals:
        entry = int(getattr(deal, "entry", -1))
        if entry in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY):
            reason = int(getattr(deal, "reason", -1))
            if reason == mt5.DEAL_REASON_TP:
                return "TP"
            if reason == mt5.DEAL_REASON_SL:
                return "SL"
            return "OTHER"
    return None


def detect_ticket(result, symbol_name, known):
    """Position ticket of a just-filled market order (two legs fire back to back)."""
    order = int(getattr(result, "order", 0) or 0)
    current = [p for p in magic_positions() if p.symbol == symbol_name]
    if any(p.ticket == order for p in current):
        return order
    fresh = [p for p in current if p.ticket not in known]
    if fresh:
        return max(fresh, key=lambda p: p.time).ticket
    return order


def open_real(args, state, ctx, direction, level, now, day, factor=1.0):
    info, pip = ctx["info"], ctx["pip"]
    entry = ctx["ask"] if direction == "long" else ctx["bid"]
    sl, tp = sl_tp(entry, direction, args.sl_pips * factor, args.tp_pips * factor, pip)
    sl, tp = round_price(sl, info.digits), round_price(tp, info.digits)
    stops = float(getattr(info, "trade_stops_level", 0) or 0) * info.point
    if abs(entry - sl) < stops or abs(tp - entry) < stops:
        say(f"SKIP {ctx['pair']}: SL/TP lebih dekat dari trade_stops_level.")
        return False
    lot = round_volume(args.lot, info)
    result, price = send_market(ctx["symbol"], info, direction, lot, sl, tp, args.deviation)
    fill = price or entry
    risk = risk_usd(fill, sl, info.trade_contract_size, lot, quote_to_usd(info, ctx["mid"]))
    row = log_row(
        "SEND", "OPEN", pair=ctx["pair"], symbol=ctx["symbol"],
        direction="BUY" if direction == "long" else "SELL", lot=lot,
        price=fmt(fill, info.digits), sl=fmt(sl, info.digits), tp=fmt(tp, info.digits),
        level=fmt(level, info.digits), risk=f"{risk:.2f}", spread=f"{ctx['spread_pips']:.1f}",
    )
    if result is None:
        row["status"] = "NO_RESPONSE"
        append_log(args.log, row)
        say(f"ORDER GAGAL {ctx['pair']}: tidak ada respons terminal.")
        return False
    row["retcode"] = result.retcode
    if result.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED):
        row["status"] = f"REJECTED {result.comment or ''}".strip()
        append_log(args.log, row)
        say(f"REJECTED {ctx['pair']} {row['dir']} retcode={result.retcode} {result.comment or ''}",
            key=f"rej-{ctx['pair']}", every=10)
        return False
    positions = [p for p in magic_positions() if p.symbol == ctx["symbol"]]
    ticket = max(positions, key=lambda p: p.time).ticket if positions else getattr(result, "order", "")
    row["ticket"] = ticket
    row["status"] = "SENT"
    append_log(args.log, row)
    state["be"][str(ticket)] = {"pair": ctx["pair"], "be_done": False,
                                "attempts": 0, "next_try": "",
                                "risk_dist": abs(fill - sl), "factor": factor}
    day["trades"] = int(day.get("trades") or 0) + 1
    state["last_trade"][ctx["pair"]] = now.isoformat(timespec="seconds")
    block_level(day, ctx["pair"], level, info.digits)
    print(f"SENT {ctx['pair']} {row['dir']} lot={lot} entry={row['price']} SL={row['sl']} "
          f"TP={row['tp']} risk=${row['risk_usd']} ticket={ticket}", flush=True)
    return True


def open_real_scale(args, state, ctx, direction, level, now, day, factor=1.0):
    info, pip = ctx["info"], ctx["pip"]
    entry = ctx["ask"] if direction == "long" else ctx["bid"]
    legs = scale_leg_targets(entry, direction, args.sl_pips * factor,
                             args.tp1_pips * factor, args.tp_pips * factor, pip)
    stops = float(getattr(info, "trade_stops_level", 0) or 0) * info.point
    for leg in legs:
        leg["sl"] = round_price(leg["sl"], info.digits)
        leg["tp"] = round_price(leg["tp"], info.digits)
        if abs(entry - leg["sl"]) < stops or abs(leg["tp"] - entry) < stops:
            say(f"SKIP {ctx['pair']}: SL/TP leg {leg['role']} lebih dekat dari trade_stops_level.")
            return False
    lot = round_volume(args.lot, info)
    known = {p.ticket for p in magic_positions()}
    state["scale_seq"] = int(state.get("scale_seq") or 0) + 1
    group = f"{ctx['symbol']}-{now:%Y%m%d%H%M%S}-{state['scale_seq']}"
    tickets, fills, total_risk = {}, {}, 0.0
    for leg in legs:
        result, price = send_market(ctx["symbol"], info, direction, lot, leg["sl"], leg["tp"],
                                    args.deviation)
        if result is None or result.retcode not in (mt5.TRADE_RETCODE_DONE,
                                                    mt5.TRADE_RETCODE_PLACED):
            code = getattr(result, "retcode", "")
            append_log(args.log, log_row(
                "SEND", "OPEN", pair=ctx["pair"], symbol=ctx["symbol"],
                direction="BUY" if direction == "long" else "SELL", lot=lot,
                price=fmt(entry, info.digits), sl=fmt(leg["sl"], info.digits),
                tp=fmt(leg["tp"], info.digits), level=fmt(level, info.digits),
                retcode=code, status="REJECTED", note=f"scale {group} leg {leg['role']}",
            ))
            say(f"SCALE REJECTED {ctx['pair']} leg {leg['role']} retcode={code}",
                key=f"rej-{ctx['pair']}", every=10)
            break
        ticket = detect_ticket(result, ctx["symbol"], known)
        known.add(ticket)
        tickets[leg["role"]] = ticket
        fills[leg["role"]] = price or entry
        risk = risk_usd(fills[leg["role"]], leg["sl"], info.trade_contract_size, lot,
                        quote_to_usd(info, ctx["mid"]))
        total_risk += risk
        state["be"][str(ticket)] = {
            "pair": ctx["pair"], "be_done": False, "attempts": 0, "next_try": "",
            "risk_dist": abs(fills[leg["role"]] - leg["sl"]), "factor": factor,
            "scale_role": leg["role"], "scale_group": group,
        }
        append_log(args.log, log_row(
            "SEND", "OPEN", pair=ctx["pair"], symbol=ctx["symbol"],
            direction="BUY" if direction == "long" else "SELL", lot=lot,
            price=fmt(fills[leg["role"]], info.digits), sl=fmt(leg["sl"], info.digits),
            tp=fmt(leg["tp"], info.digits), level=fmt(level, info.digits),
            risk=f"{risk:.2f}", spread=f"{ctx['spread_pips']:.1f}", retcode=result.retcode,
            ticket=ticket, status="SENT", note=f"scale {group} leg {leg['role']}",
        ))
        print(f"SENT {ctx['pair']} {'BUY' if direction == 'long' else 'SELL'} leg {leg['role']} "
              f"lot={lot} entry={fmt(fills[leg['role']], info.digits)} "
              f"SL={fmt(leg['sl'], info.digits)} TP={fmt(leg['tp'], info.digits)} "
              f"risk=${risk:.2f} ticket={ticket}", flush=True)
    if not tickets:
        return False
    state["scale"][group] = {
        "pair": ctx["pair"], "symbol": ctx["symbol"], "dir": direction,
        "leg_a": tickets.get("a"), "leg_b": tickets.get("b"),
        "tp1": legs[0]["tp"], "tp": legs[1]["tp"], "sl": legs[0]["sl"],
        "entry": fills.get("a") or entry, "runner_be_done": False, "tries": 0,
        "opened_at": now.isoformat(timespec="seconds"),
    }
    day["trades"] = int(day.get("trades") or 0) + 1
    state["last_trade"][ctx["pair"]] = now.isoformat(timespec="seconds")
    block_level(day, ctx["pair"], level, info.digits)
    print(f"SENT SCALE {ctx['pair']} legs={len(tickets)} total_risk=${total_risk:.2f}",
          flush=True)
    return True


def open_paper_scale(args, state, ctx, direction, level, now, day, factor=1.0):
    info, pip = ctx["info"], ctx["pip"]
    entry = ctx["ask"] if direction == "long" else ctx["bid"]
    legs = scale_leg_targets(entry, direction, args.sl_pips * factor,
                             args.tp1_pips * factor, args.tp_pips * factor, pip)
    seq = int(state.get("paper_seq") or 0)
    group = f"paper-{ctx['symbol']}-{now:%Y%m%d%H%M%S}-{seq + 1}"
    total_risk = 0.0
    for leg in legs:
        seq += 1
        sl = round_price(leg["sl"], info.digits)
        tp = round_price(leg["tp"], info.digits)
        risk = risk_usd(entry, sl, info.trade_contract_size, args.lot,
                        quote_to_usd(info, ctx["mid"]))
        total_risk += risk
        state["paper"].append({
            "id": seq, "pair": ctx["pair"], "symbol": ctx["symbol"], "dir": direction,
            "lot": args.lot, "entry": entry, "sl": sl, "tp": tp, "level": level,
            "opened_at": now.isoformat(timespec="seconds"), "be_done": False,
            "be_price": None, "risk_dist": abs(entry - sl), "factor": factor,
            "role": leg["role"], "group": group,
        })
        append_log(args.log, log_row(
            "DRY_RUN", "PAPER_OPEN", pair=ctx["pair"], symbol=ctx["symbol"],
            direction="BUY" if direction == "long" else "SELL", lot=args.lot,
            price=fmt(entry, info.digits), sl=fmt(sl, info.digits), tp=fmt(tp, info.digits),
            level=fmt(level, info.digits), risk=f"{risk:.2f}",
            spread=f"{ctx['spread_pips']:.1f}", status="PAPER",
            note=f"scale {group} leg {leg['role']}",
        ))
    state["paper_seq"] = seq
    day["trades"] = int(day.get("trades") or 0) + 1
    state["last_trade"][ctx["pair"]] = now.isoformat(timespec="seconds")
    block_level(day, ctx["pair"], level, info.digits)
    print(f"PAPER_OPEN SCALE {ctx['pair']} 2 legs @{args.lot:g} "
          f"TP1={args.tp1_pips:g}p TP2={args.tp_pips:g}p total_risk=${total_risk:.2f} "
          f"group={group}", flush=True)
    return True


def open_paper(args, state, ctx, direction, level, now, day, factor=1.0):
    info, pip = ctx["info"], ctx["pip"]
    entry = ctx["ask"] if direction == "long" else ctx["bid"]
    sl, tp = sl_tp(entry, direction, args.sl_pips * factor, args.tp_pips * factor, pip)
    sl, tp = round_price(sl, info.digits), round_price(tp, info.digits)
    risk = risk_usd(entry, sl, info.trade_contract_size, args.lot, quote_to_usd(info, ctx["mid"]))
    seq = int(state.get("paper_seq") or 0) + 1
    state["paper_seq"] = seq
    state["paper"].append({
        "id": seq, "pair": ctx["pair"], "symbol": ctx["symbol"], "dir": direction,
        "lot": args.lot, "entry": entry, "sl": sl, "tp": tp, "level": level,
        "opened_at": now.isoformat(timespec="seconds"), "be_done": False, "be_price": None,
        "risk_dist": abs(entry - sl), "factor": factor,
    })
    day["trades"] = int(day.get("trades") or 0) + 1
    state["last_trade"][ctx["pair"]] = now.isoformat(timespec="seconds")
    block_level(day, ctx["pair"], level, info.digits)
    append_log(args.log, log_row(
        "DRY_RUN", "PAPER_OPEN", pair=ctx["pair"], symbol=ctx["symbol"],
        direction="BUY" if direction == "long" else "SELL", lot=args.lot,
        price=fmt(entry, info.digits), sl=fmt(sl, info.digits), tp=fmt(tp, info.digits),
        level=fmt(level, info.digits), risk=f"{risk:.2f}", spread=f"{ctx['spread_pips']:.1f}",
        status="PAPER",
    ))
    print(f"PAPER_OPEN {ctx['pair']} {'BUY' if direction == 'long' else 'SELL'} lot={args.lot} "
          f"entry={fmt(entry, info.digits)} SL={fmt(sl, info.digits)} TP={fmt(tp, info.digits)} "
          f"risk=${risk:.2f} level={fmt(level, info.digits)}", flush=True)
    return True


def manage_be(args, state, now):
    for pos in magic_positions():
        info = mt5.symbol_info(pos.symbol)
        tick = mt5.symbol_info_tick(pos.symbol)
        if info is None or tick is None or not tick.bid or not tick.ask:
            continue
        pip = pip_size(info.digits, info.point)
        direction = "long" if pos.type == mt5.POSITION_TYPE_BUY else "short"
        current = float(tick.bid if direction == "long" else tick.ask)
        spread_pips = (float(tick.ask) - float(tick.bid)) / pip
        target = be_price(pos.price_open, direction, spread_pips, args.be_buffer_pips, pip, info.digits)
        rec = state["be"].setdefault(str(pos.ticket), {"pair": None, "be_done": False,
                                                       "attempts": 0, "next_try": ""})
        if rec.get("scale_role") in ("a", "b"):
            continue
        if rec.get("be_done"):
            continue
        moved = (
            (direction == "long" and pos.sl and pos.sl > pos.price_open + 0.5 * info.point) or
            (direction == "short" and pos.sl and pos.sl < pos.price_open - 0.5 * info.point)
        )
        if moved:
            rec["be_done"] = True
            rec["be_price"] = pos.sl
            continue
        risk_dist = float(rec.get("risk_dist") or (args.be_trigger_pips * pip))
        if not should_breakeven_dist(direction, pos.price_open, current, risk_dist):
            continue
        next_try = parse_dt(rec.get("next_try"))
        if next_try and now < next_try:
            continue
        stops = float(getattr(info, "trade_stops_level", 0) or 0) * info.point
        if direction == "long" and target > current - stops:
            continue
        if direction == "short" and target < current + stops:
            continue
        result = send_sltp(pos, target, pos.tp)
        if result is not None and result.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED):
            rec.update({"be_done": True, "be_price": target, "attempts": 0, "next_try": ""})
            append_log(args.log, log_row(
                "SEND", "BE", pair=rec.get("pair") or "", symbol=pos.symbol,
                direction="BUY" if direction == "long" else "SELL",
                price=fmt(current, info.digits), sl=fmt(target, info.digits),
                tp=fmt(pos.tp, info.digits), ticket=pos.ticket,
                retcode=result.retcode, status="BE",
            ))
            print(f"BE {pos.symbol} ticket={pos.ticket} SL -> {fmt(target, info.digits)}", flush=True)
        else:
            rec["attempts"] = int(rec.get("attempts") or 0) + 1
            rec["next_try"] = (now + timedelta(seconds=60)).isoformat(timespec="seconds")
            code = getattr(result, "retcode", "")
            say(f"BE ditolak {pos.symbol} ticket={pos.ticket} retcode={code}; coba lagi 60 detik.",
                key=f"be-{pos.ticket}", every=60)


def manage_scale_real(args, state, positions, now):
    groups = state.get("scale") or {}
    if not groups:
        return
    by_ticket = {p.ticket: p for p in positions}
    for group in groups.values():
        if group.get("runner_be_done"):
            continue
        leg_a, leg_b = group.get("leg_a"), group.get("leg_b")
        if not leg_a or not leg_b:
            group["runner_be_done"] = True
            continue
        if leg_a in by_ticket:
            continue
        reason = close_reason(leg_a)
        if reason is None:
            group["tries"] = int(group.get("tries") or 0) + 1
            if group["tries"] >= 3:
                ctx = pair_context(group["pair"])
                if ctx is not None:
                    current = ctx["bid"] if group["dir"] == "long" else ctx["ask"]
                    if group["dir"] == "long" and current >= group["tp1"]:
                        reason = "TP"
                    elif group["dir"] == "short" and current <= group["tp1"]:
                        reason = "TP"
            if reason is None:
                if group["tries"] >= 6:
                    group["runner_be_done"] = True
                    say(f"SCALE {group['pair']}: riwayat leg A tidak terbaca; "
                        f"runner tetap pakai SL awal.", key=f"scale-{group['pair']}", every=300)
                continue
        if not runner_goes_breakeven(reason):
            group["runner_be_done"] = True
            say(f"SCALE {group['pair']}: leg A tutup {reason}; runner tetap pakai SL awal.",
                key=f"scale-{group['pair']}", every=300)
            continue
        pos = by_ticket.get(leg_b)
        if pos is None:
            group["runner_be_done"] = True
            continue
        info = mt5.symbol_info(pos.symbol)
        tick = mt5.symbol_info_tick(pos.symbol)
        if info is None or tick is None or not tick.bid or not tick.ask:
            continue
        pip = pip_size(info.digits, info.point)
        direction = "long" if pos.type == mt5.POSITION_TYPE_BUY else "short"
        current = float(tick.bid if direction == "long" else tick.ask)
        spread_pips = (float(tick.ask) - float(tick.bid)) / pip
        target = be_price(pos.price_open, direction, spread_pips,
                          args.be_buffer_pips, pip, info.digits)
        stops = float(getattr(info, "trade_stops_level", 0) or 0) * info.point
        if (direction == "long" and target > current - stops) or \
                (direction == "short" and target < current + stops):
            continue
        result = send_sltp(pos, target, pos.tp)
        if result is not None and result.retcode in (mt5.TRADE_RETCODE_DONE,
                                                     mt5.TRADE_RETCODE_PLACED):
            group["runner_be_done"] = True
            append_log(args.log, log_row(
                "SEND", "SCALE_BE", pair=group["pair"], symbol=pos.symbol,
                direction="BUY" if direction == "long" else "SELL",
                price=fmt(current, info.digits), sl=fmt(target, info.digits),
                tp=fmt(pos.tp, info.digits), ticket=pos.ticket,
                retcode=result.retcode, status="BE",
                note=f"leg B setelah TP1 leg {leg_a}",
            ))
            print(f"SCALE_BE {group['pair']} leg B ticket={pos.ticket} "
                  f"SL -> {fmt(target, info.digits)}", flush=True)
        else:
            code = getattr(result, "retcode", "")
            say(f"SCALE_BE ditolak {group['pair']} ticket={pos.ticket} retcode={code}; coba lagi.",
                key=f"scale-be-{pos.ticket}", every=60)
    for gid, group in list(groups.items()):
        a, b = group.get("leg_a"), group.get("leg_b")
        if (a is None or a not in by_ticket) and (b is None or b not in by_ticket) \
                and group.get("runner_be_done"):
            groups.pop(gid, None)


def manage_paper(args, state, contexts, now):
    kept = []
    closed_tp1 = []
    for pos in state.get("paper") or []:
        ctx = contexts.get(pos.get("pair"))
        if ctx is None:
            kept.append(pos)
            continue
        info, pip = ctx["info"], ctx["pip"]
        direction = pos["dir"]
        current = ctx["bid"] if direction == "long" else ctx["ask"]
        label = "BUY" if direction == "long" else "SELL"
        risk_dist = float(pos.get("risk_dist") or (args.be_trigger_pips * pip))
        if pos.get("role") not in ("a", "b") and not pos.get("be_done") and \
                should_breakeven_dist(direction, pos["entry"], current, risk_dist):
            target = be_price(pos["entry"], direction, ctx["spread_pips"],
                              args.be_buffer_pips, pip, info.digits)
            pos["sl"] = target
            pos["be_done"] = True
            pos["be_price"] = target
            append_log(args.log, log_row(
                "DRY_RUN", "PAPER_BE", pair=pos["pair"], symbol=pos["symbol"], direction=label,
                price=fmt(current, info.digits), sl=fmt(target, info.digits),
                tp=fmt(pos["tp"], info.digits), level=fmt(pos.get("level", 0), info.digits),
                status="BE",
            ))
            print(f"PAPER_BE {pos['pair']} ticket#{pos['id']} SL -> {fmt(target, info.digits)}",
                  flush=True)
        exit_price, note = None, ""
        if direction == "long":
            if current >= pos["tp"]:
                exit_price, note = pos["tp"], "TP"
            elif current <= pos["sl"]:
                exit_price, note = pos["sl"], ("BE" if pos.get("be_done") else "SL")
        else:
            if current <= pos["tp"]:
                exit_price, note = pos["tp"], "TP"
            elif current >= pos["sl"]:
                exit_price, note = pos["sl"], ("BE" if pos.get("be_done") else "SL")
        if exit_price is None:
            kept.append(pos)
            continue
        pnl = (exit_price - pos["entry"]) if direction == "long" else (pos["entry"] - exit_price)
        pnl_usd = pnl * info.trade_contract_size * float(pos.get("lot") or args.lot) * \
            quote_to_usd(info, ctx["mid"])
        append_log(args.log, log_row(
            "DRY_RUN", "PAPER_CLOSE", pair=pos["pair"], symbol=pos["symbol"], direction=label,
            lot=pos.get("lot", args.lot), price=fmt(exit_price, info.digits),
            sl=fmt(pos["sl"], info.digits), tp=fmt(pos["tp"], info.digits),
            level=fmt(pos.get("level", 0), info.digits), status=note,
            note=f"pnl=${pnl_usd:.2f}",
        ))
        print(f"PAPER_CLOSE {pos['pair']} {note} pnl=${pnl_usd:.2f}", flush=True)
        if note == "TP" and pos.get("role") == "a" and pos.get("group"):
            closed_tp1.append(pos)
    state["paper"] = kept
    for leg_a in closed_tp1:
        runner = next((p for p in kept if p.get("group") == leg_a["group"]
                       and p.get("role") == "b"), None)
        if runner is None or runner.get("be_done"):
            continue
        ctx = contexts.get(runner.get("pair"))
        if ctx is None:
            continue
        info, pip = ctx["info"], ctx["pip"]
        target = be_price(runner["entry"], runner["dir"], ctx["spread_pips"],
                          args.be_buffer_pips, pip, info.digits)
        runner["sl"] = target
        runner["be_done"] = True
        runner["be_price"] = target
        append_log(args.log, log_row(
            "DRY_RUN", "PAPER_SCALE_BE", pair=runner["pair"], symbol=runner["symbol"],
            direction="BUY" if runner["dir"] == "long" else "SELL",
            price=fmt(target, info.digits), sl=fmt(target, info.digits),
            tp=fmt(runner["tp"], info.digits), level=fmt(runner.get("level", 0), info.digits),
            status="BE", note=f"leg B setelah TP1 leg {leg_a['id']}",
        ))
        print(f"PAPER_SCALE_BE {runner['pair']} group={runner['group']} "
              f"SL -> {fmt(target, info.digits)}", flush=True)


def sync_closes(args, state, positions):
    current = {str(p.ticket) for p in positions}
    known = set(state.get("open_tickets") or [])
    for ticket in known - current:
        rec = state["be"].pop(ticket, {}) or {}
        append_log(args.log, log_row("SEND", "CLOSE", pair=rec.get("pair") or "",
                                     ticket=ticket, status="CLOSED", note="SL/TP/manual"))
        print(f"CLOSE ticket={ticket} {rec.get('pair') or ''}", flush=True)
    state["open_tickets"] = sorted(current)


def maybe_enter(args, state, ctx, day, now, news, live, open_symbols, open_count):
    pair = ctx["pair"]
    info, pip = ctx["info"], ctx["pip"]
    vol_event = news_volatility(news, NEWS_CURRENCIES, now, args.news_vol_window)
    factor = args.news_vol_factor if vol_event else 1.0
    step = args.grid_pips * pip * factor
    signal = signal_for_pair(state, pair, ctx["mid"], step)
    if not args.ignore_session and not in_session(now, args.friday_close_hour):
        return False
    if day.get("stopped"):
        return False
    if signal is None:
        return False
    if int(day.get("trades") or 0) >= args.max_trades_per_day:
        say(f"SKIP {pair}: batas {args.max_trades_per_day} trade/hari tercapai.",
            key="maxtrades", every=60)
        return False
    if ctx["symbol"] in open_symbols or pair in {p.get("pair") for p in state.get("paper") or []}:
        return False
    if open_count + (2 if args.scale_out else 1) > args.max_open:
        say(f"SKIP {pair}: batas {args.max_open} posisi terbuka.", key="maxopen", every=30)
        return False
    last = parse_dt(state.get("last_trade", {}).get(pair))
    if last and (now - last).total_seconds() < args.cooldown:
        return False
    direction, level = signal["dir"], signal["level"]
    if level_blocked(day, pair, level, info.digits):
        say(f"SKIP {pair}: level {fmt(level, info.digits)} sudah dipakai hari ini.",
            key=f"block-{pair}", every=60)
        return False
    event = news_blackout(news, NEWS_CURRENCIES, now, args.news_window)
    if event:
        say(f"SKIP {pair}: blackout news '{event}' ±{args.news_window} menit.",
            key=f"news-{pair}", every=60)
        return False
    if ctx["spread_pips"] > args.max_spread_pips:
        say(f"SKIP {pair}: spread {ctx['spread_pips']:.1f} pips > {args.max_spread_pips:g}.",
            key=f"spread-{pair}", every=30)
        return False
    if not within_chase(ctx["mid"], level, args.max_chase_pips, pip):
        say(f"SKIP {pair}: harga terlalu jauh dari level {fmt(level, info.digits)}.",
            key=f"chase-{pair}", every=30)
        return False
    if args.ema_period > 0:
        ema, last_close = m1_ema(ctx["symbol"], args.ema_period)
        if ema is None or (direction == "long" and last_close <= ema) or \
                (direction == "short" and last_close >= ema):
            say(f"SKIP {pair}: filter EMA{args.ema_period} M1 tidak searah.",
                key=f"ema-{pair}", every=30)
            return False
    if factor != 1.0:
        say(f"INFO {pair}: mode volatilitas pasca-news '{vol_event}', grid/SL/TP x{factor:g}.",
            key=f"vol-{pair}", every=300)
    if live:
        if args.scale_out:
            return open_real_scale(args, state, ctx, direction, level, now, day, factor)
        return open_real(args, state, ctx, direction, level, now, day, factor)
    if args.scale_out:
        return open_paper_scale(args, state, ctx, direction, level, now, day, factor)
    return open_paper(args, state, ctx, direction, level, now, day, factor)


def print_once(args, state, contexts, now, news, positions, day):
    session = in_session(now, args.friday_close_hour)
    event = news_blackout(news, NEWS_CURRENCIES, now, args.news_window)
    vol_event = news_volatility(news, NEWS_CURRENCIES, now, args.news_vol_window)
    vol_txt = f"vol=x{args.news_vol_factor:g} ({vol_event})" if vol_event else "vol=normal"
    print(f"[{now:%H:%M:%S}Z] cek koneksi/sinyal | sesi={'buka' if session else 'tutup'} | "
          f"news={'blackout ' + event if event else 'aman'} | {vol_txt} | "
          f"trade_hari_ini={day.get('trades', 0)} | "
          f"posisi_executor={len(positions)}", flush=True)
    factor = args.news_vol_factor if vol_event else 1.0
    for pair, ctx in contexts.items():
        ps = state["pairs"].get(pair) or {}
        index = ps.get("index")
        step = args.grid_pips * ctx["pip"] * factor
        level = grid_level(index, step) if index is not None else None
        ema, last_close = m1_ema(ctx["symbol"], args.ema_period) if args.ema_period > 0 else (None, None)
        if args.ema_period <= 0:
            ema_txt = "off"
        elif ema is None:
            ema_txt = "n/a"
        else:
            ema_txt = "naik" if last_close > ema else "turun"
        print(f"  {pair} level={fmt(level, ctx['info'].digits) if level is not None else '-'} "
              f"bid={fmt(ctx['bid'], ctx['info'].digits)} spread={ctx['spread_pips']:.1f}p "
              f"EMA{args.ema_period}={ema_txt}", flush=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Forex breakout-grid HFT executor (demo-only send)")
    parser.add_argument("--enable", action="store_true", help="kirim order (hanya akun DEMO)")
    parser.add_argument("--once", action="store_true", help="satu putaran cek lalu keluar")
    parser.add_argument("--interval", type=float, default=1.0, help="detik antar scan (default 1)")
    parser.add_argument("--pairs", default=",".join(DEFAULT_PAIRS), help="daftar pair dipisah koma")
    parser.add_argument("--lot", type=float, default=0.01)
    parser.add_argument("--grid-pips", type=float, default=15.0)
    parser.add_argument("--sl-pips", type=float, default=15.0)
    parser.add_argument("--tp-pips", type=float, default=30.0)
    parser.add_argument("--scale-out", action="store_true",
                        help="dua leg: TP1 lalu SL leg B ke BE, sisa ke TP2 "
                             "(lot total 2x lipat, tiap leg dihitung di max-open)")
    parser.add_argument("--tp1-pips", type=float, default=None,
                        help="jarak TP leg pertama saat --scale-out (default = --sl-pips)")
    parser.add_argument("--be-trigger-pips", type=float, default=15.0)
    parser.add_argument("--be-buffer-pips", type=float, default=2.0)
    parser.add_argument("--max-spread-pips", type=float, default=1.5)
    parser.add_argument("--max-chase-pips", type=float, default=3.0)
    parser.add_argument("--max-open", type=int, default=3)
    parser.add_argument("--max-trades-per-day", type=int, default=10)
    parser.add_argument("--max-daily-loss", type=float, default=5.0)
    parser.add_argument("--cooldown", type=int, default=120)
    parser.add_argument("--ema-period", type=int, default=20, help="0 = matikan filter EMA M1")
    parser.add_argument("--friday-close-hour", type=int, default=16, help="jam UTC Jumat berhenti entry")
    parser.add_argument("--ignore-session", action="store_true",
                        help="abai filter jam sesi (untuk uji dry-run di luar jam)")
    parser.add_argument("--news", default=str(BASE_DIR / "data" / "calendar.json"),
                        help="path lokal atau URL calendar.json")
    parser.add_argument("--news-window", type=int, default=30, help="menit blackout sebelum/sesudah news")
    parser.add_argument("--news-vol-factor", type=float, default=1.5,
                        help="pengali grid/SL/TP setelah news impact>=3")
    parser.add_argument("--news-vol-window", type=int, default=60,
                        help="menit setelah event impact>=3 untuk mode volatilitas")
    parser.add_argument("--deviation", type=int, default=20, help="slippage maks dalam points")
    parser.add_argument("--path", default=None, help="path terminal MT5 opsional")
    parser.add_argument("--state", default=str(BASE_DIR / "bridge" / "grid_state.json"))
    parser.add_argument("--log", default=str(BASE_DIR / "bridge" / "grid_orders.csv"))
    return parser.parse_args()


def main():
    args = parse_args()
    pairs = [p.strip() for p in args.pairs.split(",") if p.strip()]
    unknown = [p for p in pairs if p not in PAIR_SYMBOLS]
    if unknown:
        raise SystemExit(f"Pair tidak dikenal: {', '.join(unknown)}")
    if args.scale_out:
        if args.tp1_pips is None:
            args.tp1_pips = args.sl_pips
        if not 0 < args.tp1_pips < args.tp_pips:
            raise SystemExit("--tp1-pips harus > 0 dan < --tp-pips")

    state = load_json(args.state, {}) or {}
    state.setdefault("be", {})
    state.setdefault("paper", [])
    state.setdefault("paper_seq", 0)
    state.setdefault("scale", {})
    state.setdefault("scale_seq", 0)
    state.setdefault("last_trade", {})
    state.setdefault("open_tickets", [])
    state["pairs"] = {}

    connect(args.path, args.enable)
    print(f"Pair: {', '.join(pairs)} | grid={args.grid_pips:g}p SL={args.sl_pips:g}p "
          f"TP={args.tp_pips:g}p BE=+{args.be_trigger_pips:g}p lot={args.lot:g} | "
          f"max {args.max_open} open, {args.max_trades_per_day} trade/hari, "
          f"rugi max ${args.max_daily_loss:g}/hari", flush=True)
    if args.scale_out:
        print(f"SCALE-OUT: 2 leg @ {args.lot:g} (total {2 * args.lot:g}); "
              f"TP1 +{args.tp1_pips:g}p -> SL leg B ke BE -> TP2 +{args.tp_pips:g}p. "
              f"Risiko per sinyal ~2x dan max-open menghitung tiap leg.", flush=True)
    print(f"News: {args.news} | blackout ±{args.news_window} mnt | "
          f"volatilitas x{args.news_vol_factor:g} selama {args.news_vol_window} mnt "
          f"setelah event impact>=3", flush=True)
    account = mt5.account_info()
    live = bool(args.enable and account is not None and account.trade_mode == 0)

    news = []
    news_at = 0.0
    connected = True
    last_save = 0.0
    try:
        while True:
            if not ensure_connected(args.path):
                connected = False
                state["pairs"] = {}
                time.sleep(5)
                continue
            if not connected:
                state["pairs"] = {}
                connected = True
            now = datetime.now(timezone.utc)
            account = mt5.account_info()
            if account is None:
                time.sleep(1)
                continue
            equity = float(account.equity)
            day = roll_day(state, now, equity)
            if guard_tripped(day, equity, args.max_daily_loss) and not day.get("stopped"):
                day["stopped"] = True
                print(f"[{now:%H:%M:%S}Z] GUARD: equity {equity:.2f} turun >= "
                      f"${args.max_daily_loss:g} dari {float(day['start_equity']):.2f}; "
                      f"stop entry baru sampai UTC midnight.", flush=True)
            if time.time() - news_at > 300:
                news = load_news(args.news)
                news_at = time.time()
                print(f"news: {len(news)} event dimuat.", flush=True)

            contexts = {}
            for pair in pairs:
                ctx = pair_context(pair)
                if ctx is not None:
                    contexts[pair] = ctx

            positions = magic_positions()
            if live:
                manage_be(args, state, now)
                if state.get("scale"):
                    manage_scale_real(args, state, positions, now)
            sync_closes(args, state, positions)
            if not live:
                manage_paper(args, state, contexts, now)

            open_symbols = {p.symbol for p in positions}
            open_symbols |= {p.get("symbol") for p in state.get("paper") or []}
            open_count = len(positions) + len(state.get("paper") or [])
            entered = 0
            for pair, ctx in contexts.items():
                if maybe_enter(args, state, ctx, day, now, news, live,
                               open_symbols, open_count):
                    entered += 1
                    open_count += 2 if args.scale_out else 1
                    if live:
                        open_symbols.add(ctx["symbol"])
            if entered:
                print(f"[{now:%H:%M:%S}Z] {entered} entry baru.", flush=True)

            if args.once or entered or time.time() - last_save > 5:
                save_state(args.state, state)
                last_save = time.time()
            if args.once:
                print_once(args, state, contexts, now, news, positions, day)
                break
            time.sleep(max(0.2, args.interval))
    except KeyboardInterrupt:
        print("Executor grid dihentikan; posisi terbuka tetap memakai SL/TP masing-masing.",
              flush=True)
    finally:
        save_state(args.state, state)
        mt5.shutdown()


if __name__ == "__main__":
    main()
