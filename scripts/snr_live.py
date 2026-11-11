"""Live SnR LNY executor (DEMO ONLY when --enable is used).

Mirrors pineSnR.txt: on every closed bar the full Pine state machine is
replayed with scripts/snr_core.py, then the broker is aligned with the state:
new pending limit at the breakout level, re-anchor, cancel, or market entry.
SL/TP live at the broker. One instance per pair/preset (PID file).

Default is PAPER mode: signals are logged, no orders are sent. `--enable`
sends real orders and is refused unless the terminal account is DEMO.

Usage:
    python scripts/snr_live.py                          # paper XAU C1
    python scripts/snr_live.py --enable --risk-usd 45   # demo orders, 0.01 lot
    python scripts/snr_live.py --once                   # evaluate last bar, exit

This script never closes positions it did not open (magic filter) and never
closes an open position except the strategy's own Friday rule (C4/C5).
"""

import argparse
import csv
import json
import os
import re
import subprocess
import time
from bisect import bisect_left
from datetime import datetime, timedelta

import MetaTrader5 as mt5

from backtest_core import server_epoch_to_utc
from mt5_bridge import BASE_DIR, PAIR_SYMBOLS, resolve_symbol
from snr_core import (ET, PRESETS, align_prev_atr, atr_series, build_asset,
                      build_events, ema_series, ms_flags, prepare, simulate)

MAGIC = 771001
OUTDIR = BASE_DIR / "bridge" / "snr"
STATE_PATH = OUTDIR / "live_state.json"
LOG_PATH = OUTDIR / "live.log"
TRADES_PATH = OUTDIR / "live_trades.csv"
FEAT_PATH = OUTDIR / "live_features.csv"
PID_PATH = OUTDIR / "live.pid"
FEAT_FIELDS = ["preset", "symbol", "source", "entry_et", "hour_et", "dow", "dir",
               "grid_pts", "sl_dist", "r", "exit_et", "hold_min", "exit_code",
               "atr_d1", "atr_pctile", "close_ema_atr", "ema_slope_atr",
               "ms_bull", "ms_bear", "min_to_news", "news60", "win_off_min",
               "is_fri", "spread_pts", "net_r_est"]
FEAT_KEYS: set[str] = set()
TF_MT5 = {"M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1}
TF_MIN = {"M15": 15, "M30": 30, "H1": 60}
TF_FOR = {"C1": "M30", "C2": "M30", "C4": "M15", "C5": "H1"}
RET_OK = (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, mt5.TRADE_RETCODE_DONE_PARTIAL)


def log(msg):
    line = f"{datetime.now(ET):%Y-%m-%d %H:%M:%S} ET | {msg}"
    print(line, flush=True)
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def parse_args():
    ap = argparse.ArgumentParser(description="Executor SnR LNY (demo-only untuk --enable)")
    ap.add_argument("--pair", default="XAU/USD")
    ap.add_argument("--preset", default="C1", choices=sorted(PRESETS))
    ap.add_argument("--risk-usd", type=float, default=45.0,
                    help="risiko per trade (default 45 = 0,9%% dari $5.000)")
    ap.add_argument("--lot", type=float, default=0.0, help="override lot (0 = dari risiko)")
    ap.add_argument("--max-lot", type=float, default=0.02)
    ap.add_argument("--bars", type=int, default=20000)
    ap.add_argument("--poll", type=float, default=5.0)
    ap.add_argument("--enable", action="store_true", help="kirim order nyata ke akun DEMO")
    ap.add_argument("--once", action="store_true", help="evaluasi 1 bar lalu keluar (paper)")
    ap.add_argument("--force", action="store_true", help="abaikan PID file yang ada")
    ap.add_argument("--path", default=None)
    return ap.parse_args()


def load_news_text():
    text = (BASE_DIR / "pineSnR.txt").read_text(encoding="utf-8")
    i = text.find("string BUILTIN")
    j = text.find("\n\n", i if i >= 0 else 0)
    return "\n".join(re.findall(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z]+",
                                text[i:j if j > 0 else len(text)]))


def parse_news_times(text):
    out = []
    for line in text.split("\n"):
        m = re.match(r"(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})", line.strip())
        if not m:
            continue
        y, mo, d, hh, mm = (int(x) for x in m.groups())
        out.append(int(datetime(y, mo, d, hh, mm, tzinfo=ET).timestamp()))
    return sorted(out)


def load_feat_keys():
    keys = set()
    if not FEAT_PATH.exists():
        return keys
    try:
        with FEAT_PATH.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                dt = datetime.strptime(row["entry_et"], "%Y-%m-%d %H:%M").replace(tzinfo=ET)
                keys.add(f"{int(dt.timestamp())}|{int(row['dir'])}")
    except (OSError, ValueError, KeyError):
        pass
    return keys


def fetch(symbol, tf, count):
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    if rates is None or len(rates) == 0:
        return []
    return [(server_epoch_to_utc(int(r["time"])), float(r["open"]), float(r["high"]),
             float(r["low"]), float(r["close"])) for r in rates]


def closed_bars(bars, tf_min, now=None):
    now = time.time() if now is None else now
    return [b for b in bars if b[0] + tf_min * 60 <= now + 5]


def quote_to_usd(symbol):
    info = mt5.symbol_info(symbol)
    if info is None:
        return 1.0
    cur = (info.currency_profit or "USD").upper()
    if cur == "USD":
        return 1.0
    for other in (f"{cur}USD", f"USD{cur}"):
        oi = mt5.symbol_info(other)
        if oi:
            t = mt5.symbol_info_tick(other)
            if t and t.bid:
                return float(t.bid) if other == f"{cur}USD" else 1.0 / float(t.bid)
    log(f"PERINGATAN: kurs {cur}->USD tidak ditemukan, dipakai 1.0")
    return 1.0


def lot_for(info, sl_dist, args, rate):
    if args.lot > 0:
        return max(info.volume_min, min(args.lot, args.max_lot))
    risk_per_lot = sl_dist * info.trade_contract_size * rate
    if risk_per_lot <= 0:
        return 0.0
    step = info.volume_step or 0.01
    raw = args.risk_usd / risk_per_lot
    lot = int(raw / step + 1e-9) * step
    lot = min(lot, args.max_lot)
    if lot + 1e-12 < info.volume_min:
        return 0.0
    return round(lot, 8)


def filling_mode(info, pending=False):
    if pending:
        return mt5.ORDER_FILLING_RETURN
    flags = getattr(info, "filling_mode", 0)
    if flags & 2:
        return mt5.ORDER_FILLING_IOC
    if flags & 1:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


def pos_and_orders(symbol):
    positions = [p for p in (mt5.positions_get(symbol=symbol) or []) if p.magic == MAGIC]
    orders = [o for o in (mt5.orders_get(symbol=symbol) or []) if o.magic == MAGIC]
    return positions, orders


def send_pending(symbol, info, direction, level, sl, tp, lot, tag):
    req = {"action": mt5.TRADE_ACTION_PENDING, "symbol": symbol, "volume": lot,
           "type": mt5.ORDER_TYPE_BUY_LIMIT if direction > 0 else mt5.ORDER_TYPE_SELL_LIMIT,
           "price": round(level, info.digits),
           "sl": round(sl, info.digits), "tp": round(tp, info.digits),
           "magic": MAGIC, "comment": tag[:26], "type_time": mt5.ORDER_TIME_GTC,
           "type_filling": filling_mode(info, pending=True)}
    res = mt5.order_send(req)
    log(f"ORDER LIMIT {'BUY' if direction > 0 else 'SELL'} {lot:.2f} @ {req['price']} "
        f"SL {req['sl']} TP {req['tp']} -> {getattr(res, 'retcode', 'n/a')} "
        f"{getattr(res, 'comment', '')}")
    return res is not None and res.retcode in RET_OK


def send_market(symbol, info, direction, sl, tp, lot, tag):
    tick = mt5.symbol_info_tick(symbol)
    price = tick.ask if direction > 0 else tick.bid
    req = {"action": mt5.TRADE_ACTION_DEAL, "symbol": symbol, "volume": lot,
           "type": mt5.ORDER_TYPE_BUY if direction > 0 else mt5.ORDER_TYPE_SELL,
           "price": round(price, info.digits),
           "sl": round(sl, info.digits), "tp": round(tp, info.digits),
           "deviation": 30, "magic": MAGIC, "comment": tag[:26],
           "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling_mode(info)}
    res = mt5.order_send(req)
    log(f"ORDER MARKET {'BUY' if direction > 0 else 'SELL'} {lot:.2f} @ {req['price']} "
        f"SL {req['sl']} TP {req['tp']} -> {getattr(res, 'retcode', 'n/a')} "
        f"{getattr(res, 'comment', '')}")
    return res is not None and res.retcode in RET_OK


def modify_pending(order, info, level, sl, tp):
    req = {"action": mt5.TRADE_ACTION_MODIFY, "order": order.ticket,
           "price": round(level, info.digits),
           "sl": round(sl, info.digits), "tp": round(tp, info.digits),
           "magic": MAGIC, "type_time": mt5.ORDER_TIME_GTC}
    res = mt5.order_send(req)
    log(f"MODIFY #{order.ticket} -> {req['price']} ({getattr(res, 'retcode', 'n/a')} "
        f"{getattr(res, 'comment', '')})")
    return res is not None and res.retcode in RET_OK


def cancel_pending(order):
    res = mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": order.ticket})
    log(f"CANCEL #{order.ticket} ({getattr(res, 'retcode', 'n/a')} "
        f"{getattr(res, 'comment', '')})")


def close_position(pos, info, reason):
    tick = mt5.symbol_info_tick(pos.symbol)
    req = {"action": mt5.TRADE_ACTION_DEAL, "symbol": pos.symbol, "volume": pos.volume,
           "type": mt5.ORDER_TYPE_SELL if pos.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY,
           "position": pos.ticket,
           "price": tick.bid if pos.type == mt5.POSITION_TYPE_BUY else tick.ask,
           "deviation": 30, "magic": MAGIC, "comment": ("SnR " + reason)[:26],
           "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling_mode(info)}
    res = mt5.order_send(req)
    log(f"CLOSE #{pos.ticket} ({reason}) -> {getattr(res, 'retcode', 'n/a')} "
        f"{getattr(res, 'comment', '')}")
    return res is not None and res.retcode in RET_OK


def load_state():
    try:
        with STATE_PATH.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    try:
        with STATE_PATH.open("w", encoding="utf-8") as f:
            json.dump(state, f, indent=1)
    except OSError as exc:
        log(f"gagal simpan state: {exc}")


def append_trade(row):
    new = not TRADES_PATH.exists()
    with TRADES_PATH.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(row.keys()))
        if new:
            w.writeheader()
        w.writerow(row)


def _pid_alive(pid):
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                             capture_output=True, text=True, timeout=5).stdout
        return str(pid) in out
    except OSError:
        return False


def pid_guard(force):
    if PID_PATH.exists() and not force:
        try:
            pid = int(PID_PATH.read_text().strip())
            if _pid_alive(pid):
                raise SystemExit(f"Executor sudah jalan (PID {pid}). Pakai --force bila yakin.")
        except (ValueError, OSError):
            pass
    PID_PATH.write_text(str(os.getpid()))


def position_deals(ticket):
    try:
        deals = mt5.history_deals_get(position=ticket)
    except TypeError:
        deals = None
    if not deals:
        deals = mt5.history_deals_get(datetime.now() - timedelta(days=14),
                                      datetime.now() + timedelta(days=1)) or []
        deals = [d for d in deals if d.position_id == ticket]
    return list(deals)


def friday_close_due(asset, preset, now_et):
    return (preset.friday == "CLOSE" and now_et.weekday() == 4
            and (now_et.hour, now_et.minute) >= (16, 30))


def build_context(symbol, asset, preset, args):
    tf_min = TF_MIN[TF_FOR[preset.name]]
    bars = closed_bars(fetch(symbol, TF_MT5[TF_FOR[preset.name]], args.bars), tf_min)
    if len(bars) < 400:
        return None
    d1 = fetch(symbol, mt5.TIMEFRAME_D1, 1200)
    d1_atr = atr_series(d1, 14) if d1 else []
    prep = prepare(bars, asset, tf_min)
    ema = ema_series([b[4] for b in bars], preset.ema_len)
    bull, bear = ms_flags([b[2] for b in bars], [b[3] for b in bars], 5)
    atr_prev = align_prev_atr([b[0] for b in bars], [b[0] for b in d1], d1_atr)
    events = build_events(load_news_text())
    res = simulate("", preset, asset, prep, atr_prev, ema, bull, bear, events, 0)
    return {"bars": bars, "res": res, "tf_min": tf_min, "prep": prep, "ema": ema,
            "bull": bull, "bear": bear, "atr_prev": atr_prev,
            "news_ts": parse_news_times(load_news_text())}


def log_features(ctx, symbol, asset, preset, info, state):
    started = int(state.get("started_t") or 0)
    prep, ema, atrv = ctx["prep"], ctx["ema"], ctx["atr_prev"]
    bull, bear, news = ctx["bull"], ctx["bear"], ctx["news_ts"]
    tick = asset.tick
    spread_pts = float(getattr(info, "spread", 0) or 0)
    rows = []
    for tr in ctx["res"]["trades"]:
        key = f"{int(tr['fill_t'])}|{int(tr['dir'])}"
        if key in FEAT_KEYS:
            continue
        i = bisect_left(prep.t, int(tr["fill_t"]))
        if i >= len(prep.t) or prep.t[i] != int(tr["fill_t"]):
            continue
        a = atrv[i] if i < len(atrv) else None
        e = ema[i] if i < len(ema) else None
        es = ema[i - 5] if i >= 5 else None
        pct = None
        if a:
            vals = [v for v in atrv[max(0, i - 500):i + 1] if v]
            if vals:
                pct = round(100.0 * sum(1 for v in vals if v <= a) / len(vals), 1)
        nmin = 1440.0
        if news:
            j = bisect_left(news, tr["fill_t"])
            for k in (j - 1, j):
                if 0 <= k < len(news):
                    nmin = min(nmin, abs(news[k] - tr["fill_t"]) / 60.0)
        src = "live" if tr["fill_t"] >= started else "backfill"
        net = ""
        if src == "live":
            net = round(tr["r"] - (spread_pts * tick / tr["sl_dist"]), 4)
        rows.append({
            "preset": preset.name, "symbol": symbol, "source": src,
            "entry_et": f"{datetime.fromtimestamp(tr['fill_t'], ET):%Y-%m-%d %H:%M}",
            "hour_et": datetime.fromtimestamp(tr["fill_t"], ET).hour,
            "dow": datetime.fromtimestamp(tr["fill_t"], ET).weekday(),
            "dir": tr["dir"], "grid_pts": round(tr["grid_px"] / tick),
            "sl_dist": round(tr["sl_dist"], 2), "r": round(tr["r"], 4),
            "exit_et": f"{datetime.fromtimestamp(tr['exit_t'], ET):%Y-%m-%d %H:%M}",
            "hold_min": round((tr["exit_t"] - tr["fill_t"]) / 60.0, 1),
            "exit_code": tr["code"],
            "atr_d1": round(a, 2) if a else "",
            "atr_pctile": pct if pct is not None else "",
            "close_ema_atr": round((prep.c[i] - e) / a, 3) if (a and e) else "",
            "ema_slope_atr": round((e - es) / a, 3) if (a and e and es) else "",
            "ms_bull": int(bool(bull[i])), "ms_bear": int(bool(bear[i])),
            "min_to_news": round(nmin), "news60": int(nmin <= 60),
            "win_off_min": prep.off[i], "is_fri": int(prep.is_fri[i]),
            "spread_pts": int(spread_pts) if src == "live" else "",
            "net_r_est": net,
        })
        FEAT_KEYS.add(key)
    if not rows:
        return
    new = not FEAT_PATH.exists()
    with FEAT_PATH.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FEAT_FIELDS)
        if new:
            w.writeheader()
        w.writerows(rows)
    log(f"FITUR: {len(rows)} trade dicatat ({rows[-1]['source']}) -> {FEAT_PATH.name}")


def process_new_bar(symbol, info, asset, preset, args, ctx, state, live):
    bars = ctx["bars"]
    res = ctx["res"]
    s = res["state"]
    T = bars[-1][0]
    tag = f"SnR {preset.name}"
    positions, orders = pos_and_orders(symbol)
    pos = positions[0] if positions else None
    pend = orders[0] if orders else None
    price = mt5.symbol_info_tick(symbol)
    k = 1.0 if live else 0.0
    state["last_bar_t"] = T
    state["sl_dist"] = s["sl_dist"]
    save_state(state)
    log(f"BAR CLOSE {datetime.fromtimestamp(T, ET):%Y-%m-%d %H:%M} | st={s['st']} "
        f"dir={s['dir']} def={s['def_kind']}@{s['def_lvl']} ent={s['ent']:.2f} "
        f"grid={s['grid_px']:.2f} slDist={s['sl_dist']:.2f} mkt={s['mkt_pts']} "
        f"pos={'#'+str(pos.ticket) if pos else '-'} pend={'#'+str(pend.ticket) if pend else '-'}")

    # --- broker/simulation reconciliation
    if s["st"] == 2 and pos is None:
        log("PERINGATAN: simulasi punya posisi, broker tidak (fill terlewat?)")
        if pend:
            cancel_pending(pend)
        pend = None
    if s["st"] != 2 and pos is not None:
        log("PERINGATAN: broker punya posisi tapi simulasi tidak; dibiarkan (SL/TP broker)")
    last_tr = s.get("last_trade") or {}
    if (pos is not None and preset.friday == "CLOSE" and last_tr.get("exit_t") == T
            and last_tr.get("code") == "JUMAT"):
        close_position(pos, info, "JUMAT")
        pos = None

    # --- Friday guard for CLOSE presets (C4/C5) even without a sim exit
    now_et = datetime.now(ET)
    if pos is not None and friday_close_due(asset, preset, now_et):
        close_position(pos, info, "JUMAT")
        pos = None

    # --- pending alignment
    bar_open = T + ctx["tf_min"] * 60
    late = time.time() - bar_open > 90

    def dist_to(lvl, d):
        px = price.ask if d > 0 else price.bid
        return round((px - lvl) / asset.tick) if d > 0 else round((lvl - px) / asset.tick)

    def place_limit(d, lvl, lot):
        sl = lvl - d * s["sl_dist"]
        tp = lvl + d * s["tp_dist"]
        if k:
            send_pending(symbol, info, d, lvl, sl, tp, lot, tag)
        else:
            log(f"PAPER: LIMIT {'BUY' if d > 0 else 'SELL'} {lot:.2f} @ {lvl:.2f} "
                f"SL {sl:.2f} TP {tp:.2f}")

    def cancel_now(o):
        if k:
            cancel_pending(o)
        else:
            log(f"PAPER: CANCEL #{o.ticket}")

    if s["def_kind"] != 0:
        d = s["def_dir"]
        lvl = s["def_lvl"] * asset.tick
        lot = lot_for(info, s["sl_dist"], args, quote_to_usd(symbol))
        dist_pts = dist_to(lvl, d)
        if lot <= 0:
            log(f"sinyal dilewati: lot < minimum (SL {s['sl_dist']:.2f})")
            if pend:
                cancel_now(pend)
        elif dist_pts <= -s["mkt_pts"]:
            log(f"sinyal dilewati: harga sudah melewati level ({dist_pts} pts)")
            if pend:
                cancel_now(pend)
        elif dist_pts < s["mkt_pts"]:
            if pos is not None:
                if pend:
                    cancel_now(pend)
            elif late:
                # start terlambat: jangan kejar harga; limit hanya bila harga masih di sisi level
                if dist_pts >= 1 and pend is None:
                    place_limit(d, lvl, lot)
                elif dist_pts < 1:
                    log(f"sinyal dilewati: mulai terlambat, jarak {dist_pts} pts dari level")
            else:
                px = price.ask if d > 0 else price.bid
                if k:
                    send_market(symbol, info, d, px - d * s["sl_dist"],
                                px + d * s["tp_dist"], lot, tag)
                else:
                    log(f"PAPER: MARKET {'BUY' if d > 0 else 'SELL'} {lot:.2f} @ {px:.2f} "
                        f"SL {px - d*s['sl_dist']:.2f} TP {px + d*s['tp_dist']:.2f}")
        elif dist_pts >= 1:
            if pend and abs(pend.price_open - lvl) > asset.tick / 2:
                if k:
                    modify_pending(pend, info, lvl, lvl - d * s["sl_dist"],
                                   lvl + d * s["tp_dist"])
                else:
                    log(f"PAPER: MODIFY #{pend.ticket} -> {lvl:.2f}")
            elif pend is None and pos is None:
                place_limit(d, lvl, lot)
        else:
            log(f"sinyal dilewati: jarak {dist_pts} pts dari level, limit tidak valid")
            if pend:
                cancel_now(pend)
    elif s["st"] == 1:
        d = s["dir"]
        lvl = s["ent"]
        dist_pts = dist_to(lvl, d)
        if pend and abs(pend.price_open - lvl) > asset.tick / 2:
            if dist_pts >= 1:
                if k:
                    modify_pending(pend, info, lvl, lvl - d * s["sl_dist"],
                                   lvl + d * s["tp_dist"])
                else:
                    log(f"PAPER: MODIFY #{pend.ticket} -> {lvl:.2f}")
            else:
                log(f"pending dibatalkan: level {lvl:.2f} sudah dilewati")
                cancel_now(pend)
        elif pend is None and pos is None:
            if dist_pts >= 1:
                lot = lot_for(info, s["sl_dist"], args, quote_to_usd(symbol))
                if lot > 0:
                    place_limit(d, lvl, lot)
                else:
                    log(f"sinyal dilewati: lot < minimum (SL {s['sl_dist']:.2f})")
            else:
                log(f"sinyal dilewati: jarak {dist_pts} pts dari level, limit tidak valid")
    else:
        if pend:
            cancel_now(pend)

    state["last_bar_t"] = T
    state["grid_px"] = s["grid_px"]
    state["sl_dist"] = s["sl_dist"]
    state["st"] = s["st"]
    save_state(state)
    try:
        log_features(ctx, symbol, asset, preset, info, state)
    except Exception as exc:  # noqa: BLE001 - fitur tidak boleh menghentikan eksekusi
        log(f"ERROR logger fitur: {type(exc).__name__}: {exc}")


def track_broker(state, info):
    positions, _ = pos_and_orders(info.name)
    seen = {int(k): v for k, v in state.get("tickets", {}).items()}
    open_now = {}
    for p in positions:
        open_now[p.ticket] = p
        if p.ticket not in seen:
            seen[p.ticket] = {"fill_t": p.time, "fill_px": p.price_open,
                              "dir": 1 if p.type == mt5.POSITION_TYPE_BUY else -1,
                              "sl_dist": state.get("sl_dist", 0.0)}
            log(f"FILL #{p.ticket} {p.symbol} {p.volume} @ {p.price_open} "
                f"SL {p.sl} TP {p.tp}")
            append_trade({"event": "FILL", "ticket": p.ticket, "time": p.time,
                          "price": p.price_open, "volume": p.volume, "pnl": "", "r": ""})
    for ticket, meta in list(seen.items()):
        if ticket in open_now:
            continue
        deals = position_deals(ticket)
        out = [d for d in deals if d.entry == mt5.DEAL_ENTRY_OUT]
        if not out:
            continue
        d = out[-1]
        sl_dist = float(meta.get("sl_dist") or 0.0)
        r = (meta["dir"] * (d.price - meta["fill_px"]) / sl_dist) if sl_dist else 0.0
        pnl = sum(x.profit + x.commission + x.swap for x in deals)
        log(f"EXIT #{ticket} @ {d.price} pnl {pnl:+.2f} R {r:+.3f}")
        append_trade({"event": "EXIT", "ticket": ticket, "time": d.time,
                      "price": d.price, "volume": "", "pnl": round(pnl, 2),
                      "r": round(r, 3)})
        del seen[ticket]
    state["tickets"] = {str(k): v for k, v in seen.items()}
    save_state(state)


def main():
    args = parse_args()
    OUTDIR.mkdir(parents=True, exist_ok=True)
    pid_guard(args.force)
    kwargs = {"path": args.path} if args.path else {}
    if not mt5.initialize(**kwargs):
        raise SystemExit(f"MT5 initialize gagal: {mt5.last_error()}")
    acc = mt5.account_info()
    term = mt5.terminal_info()
    if acc is None or term is None:
        mt5.shutdown()
        raise SystemExit("Tidak bisa membaca akun/terminal MT5")
    mode = {0: "DEMO", 1: "CONTEST", 2: "REAL"}.get(acc.trade_mode, str(acc.trade_mode))
    live = bool(args.enable) and not args.once
    if args.enable and acc.trade_mode != 0:
        mt5.shutdown()
        raise SystemExit("DITOLAK: --enable hanya untuk akun DEMO.")
    symbol = resolve_symbol(PAIR_SYMBOLS[args.pair])
    if not symbol:
        raise SystemExit(f"Simbol {args.pair} tidak ditemukan")
    info = mt5.symbol_info(symbol)
    if not info.visible:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)
    asset = build_asset(PAIR_SYMBOLS[args.pair], float(getattr(info, "trade_tick_size", 0.0) or info.point))
    preset = PRESETS[args.preset]
    state = load_state()
    if state.get("symbol") not in (None, symbol) or state.get("preset") not in (None, preset.name):
        state = {}
    state.update({"symbol": symbol, "preset": preset.name, "magic": MAGIC,
                  "mode": "LIVE-DEMO" if live else "PAPER", "pair": args.pair})
    if not state.get("started_t"):
        state["started_t"] = int(time.time())
    FEAT_KEYS.update(load_feat_keys())
    save_state(state)
    log(f"START {args.preset} {args.pair} ({symbol}) | {acc.company} {acc.server} | "
        f"{mode} | balance {acc.balance} | {'LIVE-DEMO ORDERS' if live else 'PAPER (tanpa order)'} "
        f"| risk ${args.risk_usd:.0f} maxLot {args.max_lot}")
    if live and acc.balance < 1000:
        log(f"PERINGATAN: saldo {acc.balance} kecil; cek margin 0.01 lot XAU (~$40).")

    last_poll_status = 0.0
    while True:
        try:
            if mt5.terminal_info() is None:
                mt5.shutdown()
                if not mt5.initialize(**kwargs):
                    log("koneksi MT5 terputus, mencoba lagi...")
                    time.sleep(10)
                    continue
                log("koneksi MT5 tersambung kembali")
            tick = mt5.symbol_info_tick(symbol)
            if tick is None or not tick.bid:
                time.sleep(args.poll)
                continue
            tf = TF_FOR[preset.name]
            tf_min = TF_MIN[tf]
            recent = fetch(symbol, TF_MT5[tf], 3)
            closed = closed_bars(recent, tf_min)
            if closed and closed[-1][0] > state.get("last_bar_t", 0):
                T = closed[-1][0]
                for _ in range(15):
                    ctx = build_context(symbol, asset, preset, args)
                    if ctx and ctx["bars"][-1][0] >= T:
                        break
                    time.sleep(2)
                else:
                    log(f"bar {datetime.fromtimestamp(T, ET):%H:%M} belum tersedia, coba lagi")
                    time.sleep(args.poll)
                    continue
                process_new_bar(symbol, info, asset, preset, args, ctx, state, live)
            track_broker(state, info)
            now = time.time()
            if now - last_poll_status > 900:
                last_poll_status = now
                now_et = datetime.now(ET)
                s_off = (now_et.hour * 60 + now_et.minute - (asset.ws_h * 60 + asset.ws_m)) % 1440
                w_len = ((asset.we_h * 60 + asset.we_m) - (asset.ws_h * 60 + asset.ws_m)) % 1440
                log(f"STATUS inWindow={s_off < w_len} state={state.get('st')} "
                    f"bid={tick.bid} grid={state.get('grid_px')} "
                    f"pos={len(pos_and_orders(symbol)[0])} pend={len(pos_and_orders(symbol)[1])}")
            if args.once:
                break
            time.sleep(args.poll)
        except KeyboardInterrupt:
            log("dihentikan oleh user")
            break
        except Exception as exc:  # noqa: BLE001 - keep the executor alive
            log(f"ERROR loop: {type(exc).__name__}: {exc}")
            time.sleep(5)
    try:
        PID_PATH.unlink()
    except OSError:
        pass
    mt5.shutdown()


if __name__ == "__main__":
    main()
