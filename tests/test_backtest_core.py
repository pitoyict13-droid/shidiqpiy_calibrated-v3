import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import backtest_core as b

UTC = timezone.utc


def base_cfg(**overrides):
    cfg = {
        "pip": {"EUR/USD": 0.0001},
        "digits": {"EUR/USD": 5},
        "contract": {"EUR/USD": 100000.0},
        "quote_ccy": {"EUR/USD": "USD"},
        "spread_pips": 0.8, "lot": 0.01, "max_spread_pips": 1.5,
        "grid_pips": 15.0, "sl_pips": 15.0, "tp_pips": 30.0,
        "be_buffer_pips": 2.0, "chase_pips": 3.0, "ema_period": 20,
        "max_open": 3, "max_trades_day": 10, "max_loss": 5.0,
        "cooldown": 120, "friday_close_hour": 16, "ignore_session": False,
        "balance": 1000.0, "confirm_bars": 2,
        "news": [], "use_news": False, "news_window": 30,
        "vol_factor": 1.5, "vol_window": 60, "fomc_dates": set(),
    }
    cfg.update(overrides)
    return cfg


def make_bars(start, closes, highs=None, lows=None):
    bars = []
    for i, close in enumerate(closes):
        high = (highs[i] if highs else max(close, closes[i - 1] if i else close))
        low = (lows[i] if lows else min(close, closes[i - 1] if i else close))
        bars.append({"t": int((start + timedelta(minutes=i)).timestamp()),
                     "o": closes[i - 1] if i else close,
                     "h": high, "l": low, "c": close})
    return bars


class TimeBaseTests(unittest.TestCase):
    def test_europe_dst_summer_and_winter(self):
        self.assertTrue(b.europe_is_dst(datetime(2026, 9, 16, 12, tzinfo=UTC)))
        self.assertFalse(b.europe_is_dst(datetime(2026, 10, 29, 12, tzinfo=UTC)))

    def test_server_epoch_to_utc_before_and_after_switch(self):
        summer = datetime(2026, 9, 16, 18, 0, tzinfo=UTC)
        self.assertEqual(b.server_epoch_to_utc(int(summer.timestamp()) + 3 * 3600),
                         int(summer.timestamp()))
        winter = datetime(2026, 10, 29, 1, 0, tzinfo=UTC)
        self.assertEqual(b.server_epoch_to_utc(int(winter.timestamp()) + 2 * 3600),
                         int(winter.timestamp()))

    def test_fixed_offset_overrides_dst(self):
        moment = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
        self.assertEqual(
            b.server_epoch_to_utc(int(moment.timestamp()) + 4 * 3600, 4),
            int(moment.timestamp()))


class SignalTests(unittest.TestCase):
    STEP = 15 * 0.0001

    def test_confirmation_needs_second_bar(self):
        state = {}
        self.assertIsNone(b.signal_step(state, 1.1594, self.STEP, 2))
        self.assertIsNone(b.signal_step(state, 1.1596, self.STEP, 2))
        signal = b.signal_step(state, 1.1597, self.STEP, 2)
        self.assertIsNotNone(signal)
        self.assertEqual(signal["dir"], "long")
        self.assertAlmostEqual(signal["level"], 1.1595, places=7)

    def test_downside_cross_is_short(self):
        state = {}
        b.signal_step(state, 1.1601, self.STEP, 2)
        b.signal_step(state, 1.1594, self.STEP, 2)
        signal = b.signal_step(state, 1.1593, self.STEP, 2)
        self.assertEqual(signal["dir"], "short")
        self.assertAlmostEqual(signal["level"], 1.1595, places=7)

    def test_no_repeat_after_fired(self):
        state = {}
        b.signal_step(state, 1.1594, self.STEP, 2)
        b.signal_step(state, 1.1596, self.STEP, 2)
        self.assertIsNotNone(b.signal_step(state, 1.1597, self.STEP, 2))
        self.assertIsNone(b.signal_step(state, 1.1598, self.STEP, 2))

    def test_confirm_one_fires_on_crossing_bar(self):
        state = {}
        b.signal_step(state, 1.1594, self.STEP, 1)
        signal = b.signal_step(state, 1.1596, self.STEP, 1)
        self.assertEqual(signal["dir"], "long")


class ExitTests(unittest.TestCase):
    def long_pos(self):
        return {"pair": "EUR/USD", "dir": "long", "entry": 1.1600,
                "sl": 1.1585, "tp": 1.1630, "risk_dist": 0.0015,
                "be_done": False}

    def short_pos(self):
        return {"pair": "EUR/USD", "dir": "short", "entry": 1.1600,
                "sl": 1.1615, "tp": 1.1570, "risk_dist": 0.0015,
                "be_done": False}

    def test_sl_wins_when_both_sl_and_tp_inside_bar(self):
        bar = {"o": 1.1600, "h": 1.1640, "l": 1.1580, "c": 1.1590}
        price, status = b.advance_position(self.long_pos(), bar, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(status, "SL")
        self.assertAlmostEqual(price, 1.1585)

    def test_tp_when_only_tp_touched(self):
        bar = {"o": 1.1600, "h": 1.1635, "l": 1.1590, "c": 1.1632}
        price, status = b.advance_position(self.long_pos(), bar, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(status, "TP")
        self.assertAlmostEqual(price, 1.1630)

    def test_gap_through_sl_fills_at_open(self):
        bar = {"o": 1.1570, "h": 1.1572, "l": 1.1565, "c": 1.1568}
        price, status = b.advance_position(self.long_pos(), bar, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(status, "SL")
        self.assertAlmostEqual(price, 1.1570 - 0.00004)

    def test_be_moves_sl_then_exits_next_bar(self):
        pos = self.long_pos()
        trigger = {"o": 1.1600, "h": 1.1620, "l": 1.1595, "c": 1.1618}
        self.assertIsNone(b.advance_position(pos, trigger, 0.8, 0.0001, 5, 2.0))
        self.assertTrue(pos["be_done"])
        self.assertAlmostEqual(pos["sl"], 1.16028, places=6)
        pullback = {"o": 1.1610, "h": 1.1612, "l": 1.1600, "c": 1.1605}
        price, status = b.advance_position(pos, pullback, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(status, "BE")
        self.assertAlmostEqual(price, pos["sl"])

    def test_short_sl(self):
        bar = {"o": 1.1600, "h": 1.1620, "l": 1.1598, "c": 1.1618}
        price, status = b.advance_position(self.short_pos(), bar, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(status, "SL")
        self.assertAlmostEqual(price, 1.1615)


class ScaleOutExitTests(unittest.TestCase):
    def long_pos(self):
        return {"pair": "EUR/USD", "dir": "long", "entry": 1.1600,
                "sl": 1.1585, "tp": 1.1630, "tp1": 1.1615,
                "risk_dist": 0.0015, "be_done": False, "tp1_done": False}

    def short_pos(self):
        return {"pair": "EUR/USD", "dir": "short", "entry": 1.1600,
                "sl": 1.1615, "tp": 1.1570, "tp1": 1.1585,
                "risk_dist": 0.0015, "be_done": False, "tp1_done": False}

    def test_partial_then_be(self):
        pos = self.long_pos()
        trigger = {"o": 1.1600, "h": 1.1620, "l": 1.1595, "c": 1.1618}
        result = b.advance_scale_position(pos, trigger, 0.8, 0.0001, 5, 2.0)
        self.assertTrue(result["new_partial"])
        self.assertIsNone(result["exit"])
        self.assertAlmostEqual(pos["tp1_fill"], 1.1615)
        self.assertAlmostEqual(pos["sl"], 1.16028, places=6)
        pullback = {"o": 1.1610, "h": 1.1612, "l": 1.1600, "c": 1.1605}
        result = b.advance_scale_position(pos, pullback, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(result["status"], "BE")
        self.assertFalse(result["new_partial"])

    def test_partial_then_final_tp(self):
        pos = self.long_pos()
        trigger = {"o": 1.1600, "h": 1.1620, "l": 1.1595, "c": 1.1618}
        b.advance_scale_position(pos, trigger, 0.8, 0.0001, 5, 2.0)
        runner = {"o": 1.1620, "h": 1.1635, "l": 1.1615, "c": 1.1632}
        result = b.advance_scale_position(pos, runner, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(result["status"], "TP")
        self.assertFalse(result["new_partial"])

    def test_sl_before_partial_is_full_loss(self):
        pos = self.long_pos()
        bar = {"o": 1.1600, "h": 1.1610, "l": 1.1580, "c": 1.1590}
        result = b.advance_scale_position(pos, bar, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(result["status"], "SL")
        self.assertFalse(result["new_partial"])
        self.assertAlmostEqual(result["exit"], 1.1585)

    def test_same_bar_tp1_and_tp2(self):
        pos = self.long_pos()
        bar = {"o": 1.1600, "h": 1.1635, "l": 1.1590, "c": 1.1632}
        result = b.advance_scale_position(pos, bar, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(result["status"], "TP")
        self.assertTrue(result["new_partial"])
        self.assertAlmostEqual(pos["tp1_fill"], 1.1615)

    def test_short_partial_then_be(self):
        pos = self.short_pos()
        trigger = {"o": 1.1600, "h": 1.1605, "l": 1.1580, "c": 1.1582}
        result = b.advance_scale_position(pos, trigger, 0.8, 0.0001, 5, 2.0)
        self.assertTrue(result["new_partial"])
        self.assertAlmostEqual(pos["sl"], 1.15972, places=6)
        pullback = {"o": 1.1590, "h": 1.1600, "l": 1.1588, "c": 1.1595}
        result = b.advance_scale_position(pos, pullback, 0.8, 0.0001, 5, 2.0)
        self.assertEqual(result["status"], "BE")


class PnlTests(unittest.TestCase):
    def test_eurusd_tp_is_three_dollars(self):
        cfg = base_cfg()
        usd = b.pnl_usd(cfg, "EUR/USD", "long", 1.15974, 1.16274, 1.16)
        self.assertAlmostEqual(usd, 3.0, places=2)

    def test_usdjpy_converts_with_mid(self):
        cfg = base_cfg(contract={"USD/JPY": 100000.0},
                       quote_ccy={"USD/JPY": "JPY"})
        usd = b.pnl_usd(cfg, "USD/JPY", "short", 150.00, 149.85, 150.00)
        self.assertAlmostEqual(usd, 1.0, places=4)


class SimulateTests(unittest.TestCase):
    START = datetime(2026, 9, 16, 8, 0, tzinfo=UTC)

    def test_entry_then_tp(self):
        closes = [1.1594] * 23 + [1.1596, 1.1597, 1.1628]
        bars = make_bars(self.START, closes)
        bars[-1]["h"] = 1.1630
        bars[-1]["l"] = 1.1600
        result = b.simulate({"EUR/USD": bars}, base_cfg())
        self.assertEqual(len(result["trades"]), 1)
        trade = result["trades"][0]
        self.assertEqual(trade["status"], "TP")
        self.assertAlmostEqual(trade["pnl"], 3.0, places=2)
        self.assertAlmostEqual(result["final_balance"], 1003.0, places=2)

    def test_outside_session_blocks_entry(self):
        start = datetime(2026, 9, 16, 19, 40, tzinfo=UTC)
        closes = [1.1594] * 23 + [1.1596, 1.1597, 1.1628]
        bars = make_bars(start, closes)
        result = b.simulate({"EUR/USD": bars}, base_cfg())
        self.assertEqual(result["trades"], [])
        self.assertGreaterEqual(result["skips"]["session"], 1)

    def test_scale_out_same_bar_books_partial_and_final(self):
        closes = [1.1594] * 23 + [1.1596, 1.1597, 1.1628]
        bars = make_bars(self.START, closes)
        bars[-1]["h"] = 1.1630
        bars[-1]["l"] = 1.1600
        cfg = base_cfg(scale_out=True, tp1_pips=15.0, tp1_fraction=0.5)
        result = b.simulate({"EUR/USD": bars}, cfg)
        self.assertEqual(len(result["trades"]), 1)
        trade = result["trades"][0]
        self.assertEqual(trade["status"], "TP")
        self.assertTrue(trade["partial"])
        self.assertAlmostEqual(trade["pnl"], 2.25, places=2)

    def test_scale_out_partial_then_be(self):
        closes = [1.1594] * 23 + [1.1596, 1.1597, 1.1618, 1.1600]
        bars = make_bars(self.START, closes)
        cfg = base_cfg(scale_out=True, tp1_pips=15.0, tp1_fraction=0.5)
        result = b.simulate({"EUR/USD": bars}, cfg)
        self.assertEqual(len(result["trades"]), 1)
        trade = result["trades"][0]
        self.assertEqual(trade["status"], "BE")
        self.assertTrue(trade["partial"])
        self.assertAlmostEqual(trade["pnl"], 0.89, places=2)
        self.assertEqual(result["skips"]["guard"], 0)

    def test_scale_out_rejects_bad_fraction(self):
        bars = make_bars(self.START, [1.1594] * 30)
        with self.assertRaises(ValueError):
            b.simulate({"EUR/USD": bars}, base_cfg(scale_out=True, tp1_fraction=1.5))

    def test_scale_out_rejects_tp1_at_or_beyond_tp(self):
        bars = make_bars(self.START, [1.1594] * 30)
        with self.assertRaises(ValueError):
            b.simulate({"EUR/USD": bars},
                       base_cfg(scale_out=True, tp1_pips=30.0))


class SummaryTests(unittest.TestCase):
    def test_summary_and_drawdown(self):
        trades = [
            {"pnl": 3.0, "status": "TP", "pair": "EUR/USD", "closed_date": "2026-09-16"},
            {"pnl": -1.5, "status": "SL", "pair": "EUR/USD", "closed_date": "2026-09-16"},
            {"pnl": -1.5, "status": "SL", "pair": "GBP/USD", "closed_date": "2026-09-17"},
            {"pnl": 3.0, "status": "TP", "pair": "GBP/USD", "closed_date": "2026-09-17"},
        ]
        stats = b.summarize(trades)
        self.assertEqual(stats["trades"], 4)
        self.assertEqual(stats["status"], {"TP": 2, "SL": 2, "BE": 0})
        self.assertAlmostEqual(stats["pnl"], 3.0)
        self.assertAlmostEqual(stats["max_drawdown"], 3.0)
        self.assertAlmostEqual(stats["profit_factor"], 2.0)
        self.assertEqual(stats["days_with_trades"], 2)

    def test_fomc_subset(self):
        trades = [{"opened_date": "2026-09-16"}, {"opened_date": "2026-09-17"}]
        subset = b.subset_by_dates(trades, {"2026-09-16"})
        self.assertEqual(len(subset), 1)


if __name__ == "__main__":
    unittest.main()
