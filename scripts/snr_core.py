"""Read-only Python port of the SnR LNY Pine indicator (pineSnR.txt, v6).

Ported pieces: f_break, f_nice, grid (Pips for gold / ATR-D1 with hysteresis for
the rest), asset profiles, ET windows, carry / Friday / news rules, the
three-segment intrabar path (O->L->H->C or O->H->L->C) and R accounting.

Not ported: drawings, dashboard, export table (no effect on results).
This module never imports MetaTrader5 and never sends orders.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from datetime import datetime
from math import ceil, floor, isfinite, log10, pow, sqrt
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DAY = 86400
FRIDAY = 4
CUR = ("USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF")


@dataclass(frozen=True)
class Preset:
    name: str
    tf_min: int
    grid_pips: int
    use_ms: bool
    ema_len: int
    sl_lv: int
    tp_lv: int
    friday: str  # SKIP | CLOSE | OFF


PRESETS = {
    "C1": Preset("C1", 30, 150, False, 50, 3, 1, "SKIP"),
    "C2": Preset("C2", 30, 150, True, 50, 3, 1, "SKIP"),
    "C4": Preset("C4", 15, 150, False, 50, 2, 1, "CLOSE"),
    "C5": Preset("C5", 60, 250, False, 50, 2, 1, "CLOSE"),
}


@dataclass(frozen=True)
class Asset:
    cls: int
    name: str
    ws_h: int
    ws_m: int
    we_h: int
    we_m: int
    ls_h: int
    ls_m: int
    carry: str
    contract: float
    pip: float
    tick: float


def classify(symbol: str) -> int:
    tk = symbol.upper().replace("/", "").replace(".", "")
    if "XAU" in tk or "GOLD" in tk:
        return 1
    if any(k in tk for k in ("BTC", "ETH", "SOL", "XRP", "BNB", "LTC")):
        return 3
    if any(k in tk for k in ("GER", "DE40", "DE30", "DAX", "UK100", "FTSE", "FRA40",
                             "CAC", "EU50", "STOXX", "ESP35", "IBEX")):
        return 5
    if any(k in tk for k in ("US30", "DJI", "DOW", "NAS", "NDX", "USTEC", "SPX",
                             "US500", "SP500", "US100", "RUT")):
        return 4
    if len(tk) >= 6 and tk[:3] in CUR and tk[3:6] in CUR:
        return 2
    return 6


def build_asset(symbol: str, tick: float) -> Asset:
    cls = classify(symbol)
    names = {1: "Gold", 2: "Forex", 3: "Crypto", 4: "Index US", 5: "Index EU", 6: "Lain"}
    ws = we = ls = (0, 0)
    carry = "BLOCK_ALL"
    contract = 100.0
    pip = 1.0
    if cls in (1, 2, 6):
        ws, we, ls = (3, 0), (12, 0), (11, 45)
        contract = 100000.0 if cls == 2 else 100.0
        if cls == 1:
            pip = 0.10
        elif cls == 2:
            pip = 0.01 if "JPY" in symbol.upper() else 0.0001
    elif cls == 3:
        ws, we, ls = (8, 0), (16, 0), (15, 30)
        carry = "OFF"
        contract = 1.0
    elif cls == 4:
        ws, we, ls = (9, 30), (15, 30), (15, 0)
        contract = 1.0
    elif cls == 5:
        ws, we, ls = (3, 0), (11, 0), (10, 30)
        contract = 1.0
    return Asset(cls, names[cls], ws[0], ws[1], we[0], we[1], ls[0], ls[1],
                 carry, contract, pip, tick)


def rnd(x: float) -> int:
    return int(floor(x + 0.5)) if x >= 0 else -int(floor(-x + 0.5))


def nice_step(x: float) -> float:
    e = pow(10.0, floor(log10(x)))
    m = x / e
    n = 1.0 if m < 1.5 else 2.0 if m < 2.5 else 3.0 if m < 4.0 else 5.0 if m < 7.5 else 10.0
    return n * e


def break_level(grid_pts: int, prev_pts: int, cur_pts: int) -> tuple[int, int]:
    if cur_pts > prev_pts:
        lvl = grid_pts * floor(float(cur_pts - 1) / grid_pts)
        if lvl >= prev_pts:
            return 1, lvl
    elif cur_pts < prev_pts:
        lvl = grid_pts * ceil(float(cur_pts + 1) / grid_pts)
        if lvl <= prev_pts:
            return -1, lvl
    return 0, 0


def ema_series(vals: list[float], length: int) -> list[float | None]:
    """Pine ta.ema: SMA seed at index length-1, then alpha = 2/(n+1)."""
    out: list[float | None] = [None] * len(vals)
    if len(vals) < length:
        return out
    alpha = 2.0 / (length + 1.0)
    prev = sum(vals[:length]) / length
    out[length - 1] = prev
    for i in range(length, len(vals)):
        prev = alpha * vals[i] + (1.0 - alpha) * prev
        out[i] = prev
    return out


def atr_series(bars: list[tuple[int, float, float, float, float]], length: int) -> list[float | None]:
    out: list[float | None] = [None] * len(bars)
    trs: list[float] = []
    for i, (_, _, h, l, c) in enumerate(bars):
        if i == 0:
            tr = h - l
        else:
            pc = bars[i - 1][4]
            tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
        if i == length - 1:
            out[i] = sum(trs[:length]) / length
        elif i >= length:
            out[i] = (out[i - 1] * (length - 1) + tr) / length
    return out


def align_prev_atr(bar_times: list[int], d1_times: list[int],
                   d1_atr: list[float | None]) -> list[float | None]:
    """request.security(D, ta.atr(n)[1], lookahead_on): ATR of the last closed D1 bar."""
    out: list[float | None] = [None] * len(bar_times)
    for i, t in enumerate(bar_times):
        j = bisect_right(d1_times, t) - 1
        if j >= 1:
            out[i] = d1_atr[j - 1]
    return out


def ms_flags(highs: list[float], lows: list[float], frac_len: int):
    """LuxAlgo-style fractal flags with frac_len bars on each side (p = len//2)."""
    n = len(highs)
    p = frac_len // 2
    bull = [False] * n
    bear = [False] * n
    sh = [0] * n
    sl = [0] * n
    for i in range(1, n):
        sh[i] = 1 if highs[i] > highs[i - 1] else -1 if highs[i] < highs[i - 1] else 0
        sl[i] = 1 if lows[i] > lows[i - 1] else -1 if lows[i] < lows[i - 1] else 0
    dh = [0] * n
    dl = [0] * n
    for i in range(1, n):
        dh[i] = sh[i] + sh[i - 1]
        dl[i] = sl[i] + sl[i - 1]
    for i in range(frac_len - 1, n):
        hi_n = max(highs[i - frac_len + 1:i + 1])
        lo_n = min(lows[i - frac_len + 1:i + 1])
        bull[i] = dh[i] == -p and dh[i - p] == p and highs[i - p] == hi_n
        bear[i] = dl[i] == p and dl[i - p] == -p and lows[i - p] == lo_n
    return bull, bear


@dataclass
class Prepared:
    t: list[int]
    o: list[float]
    h: list[float]
    l: list[float]
    c: list[float]
    off: list[int]
    off_close: list[int]
    win_id: list[int]
    win_id_close: list[int]
    day_start: list[int]
    day_start_close: list[int]
    is_fri: list[bool]
    win_fri_close: list[bool]
    fc: list[int]


def prepare(bars, asset: Asset, tf_min: int) -> Prepared:
    wstart = asset.ws_h * 60 + asset.ws_m
    p = Prepared([], [], [], [], [], [], [], [], [], [], [], [], [], [])
    for t, o, h, l, c in bars:
        dt = datetime.fromtimestamp(t, ET)
        mins = dt.hour * 60 + dt.minute
        w0 = int(dt.replace(hour=asset.ws_h, minute=asset.ws_m,
                            second=0, microsecond=0).timestamp())
        wid = w0 if t >= w0 else w0 - DAY
        d0 = int(dt.replace(hour=17, minute=0, second=0, microsecond=0).timestamp())
        ds = d0 if t >= d0 else d0 - DAY
        close_t = t + tf_min * 60
        cdt = datetime.fromtimestamp(close_t, ET)
        cmins = cdt.hour * 60 + cdt.minute
        cw0 = int(cdt.replace(hour=asset.ws_h, minute=asset.ws_m,
                              second=0, microsecond=0).timestamp())
        widc = cw0 if close_t >= cw0 else cw0 - DAY
        ds0 = int(cdt.replace(hour=17, minute=0, second=0, microsecond=0).timestamp())
        dsc = ds0 if close_t >= ds0 else ds0 - DAY
        p.t.append(t)
        p.o.append(o)
        p.h.append(h)
        p.l.append(l)
        p.c.append(c)
        p.off.append((mins - wstart) % 1440)
        p.off_close.append((cmins - wstart) % 1440)
        p.win_id.append(wid)
        p.win_id_close.append(widc)
        p.day_start.append(ds)
        p.day_start_close.append(dsc)
        p.is_fri.append(dt.weekday() == FRIDAY)
        p.win_fri_close.append(datetime.fromtimestamp(widc, ET).weekday() == FRIDAY)
        p.fc.append(int(dt.replace(hour=16, minute=30, second=0, microsecond=0).timestamp()))
    return p


def build_events(text: str) -> dict[int, tuple[int, bool]]:
    """Map server-day start (17:00 ET) -> (last CPI/NFP ts, has FOMC)."""
    out: dict[int, tuple[int, bool]] = {}
    for line in text.split("\n"):
        parts = line.strip().split()
        if len(parts) < 3:
            continue
        try:
            d = [int(x) for x in parts[0].split("-")]
            hm = [int(x) for x in parts[1].split(":")]
        except ValueError:
            continue
        if len(d) != 3 or len(hm) != 2:
            continue
        ts = int(datetime(d[0], d[1], d[2], hm[0], hm[1], tzinfo=ET).timestamp())
        kind = 2 if "FOMC" in parts[2].upper() else 1
        dt = datetime.fromtimestamp(ts, ET)
        d0 = int(dt.replace(hour=17, minute=0, second=0, microsecond=0).timestamp())
        ds = d0 if ts >= d0 else d0 - DAY
        last_cn, fomc = out.get(ds, (0, False))
        if kind == 1:
            last_cn = max(last_cn, ts)
        else:
            fomc = True
        out[ds] = (last_cn, fomc)
    return out


def _at_et(t: int, h: int, m: int) -> int:
    dt = datetime.fromtimestamp(t, ET)
    return int(dt.replace(hour=h, minute=m, second=0, microsecond=0).timestamp())


def simulate(pair: str, preset: Preset, asset: Asset, prep: Prepared,
             atr_prev, ema, bull, bear, events_by_ds, start_ts: int,
             grid_k: float = 0.25, hyst_pct: float = 25.0,
             mkt_pct: float = 2.0, news_on: bool = True, news_wait: int = 30,
             fomc_h: int = 9, fomc_m: int = 0, flip_cancel: bool = True) -> dict:
    tick = asset.tick
    tf = preset.tf_min
    w_len = ((asset.we_h * 60 + asset.we_m) - (asset.ws_h * 60 + asset.ws_m)) % 1440
    sig_off = ((asset.ls_h * 60 + asset.ls_m) - (asset.ws_h * 60 + asset.ws_m)) % 1440
    gmode = "Pips" if asset.cls == 1 else "ATR"
    k_eff = grid_k * preset.grid_pips / 150.0
    pips_pts = max(1, rnd(preset.grid_pips * asset.pip / tick))
    wk_skip = asset.cls != 3 and preset.friday == "SKIP"
    wk_close = asset.cls != 3 and preset.friday == "CLOSE"
    carry = asset.carry

    grid_pts = 0
    grid_raw = None
    sl_dist = 0.0
    tp_dist = 0.0
    mkt_pts = 0

    st = 0
    dr = 0
    ent_pts = 0
    ent = sl = tp = float("nan")
    fill_px = float("nan")
    fill_t = 0
    fill_sl = 0.0
    q_win = 0
    q_cnt = 0
    done_win = 0
    last_end = 0
    last_ex_t = 0
    last_ex_f = 0
    def_kind = 0
    def_dir = 0
    def_lvl = 0

    upv = None
    upx = False
    lov = None
    lox = False
    os_ = 0
    prev_upv = None
    prev_lov = None

    trades: list[dict] = []
    n = len(prep.t)

    for i in range(1, n):
        t = prep.t[i]
        o = prep.o[i]
        h = prep.h[i]
        lo = prep.l[i]
        c = prep.c[i]
        c_prev = prep.c[i - 1]

        # ---- Market structure (every bar, as in Pine)
        if bull[i]:
            upv = prep.h[i - 2]
            upx = False
        if upv is not None and prev_upv is not None:
            cross_up = c_prev <= prev_upv and c > upv
        else:
            cross_up = False
        if cross_up and not upx:
            upx = True
            os_ = 1
        if bear[i]:
            lov = prep.l[i - 2]
            lox = False
        if lov is not None and prev_lov is not None:
            cross_dn = c_prev >= prev_lov and c < lov
        else:
            cross_dn = False
        if cross_dn and not lox:
            lox = True
            os_ = -1
        prev_upv = upv
        prev_lov = lov

        # ---- Grid update
        can_move = (st == 0 or st == 3) and def_kind == 0
        if gmode == "Pips":
            grid_pts = pips_pts
        else:
            av = atr_prev[i]
            if av is not None and av > 0:
                raw = av * k_eff
                if grid_pts == 0 or (can_move and (grid_raw is None or
                                                   abs(raw / grid_raw - 1.0) > hyst_pct / 100.0)):
                    grid_pts = max(1, rnd(nice_step(raw) / tick))
                    grid_raw = raw
        if grid_pts == 0:
            continue

        grid_px = grid_pts * tick
        sl_dist = preset.sl_lv * grid_px
        tp_dist = preset.tp_lv * grid_px
        mkt_pts = max(0, rnd(grid_pts * mkt_pct / 100.0))

        # ---- 1. act on the previous bar's decision at this bar's open
        if def_kind != 0:
            o_pts = rnd(o / tick)
            dist = o_pts - def_lvl if def_dir > 0 else def_lvl - o_pts
            do_mkt = False
            if def_kind == 1:
                if dist > -mkt_pts:
                    if dist < mkt_pts:
                        do_mkt = True
                    else:
                        st = 1
                        dr = def_dir
                        ent_pts = def_lvl
                        ent = def_lvl * tick
                        sl = ent - dr * sl_dist
                        tp = ent + dr * tp_dist
            elif st == 1:
                if dist > -mkt_pts:
                    if dist < mkt_pts:
                        do_mkt = True
                    else:
                        ent_pts = def_lvl
                        ent = def_lvl * tick
                        sl = ent - dr * sl_dist
                        tp = ent + dr * tp_dist
            if do_mkt:
                st = 1
                dr = def_dir
                ent = o
                ent_pts = o_pts
                sl = ent - dr * sl_dist
                tp = ent + dr * tp_dist
            def_kind = 0

        # ---- 2. intrabar path
        exit_px = None
        exit_code = ""
        if st == 2 and wk_close and prep.is_fri[i] and t >= prep.fc[i]:
            exit_px = o
            exit_code = "JUMAT"
        if (st == 1 or st == 2) and exit_px is None:
            path = [o, lo, h, c] if c >= o else [o, h, lo, c]
            for k in range(3):
                a = path[k]
                b = path[k + 1]
                if st == 1:
                    hit = min(a, b) <= ent if dr > 0 else max(a, b) >= ent
                    if hit:
                        fp = (a if a <= ent else ent) if dr > 0 else (a if a >= ent else ent)
                        st = 2
                        fill_px = fp
                        fill_t = t
                        fill_sl = sl_dist
                        wid = prep.win_id[i]
                        if wid != q_win:
                            q_win = wid
                            q_cnt = 0
                        q_cnt += 1
                        a = fp
                if st == 2:
                    if dr > 0:
                        if a <= sl:
                            exit_px, exit_code = a, "SL"
                        elif a >= tp:
                            exit_px, exit_code = a, "TP"
                        elif b < a and b <= sl:
                            exit_px, exit_code = sl, "SL"
                        elif b > a and b >= tp:
                            exit_px, exit_code = tp, "TP"
                    else:
                        if a >= sl:
                            exit_px, exit_code = a, "SL"
                        elif a <= tp:
                            exit_px, exit_code = a, "TP"
                        elif b > a and b >= sl:
                            exit_px, exit_code = sl, "SL"
                        elif b < a and b <= tp:
                            exit_px, exit_code = tp, "TP"
                if exit_px is not None:
                    break
        if (st == 2 and exit_px is None and wk_close and prep.is_fri[i]
                and t < prep.fc[i] < t + tf * 60):
            exit_px = c
            exit_code = "JUMAT"

        if st == 2 and exit_px is not None:
            r = dr * (exit_px - fill_px) / fill_sl
            if fill_t >= start_ts:
                trades.append({
                    "fill_t": fill_t, "exit_t": t, "dir": dr, "code": exit_code,
                    "r": r, "fill_px": fill_px, "exit_px": exit_px,
                    "sl_dist": fill_sl, "grid_px": grid_px,
                })
            last_ex_t = t
            last_ex_f = fill_t
            last_end = t
            wid_now = prep.win_id[i]
            if prep.off[i] < w_len and wid_now == q_win and q_cnt >= 1:
                st = 3
                done_win = wid_now
            else:
                st = 0

        # ---- 3. window rollover / pending cancel
        now_close = t + tf * 60
        if st == 3 and prep.win_id_close[i] != done_win:
            st = 0
        if st == 1:
            why = prep.off_close[i] >= w_len
            if not why and news_on:
                _, fomc = events_by_ds.get(prep.day_start_close[i], (0, False))
                if fomc and now_close >= _at_et(t, fomc_h, fomc_m):
                    why = True
            if why:
                st = 0
                last_end = now_close

        # ---- 4. flip cancel (MS Fractal)
        if preset.use_ms and flip_cancel and st == 1 and os_ != 0 and os_ != dr:
            st = 0
            last_end = t

        # ---- 5. breakout signal
        brk, lvl = break_level(grid_pts, rnd(c_prev / tick), rnd(c / tick))
        if brk != 0:
            in_win_close = prep.off_close[i] < w_len
            qual = prep.off[i] < w_len and prep.off[i] + tf <= sig_off
            if st == 1:
                if brk == dr and qual and in_win_close:
                    further = lvl < ent_pts if dr < 0 else lvl > ent_pts
                    if further:
                        def_kind = 2
                        def_dir = dr
                        def_lvl = lvl
            elif st == 0:
                if now_close > last_end and qual and in_win_close:
                    ok = True
                    if (carry != "OFF" and last_ex_t > 0
                            and last_ex_t >= prep.day_start_close[i]
                            and last_ex_f < prep.win_id_close[i]):
                        ok = False
                    if ok and wk_skip and prep.win_fri_close[i]:
                        ok = False
                    if ok and news_on:
                        lc, fomc = events_by_ds.get(prep.day_start_close[i], (0, False))
                        if (lc > 0 and now_close < lc + news_wait * 60) or (
                                fomc and now_close >= _at_et(t, fomc_h, fomc_m)):
                            ok = False
                    if ok:
                        e = ema[i]
                        allowed = os_ if preset.use_ms else (1 if e is not None and c > e
                                                             else -1 if e is not None and c < e else 0)
                        ok = allowed == brk
                    if ok and prep.win_id_close[i] == q_win and q_cnt >= 1:
                        ok = False
                    if ok:
                        def_kind = 1
                        def_dir = brk
                        def_lvl = lvl

    state = {
        "st": st, "dir": dr, "ent": ent, "sl": sl, "tp": tp, "ent_pts": ent_pts,
        "fill_t": fill_t, "fill_px": fill_px, "fill_sl": fill_sl,
        "q_win": q_win, "q_cnt": q_cnt, "done_win": done_win,
        "last_end": last_end, "last_ex_t": last_ex_t, "last_ex_f": last_ex_f,
        "def_kind": def_kind, "def_dir": def_dir, "def_lvl": def_lvl,
        "grid_pts": grid_pts, "grid_px": grid_pts * tick,
        "sl_dist": sl_dist, "tp_dist": tp_dist, "mkt_pts": mkt_pts,
        "last_bar_t": prep.t[-1] if prep.t else 0,
        "ms_state": os_, "last_trade": trades[-1] if trades else None,
    }
    return {"trades": trades, "state": state}


def wilson(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = wins / n
    denom = 1.0 + z * z / n
    center = (p + z * z / (2.0 * n)) / denom
    half = z * sqrt(p * (1.0 - p) / n + z * z / (4.0 * n * n)) / denom
    return max(0.0, center - half), min(1.0, center + half)


def summarize(trades: list[dict], preset: Preset, spread_px: float = 0.0) -> dict:
    n = len(trades)
    rs = [x["r"] for x in trades]
    costs = [spread_px / x["sl_dist"] if x["sl_dist"] > 0 else 0.0 for x in trades]
    wins = sum(1 for r in rs if r > 0)
    gross_w = sum(r for r in rs if r > 0)
    gross_l = -sum(r for r in rs if r < 0)
    total = sum(rs)
    peak = 0.0
    run = 0.0
    max_dd = 0.0
    for r in rs:
        run += r
        peak = max(peak, run)
        max_dd = max(max_dd, peak - run)
    lo, hi = wilson(wins, n)
    be = preset.sl_lv / float(preset.sl_lv + preset.tp_lv)
    codes = {k: sum(1 for x in trades if x["code"] == k) for k in ("TP", "SL", "JUMAT")}
    net = total - sum(costs)
    return {
        "n": n,
        "wr": wins / n if n else 0.0,
        "wr_lo": lo,
        "wr_hi": hi,
        "total_r": total,
        "avg_r": total / n if n else 0.0,
        "pf": (gross_w / gross_l) if gross_l > 0 else float("inf"),
        "max_dd": max_dd,
        "avg_win": gross_w / wins if wins else 0.0,
        "avg_loss": -gross_l / (n - wins) if n - wins else 0.0,
        "be_wr": be,
        "spread_cost_r": (sum(costs) / n) if n else 0.0,
        "net_total_r": net,
        "net_avg_r": net / n if n else 0.0,
        "codes": codes,
        "clears": lo > be,
    }
