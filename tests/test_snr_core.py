import os
import sys
from datetime import datetime

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import snr_core as sc  # noqa: E402

ET = sc.ET


def _ts(y, m, d, hh=0, mm=0):
    return int(datetime(y, m, d, hh, mm, tzinfo=ET).timestamp())


def test_nice_step():
    assert sc.nice_step(0.0018) == pytest.approx(0.002)
    assert sc.nice_step(0.0012) == pytest.approx(0.001)
    assert sc.nice_step(0.0026) == pytest.approx(0.003)
    assert sc.nice_step(0.004) == pytest.approx(0.005)
    assert sc.nice_step(0.009) == pytest.approx(0.01)
    assert sc.nice_step(37.0) == pytest.approx(30.0)


def test_break_level():
    assert sc.break_level(1500, 240000, 240299) == (1, 240000)
    assert sc.break_level(1500, 240100, 240200) == (0, 0)
    assert sc.break_level(1500, 240000, 239999) == (-1, 240000)
    assert sc.break_level(1500, 240300, 239700) == (-1, 240000)
    assert sc.break_level(1500, 240200, 240150) == (0, 0)


def test_rnd_half_away_from_zero():
    assert sc.rnd(2.5) == 3
    assert sc.rnd(-2.5) == -3
    assert sc.rnd(2.4999) == 2


def test_ema_sma_seed():
    vals = [float(i) for i in range(10)]
    out = sc.ema_series(vals, 3)
    assert out[0] is None and out[1] is None
    assert out[2] == pytest.approx(1.0)  # SMA(0,1,2)
    assert out[3] == pytest.approx(0.5 * 3 + 0.5 * 1.0)


def test_atr_seed_and_wilder():
    bars = [(0, 1.0, 2.0, 1.0, 1.5), (60, 1.5, 3.0, 1.0, 2.0),
            (120, 2.0, 2.5, 1.5, 2.0), (180, 2.0, 4.0, 2.0, 3.0)]
    atr = sc.atr_series(bars, 2)
    assert atr[0] is None and atr[1] == pytest.approx((1.0 + 2.0) / 2)
    assert atr[2] == pytest.approx((1.5 * 1 + 1.0) / 2)  # tr = max(1.0, .5, .5)
    assert atr[3] == pytest.approx((1.25 * 1 + 2.0) / 2)


def test_ms_flags_swing():
    # up-up-down-down highs with a clear pivot high in the middle
    highs = [1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3]
    lows = [0.5, 1.5, 2.5, 3.5, 4.5, 3.5, 2.5, 1.5, 0.5, 1.5, 2.5]
    bull, bear = sc.ms_flags([float(x) for x in highs], [float(x) for x in lows], 5)
    assert bull[6] is True
    assert bear[10] is True


def test_prepare_offsets_and_windows():
    a = sc.build_asset("XAUUSD", 0.01)
    assert (a.cls, a.ws_h, a.we_h, a.ls_h, a.ls_m, a.pip) == (1, 3, 12, 11, 45, 0.10)
    bars = [(_ts(2025, 6, 2, 10, 0), 2400.0, 2401.0, 2399.0, 2400.5)]
    p = sc.prepare(bars, a, 30)
    assert p.off[0] == 7 * 60
    assert p.off_close[0] == 7 * 60 + 30
    assert p.win_id[0] == _ts(2025, 6, 2, 3, 0)
    assert p.day_start[0] == _ts(2025, 6, 1, 17, 0)
    assert p.is_fri[0] is False


def test_build_events_maps_server_day():
    ev = sc.build_events("2026-10-28 14:00 FOMC\n2026-10-14 08:30 CPI\n")
    ds = _ts(2026, 10, 28, 17, 0) - sc.DAY
    assert ev[ds] == (0, True)
    lc, fomc = ev[_ts(2026, 10, 14, 17, 0) - sc.DAY]
    assert lc == _ts(2026, 10, 14, 8, 30) and fomc is False


def _gold_bars(signal_dt=(2025, 6, 3, 5, 0)):
    """50 flat 2400 bars before a breakout, then limit fill and TP."""
    sig = _ts(*signal_dt)
    bars = [(sig - (50 - i) * 1800, 2400.0, 2400.2, 2399.8, 2400.0) for i in range(50)]
    bars.append((sig, 2400.0, 2403.2, 2399.8, 2403.0))              # signal bar
    bars.append((sig + 1800, 2403.0, 2404.0, 2401.0, 2403.0))       # limit 2400 not hit
    bars.append((sig + 3600, 2403.0, 2404.0, 2398.0, 2401.0))       # fill at 2400
    bars.append((sig + 5400, 2401.0, 2416.0, 2400.0, 2414.0))       # TP 2415
    bars.append((sig + 7200, 2414.0, 2414.5, 2413.0, 2414.0))
    return bars


def test_simulate_gold_breakout_tp():
    bars = _gold_bars()
    a = sc.build_asset("XAUUSD", 0.01)
    p = sc.prepare(bars, a, 30)
    closes = [b[4] for b in bars]
    ema = sc.ema_series(closes, 50)
    bull, bear = sc.ms_flags([b[2] for b in bars], [b[3] for b in bars], 5)
    start = bars[49][0]
    res = sc.simulate("XAU/USD", sc.PRESETS["C1"], a, p, [None] * len(bars),
                      ema, bull, bear, {}, start)
    trades = res["trades"]
    assert len(trades) == 1
    tr = trades[0]
    assert tr["code"] == "TP"
    assert tr["fill_px"] == pytest.approx(2400.0)
    assert tr["r"] == pytest.approx(1.0 / 3.0)
    s = sc.summarize(trades, sc.PRESETS["C1"], spread_px=0.31)
    assert s["n"] == 1 and s["wr"] == 1.0
    assert s["net_total_r"] == pytest.approx(1.0 / 3.0 - 0.31 / 45.0)
    assert s["be_wr"] == pytest.approx(0.75)


def test_simulate_skips_friday_when_preset_says_so():
    bars = _gold_bars((2025, 6, 6, 5, 0))  # Friday
    a = sc.build_asset("XAUUSD", 0.01)
    p = sc.prepare(bars, a, 30)
    ema = sc.ema_series([b[4] for b in bars], 50)
    bull, bear = sc.ms_flags([b[2] for b in bars], [b[3] for b in bars], 5)
    res = sc.simulate("XAU/USD", sc.PRESETS["C1"], a, p, [None] * len(bars),
                      ema, bull, bear, {}, bars[49][0])
    assert res["trades"] == []
