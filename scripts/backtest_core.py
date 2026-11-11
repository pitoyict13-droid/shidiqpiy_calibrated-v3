"""Pure historical simulator for the forex breakout-grid strategy.

Bars are mid-price OHLC in UTC; bid/ask come from one constant spread so the
live grid / SL / TP / BE / session / news rules can be replayed without
MetaTrader5.

Approximations (reported by grid_backtest.py):
- the live bot confirms a breakout after two one-second polls; here the
  confirmation is counted in closed bars (``confirm_bars``, default 2);
- when SL and TP are both inside one bar, SL is assumed first;
- a BE stop moved inside a bar protects from the next bar on;
- spread is constant, no swap / commission / slippage;
- entry is the bar close, not a tick-level fill.
"""

from datetime import datetime, timedelta, timezone

from grid_core import (
    be_price,
    grid_index,
    grid_level,
    guard_tripped,
    in_session,
    news_blackout,
    news_volatility,
    round_price,
    sl_tp,
    within_chase,
)

UTC = timezone.utc
NEWS_CURRENCIES = {"USD", "EUR", "GBP", "JPY"}


# ---------------------------------------------------------------- time base

def _last_sunday_utc(year, month):
    if month == 12:
        next_month = datetime(year + 1, 1, 1, 1, 0, tzinfo=UTC)
    else:
        next_month = datetime(year, month + 1, 1, 1, 0, tzinfo=UTC)
    day = next_month - timedelta(days=1)
    while day.weekday() != 6:
        day -= timedelta(days=1)
    return day


def europe_is_dst(moment):
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    year = moment.year
    start = _last_sunday_utc(year, 3)
    end = _last_sunday_utc(year, 10)
    return start <= moment < end


def server_epoch_to_utc(epoch, fixed_offset=None):
    """Convert an MT5 server-time epoch (GMT+2/+3, EU DST) to a UTC epoch."""
    if fixed_offset is not None:
        return int(float(epoch) - float(fixed_offset) * 3600)
    guess = float(epoch) - 2 * 3600
    for _ in range(2):
        offset = 3 if europe_is_dst(datetime.fromtimestamp(guess, UTC)) else 2
        guess = float(epoch) - offset * 3600
    return int(guess)


# ------------------------------------------------------------------ signals

def signal_step(state, mid, step, confirm=2):
    """Mirror of the live bar-crossover signal, counted per closed bar."""
    if state.get("step") != step:
        state["step"] = step
        state["index"] = None
        state["pending"] = None
    index = grid_index(mid, step)
    prev = state.get("index")
    pending = state.get("pending")
    signal = None
    if prev is None:
        state["index"] = index
        state["pending"] = None
        return None
    if index != prev:
        direction = "long" if index > prev else "short"
        level = grid_level(index if direction == "long" else prev, step)
        pending = {"dir": direction, "index": index, "level": level,
                   "count": 1, "fired": False}
        if confirm <= 1:
            pending["fired"] = True
            signal = {"dir": direction, "level": level, "index": index}
    elif pending is not None and pending.get("index") == index:
        pending["count"] = int(pending.get("count") or 0) + 1
        if pending["count"] >= confirm and not pending.get("fired"):
            pending["fired"] = True
            signal = {"dir": pending["dir"], "level": pending["level"],
                      "index": index}
    else:
        pending = None
    state["pending"] = pending
    state["index"] = index
    return signal


def ema_ok(closes, index, period, direction):
    """Live EMA: last period+9 completed closes, seeded by the oldest one."""
    if index + 1 < period + 2:
        return False
    window = closes[max(0, index - (period + 8)):index + 1]
    ema = window[0]
    k = 2.0 / (period + 1)
    for close in window[1:]:
        ema = close * k + ema * (1 - k)
    if direction == "long":
        return closes[index] > ema
    return closes[index] < ema


# ------------------------------------------------------------------- exits

def advance_position(pos, bar, spread_pips, pip, digits, be_buffer_pips):
    """Check one bar against a position; returns (exit_price, status) or None.

    Mutates ``pos["sl"]`` / ``pos["be_done"]`` when BE triggers.
    """
    half = spread_pips * pip / 2.0
    direction = pos["dir"]
    be_status = "BE" if pos.get("be_done") else "SL"
    if direction == "long":
        bid_open, bid_high, bid_low = bar["o"] - half, bar["h"] - half, bar["l"] - half
        if bid_open <= pos["sl"]:
            return bid_open, be_status
        if bid_low <= pos["sl"]:
            return pos["sl"], be_status
        if bid_high >= pos["tp"]:
            return pos["tp"], "TP"
        if not pos.get("be_done") and bid_high >= pos["entry"] + pos["risk_dist"]:
            pos["sl"] = be_price(pos["entry"], "long", spread_pips,
                                 be_buffer_pips, pip, digits)
            pos["be_done"] = True
        return None
    ask_open, ask_high, ask_low = bar["o"] + half, bar["h"] + half, bar["l"] + half
    if ask_open >= pos["sl"]:
        return ask_open, be_status
    if ask_high >= pos["sl"]:
        return pos["sl"], be_status
    if ask_low <= pos["tp"]:
        return pos["tp"], "TP"
    if not pos.get("be_done") and ask_low <= pos["entry"] - pos["risk_dist"]:
        pos["sl"] = be_price(pos["entry"], "short", spread_pips,
                             be_buffer_pips, pip, digits)
        pos["be_done"] = True
    return None


def advance_scale_position(pos, bar, spread_pips, pip, digits, be_buffer_pips):
    """One bar of a scale-out position: partial at tp1, stop to BE, runner to tp.

    Returns None while nothing happens, a dict with ``exit=None`` on the bar
    tp1 fills, or a dict with an ``exit`` price when the position closes. The
    caller books the partial fraction in USD using ``tp1_fill``. As in the
    standard path, the stop is checked before targets and BE is active from
    the next bar.
    """
    half = spread_pips * pip / 2.0
    be_status = "BE" if pos.get("be_done") else "SL"
    if pos["dir"] == "long":
        bid_open, bid_high, bid_low = bar["o"] - half, bar["h"] - half, bar["l"] - half
        if bid_open <= pos["sl"]:
            return {"exit": bid_open, "status": be_status, "new_partial": False}
        if bid_low <= pos["sl"]:
            return {"exit": pos["sl"], "status": be_status, "new_partial": False}
        new_partial = False
        if not pos.get("tp1_done") and bid_high >= pos["tp1"]:
            pos["tp1_done"] = True
            pos["tp1_fill"] = pos["tp1"]
            pos["sl"] = be_price(pos["entry"], "long", spread_pips,
                                 be_buffer_pips, pip, digits)
            pos["be_done"] = True
            new_partial = True
        if bid_high >= pos["tp"]:
            return {"exit": pos["tp"], "status": "TP", "new_partial": new_partial}
    else:
        ask_open, ask_high, ask_low = bar["o"] + half, bar["h"] + half, bar["l"] + half
        if ask_open >= pos["sl"]:
            return {"exit": ask_open, "status": be_status, "new_partial": False}
        if ask_high >= pos["sl"]:
            return {"exit": pos["sl"], "status": be_status, "new_partial": False}
        new_partial = False
        if not pos.get("tp1_done") and ask_low <= pos["tp1"]:
            pos["tp1_done"] = True
            pos["tp1_fill"] = pos["tp1"]
            pos["sl"] = be_price(pos["entry"], "short", spread_pips,
                                 be_buffer_pips, pip, digits)
            pos["be_done"] = True
            new_partial = True
        if ask_low <= pos["tp"]:
            return {"exit": pos["tp"], "status": "TP", "new_partial": new_partial}
    if new_partial:
        return {"exit": None, "status": "OPEN", "new_partial": True}
    return None


def pnl_usd(cfg, pair, direction, entry, exit_price, usdjpy_mid):
    diff = (exit_price - entry) if direction == "long" else (entry - exit_price)
    usd = diff * float(cfg["contract"][pair]) * float(cfg["lot"])
    if str(cfg["quote_ccy"][pair]).upper() == "JPY":
        usd /= float(usdjpy_mid or 1.0)
    return usd


# -------------------------------------------------------------- simulation

def simulate(bars_by_pair, cfg):
    """Replay the strategy over one merged bar timeline.

    ``bars_by_pair``: {pair: [{"t", "o", "h", "l", "c"}, ...]} sorted by t,
    timestamps already in UTC epoch seconds.
    Returns a result dict with closed trades, still-open positions, skip
    counters and the final balance.
    """
    pairs = list(bars_by_pair)
    closes_by_pair = {p: [float(b["c"]) for b in bars] for p, bars in bars_by_pair.items()}
    timeline = []
    for pair, bars in bars_by_pair.items():
        for j, bar in enumerate(bars):
            timeline.append((int(bar["t"]), pair, j, bar))
    timeline.sort(key=lambda row: (row[0], row[1]))

    grid = {p: {"step": None, "index": None, "pending": None} for p in pairs}
    positions, closed = [], []
    last_mid, last_trade = {}, {}
    balance = float(cfg["balance"])
    day = {"date": None, "start_equity": balance, "trades": 0,
           "stopped": False, "blocked": {}}
    skips = {"session": 0, "guard": 0, "stopped": 0, "open_pair": 0,
             "max_open": 0, "max_trades": 0, "cooldown": 0,
             "blocked_level": 0, "news": 0, "spread": 0, "chase": 0,
             "ema": 0}
    news_blocked_by_date = {}
    half_pips = float(cfg["spread_pips"]) / 2.0

    scale_out = bool(cfg.get("scale_out"))
    tp1_fraction = float(cfg.get("tp1_fraction", 0.5))
    tp1_pips = float(cfg.get("tp1_pips", cfg["sl_pips"]))
    if scale_out:
        if not 0.0 < tp1_fraction < 1.0:
            raise ValueError("tp1_fraction harus di antara 0 dan 1")
        if not 0.0 < tp1_pips < float(cfg["tp_pips"]):
            raise ValueError("tp1_pips harus > 0 dan < tp_pips")

    def floating_usd(pos):
        mid = last_mid.get(pos["pair"])
        if mid is None:
            return 0.0
        pip = float(cfg["pip"][pos["pair"]])
        est = mid - half_pips * pip if pos["dir"] == "long" else mid + half_pips * pip
        remaining = (1.0 - tp1_fraction) if pos.get("partial_done") else 1.0
        return float(pos.get("partial_pnl", 0.0)) + pnl_usd(
            cfg, pos["pair"], pos["dir"], pos["entry"], est,
            last_mid.get("USD/JPY") or mid) * remaining

    i, n = 0, len(timeline)
    while i < n:
        t = timeline[i][0]
        group = []
        while i < n and timeline[i][0] == t:
            group.append((timeline[i][1], timeline[i][2], timeline[i][3]))
            i += 1
        now = datetime.fromtimestamp(t, UTC)

        if day["date"] != now.strftime("%Y-%m-%d"):
            start_equity = balance + sum(floating_usd(p) for p in positions)
            day = {"date": now.strftime("%Y-%m-%d"), "start_equity": start_equity,
                   "trades": 0, "stopped": False, "blocked": {}}
        if not day["stopped"] and guard_tripped(
                day, balance + sum(floating_usd(p) for p in positions),
                cfg["max_loss"]):
            day["stopped"] = True
            skips["guard"] += 1

        for pair, _j, bar in group:
            last_mid[pair] = float(bar["c"])

        kept = []
        for pos in positions:
            bar = next((b for p, _j, b in group if p == pos["pair"]), None)
            if bar is None:
                kept.append(pos)
                continue
            pip = float(cfg["pip"][pos["pair"]])
            digits = int(cfg["digits"][pos["pair"]])
            if scale_out:
                result = advance_scale_position(
                    pos, bar, cfg["spread_pips"], pip, digits,
                    cfg["be_buffer_pips"])
                if result is None:
                    kept.append(pos)
                    continue
                if result["new_partial"]:
                    pos["partial_pnl"] = pnl_usd(
                        cfg, pos["pair"], pos["dir"], pos["entry"],
                        pos["tp1_fill"],
                        last_mid.get("USD/JPY") or last_mid.get(pos["pair"])
                    ) * tp1_fraction
                    pos["partial_done"] = True
                if result["exit"] is None:
                    kept.append(pos)
                    continue
                exit_price, status = result["exit"], result["status"]
                remaining = 1.0 - tp1_fraction if pos.get("partial_done") else 1.0
                usd = float(pos.get("partial_pnl", 0.0)) + pnl_usd(
                    cfg, pos["pair"], pos["dir"], pos["entry"], exit_price,
                    last_mid.get("USD/JPY") or last_mid.get(pos["pair"])
                ) * remaining
                partial = bool(pos.get("partial_done"))
            else:
                result = advance_position(
                    pos, bar, cfg["spread_pips"], pip, digits,
                    cfg["be_buffer_pips"])
                if result is None:
                    kept.append(pos)
                    continue
                exit_price, status = result
                usd = pnl_usd(cfg, pos["pair"], pos["dir"], pos["entry"],
                              exit_price,
                              last_mid.get("USD/JPY") or last_mid.get(pos["pair"]))
                partial = False
            balance += usd
            closed.append({
                "pair": pos["pair"], "dir": pos["dir"], "entry": pos["entry"],
                "exit": exit_price, "sl": pos["sl"], "tp": pos["tp"],
                "level": pos["level"], "lot": cfg["lot"], "pnl": usd,
                "status": status, "factor": pos["factor"],
                "partial": partial,
                "opened_t": pos["opened_t"], "closed_t": t,
                "opened_at": pos["opened_at"], "closed_at": now.isoformat(timespec="minutes"),
                "opened_date": pos["opened_at"][:10],
                "closed_date": now.strftime("%Y-%m-%d"),
            })
            if not day["stopped"] and balance <= day["start_equity"] - cfg["max_loss"]:
                day["stopped"] = True
                skips["guard"] += 1
        positions = kept

        for pair, j, bar in group:
            pip = float(cfg["pip"][pair])
            digits = int(cfg["digits"][pair])
            mid = float(bar["c"])
            factor = 1.0
            if cfg["use_news"] and cfg["news"]:
                event = news_volatility(cfg["news"], NEWS_CURRENCIES, now,
                                        cfg["vol_window"])
                if event:
                    factor = float(cfg["vol_factor"])
            step = cfg["grid_pips"] * pip * factor
            signal = signal_step(grid[pair], mid, step, cfg["confirm_bars"])
            if signal is None:
                continue
            if not cfg["ignore_session"] and not in_session(now, cfg["friday_close_hour"]):
                skips["session"] += 1
                continue
            if day["stopped"]:
                skips["stopped"] += 1
                continue
            if day["trades"] >= cfg["max_trades_day"]:
                skips["max_trades"] += 1
                continue
            if any(p["pair"] == pair for p in positions):
                skips["open_pair"] += 1
                continue
            if len(positions) >= cfg["max_open"]:
                skips["max_open"] += 1
                continue
            last = last_trade.get(pair)
            if last is not None and t - last < cfg["cooldown"]:
                skips["cooldown"] += 1
                continue
            direction, level = signal["dir"], signal["level"]
            key = f"{float(level):.{digits}f}"
            if key in day["blocked"].get(pair, ()):
                skips["blocked_level"] += 1
                continue
            if cfg["use_news"] and cfg["news"]:
                if news_blackout(cfg["news"], NEWS_CURRENCIES, now,
                                 cfg["news_window"]):
                    skips["news"] += 1
                    news_blocked_by_date[day["date"]] = \
                        news_blocked_by_date.get(day["date"], 0) + 1
                    continue
            if float(cfg["spread_pips"]) > float(cfg["max_spread_pips"]):
                skips["spread"] += 1
                continue
            if not within_chase(mid, level, cfg["chase_pips"], pip):
                skips["chase"] += 1
                continue
            if cfg["ema_period"] > 0 and not ema_ok(
                    closes_by_pair[pair], j, cfg["ema_period"], direction):
                skips["ema"] += 1
                continue
            entry = mid + half_pips * pip if direction == "long" else mid - half_pips * pip
            sl, tp = sl_tp(entry, direction, cfg["sl_pips"] * factor,
                           cfg["tp_pips"] * factor, pip)
            positions.append({
                "pair": pair, "dir": direction, "entry": entry,
                "sl": round_price(sl, digits), "tp": round_price(tp, digits),
                "level": level, "risk_dist": abs(entry - sl), "factor": factor,
                "be_done": False, "opened_t": t,
                "opened_at": now.isoformat(timespec="minutes"),
                **({"tp1": round_price(
                        entry + tp1_pips * pip if direction == "long"
                        else entry - tp1_pips * pip, digits),
                    "tp1_done": False, "tp1_fraction": tp1_fraction,
                    "partial_done": False, "partial_pnl": 0.0}
                   if scale_out else {}),
            })
            day["trades"] += 1
            last_trade[pair] = t
            day["blocked"].setdefault(pair, []).append(key)

    open_positions = []
    for pos in positions:
        usd = floating_usd(pos)
        open_positions.append({
            "pair": pos["pair"], "dir": pos["dir"], "entry": pos["entry"],
            "sl": pos["sl"], "tp": pos["tp"], "status": "OPEN",
            "pnl": usd, "opened_at": pos["opened_at"],
        })
    return {"trades": closed, "open": open_positions, "skips": skips,
            "news_blocked_by_date": news_blocked_by_date,
            "final_balance": balance}


# ---------------------------------------------------------------- reporting

def summarize(trades):
    n = len(trades)
    wins = [t["pnl"] for t in trades if t["pnl"] > 0]
    losses = [t["pnl"] for t in trades if t["pnl"] < 0]
    status = {name: sum(1 for t in trades if t["status"] == name)
              for name in ("TP", "SL", "BE")}
    partial = sum(1 for t in trades if t.get("partial"))
    gross_win = sum(wins)
    gross_loss = -sum(losses)
    equity = peak = drawdown = 0.0
    for trade in trades:
        equity += trade["pnl"]
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    days = {}
    for trade in trades:
        days[trade["closed_date"]] = days.get(trade["closed_date"], 0.0) + trade["pnl"]
    return {
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "winrate": (len(wins) / n * 100.0) if n else 0.0,
        "tp_rate": (status["TP"] / n * 100.0) if n else 0.0,
        "status": status,
        "partial": partial,
        "partial_rate": (partial / n * 100.0) if n else 0.0,
        "pnl": sum(t["pnl"] for t in trades),
        "expectancy": (sum(t["pnl"] for t in trades) / n) if n else 0.0,
        "avg_win": (gross_win / len(wins)) if wins else 0.0,
        "avg_loss": (gross_loss / len(losses)) if losses else 0.0,
        "profit_factor": (gross_win / gross_loss) if gross_loss else None,
        "max_drawdown": drawdown,
        "days_with_trades": len(days),
        "best_day": max(days.values()) if days else 0.0,
        "worst_day": min(days.values()) if days else 0.0,
    }


def summarize_by_pair(trades):
    pairs = sorted({t["pair"] for t in trades})
    return {pair: summarize([t for t in trades if t["pair"] == pair]) for pair in pairs}


def subset_by_dates(trades, dates):
    wanted = set(dates)
    return [t for t in trades if t.get("opened_date") in wanted]
