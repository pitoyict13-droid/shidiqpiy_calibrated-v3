import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import grid_core as g


class PipAndGridTests(unittest.TestCase):
    def test_pip_size_five_digits(self):
        self.assertAlmostEqual(g.pip_size(5, 1e-05), 0.0001)

    def test_pip_size_three_digits(self):
        self.assertAlmostEqual(g.pip_size(3, 0.001), 0.01)

    def test_grid_index_and_level_eurusd(self):
        step = 15 * 0.0001
        idx = g.grid_index(1.1607, step)
        self.assertEqual(idx, 773)
        self.assertAlmostEqual(g.grid_level(idx, step), 1.1595)
        self.assertEqual(g.grid_index(1.1610, step), 774)

    def test_grid_index_and_level_usdjpy(self):
        step = 15 * 0.01
        idx = g.grid_index(150.25, step)
        self.assertEqual(idx, 1001)
        self.assertAlmostEqual(g.grid_level(idx, step), 150.15)

    def test_sl_tp_long(self):
        sl, tp = g.sl_tp(1.1600, "long", 15, 30, 0.0001)
        self.assertAlmostEqual(sl, 1.1585)
        self.assertAlmostEqual(tp, 1.1630)

    def test_sl_tp_short(self):
        sl, tp = g.sl_tp(150.00, "short", 15, 30, 0.01)
        self.assertAlmostEqual(sl, 150.15)
        self.assertAlmostEqual(tp, 149.70)

    def test_risk_usd_eurusd(self):
        self.assertAlmostEqual(g.risk_usd(1.1600, 1.1585, 100000, 0.01), 1.50)

    def test_risk_usd_usdjpy_conversion(self):
        risk = g.risk_usd(150.00, 150.15, 100000, 0.01, quote_to_usd=1 / 150.0)
        self.assertAlmostEqual(risk, 1.00)


class BreakevenTests(unittest.TestCase):
    def test_be_price_long_covers_spread(self):
        be = g.be_price(1.1600, "long", 0.8, 2.0, 0.0001, 5)
        self.assertAlmostEqual(be, 1.16028)
        self.assertGreater(be, 1.1600)

    def test_be_price_short(self):
        be = g.be_price(150.00, "short", 1.0, 2.0, 0.01, 3)
        self.assertAlmostEqual(be, 149.97)

    def test_should_breakeven_long(self):
        self.assertTrue(g.should_breakeven("long", 1.1600, 1.1615, 15, 0.0001))
        self.assertFalse(g.should_breakeven("long", 1.1600, 1.1614, 15, 0.0001))

    def test_should_breakeven_short(self):
        self.assertTrue(g.should_breakeven("short", 150.00, 149.85, 15, 0.01))
        self.assertFalse(g.should_breakeven("short", 150.00, 149.86, 15, 0.01))

    def test_should_breakeven_dist_scales_with_risk(self):
        self.assertTrue(g.should_breakeven_dist("long", 1.1600, 1.1623, 0.00225))
        self.assertFalse(g.should_breakeven_dist("long", 1.1600, 1.1621, 0.00225))
        self.assertTrue(g.should_breakeven_dist("short", 150.00, 149.77, 0.225))
        self.assertFalse(g.should_breakeven_dist("short", 150.00, 149.79, 0.225))

    def test_within_chase(self):
        self.assertTrue(g.within_chase(1.1598, 1.1595, 3, 0.0001))
        self.assertFalse(g.within_chase(1.15999, 1.1595, 3, 0.0001))


class GuardTests(unittest.TestCase):
    def test_session_weekday(self):
        monday = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
        self.assertTrue(g.in_session(monday))
        self.assertFalse(g.in_session(monday.replace(hour=6)))
        self.assertFalse(g.in_session(monday.replace(hour=19)))

    def test_session_friday_and_weekend(self):
        friday = datetime(2026, 10, 30, 15, 0, tzinfo=timezone.utc)
        self.assertTrue(g.in_session(friday))
        self.assertFalse(g.in_session(friday.replace(hour=16)))
        saturday = datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc)
        self.assertFalse(g.in_session(saturday))

    def test_news_blackout(self):
        now = datetime(2026, 10, 29, 12, 30, tzinfo=timezone.utc)
        events = [
            {"dt": now + timedelta(minutes=10), "importance": 2, "currency": "USD", "name": "GDP"},
            {"dt": now + timedelta(minutes=90), "importance": 3, "currency": "USD", "name": "FOMC"},
            {"dt": now, "importance": 1, "currency": "USD", "name": "Minor"},
            {"dt": now, "importance": 3, "currency": "CAD", "name": "BOC"},
        ]
        self.assertEqual(g.news_blackout(events, {"USD", "EUR"}, now), "GDP")
        self.assertIsNone(g.news_blackout(events[1:], {"USD", "EUR"}, now))
        self.assertIsNone(g.news_blackout(events[:3], {"EUR"}, now))

    def test_news_volatility_only_after_high_impact(self):
        now = datetime(2026, 10, 29, 12, 30, tzinfo=timezone.utc)
        events = [
            {"dt": now - timedelta(minutes=10), "importance": 3, "currency": "USD", "name": "NFP"},
            {"dt": now + timedelta(minutes=10), "importance": 3, "currency": "USD", "name": "CPI"},
            {"dt": now - timedelta(minutes=20), "importance": 2, "currency": "EUR", "name": "PMI"},
            {"dt": now - timedelta(minutes=5), "importance": 3, "currency": "CAD", "name": "BOC"},
            {"dt": now - timedelta(minutes=120), "importance": 3, "currency": "GBP", "name": "BoE"},
        ]
        self.assertEqual(g.news_volatility(events, {"USD", "EUR"}, now), "NFP")
        self.assertIsNone(g.news_volatility(events[1:3], {"USD", "EUR"}, now))
        self.assertIsNone(g.news_volatility(events[3:], {"USD", "EUR"}, now))
        self.assertEqual(g.news_volatility(events[1:2], {"USD"}, now,
                                           window_minutes=15), None)

    def test_guard_tripped(self):
        day = {"start_equity": 52.04}
        self.assertTrue(g.guard_tripped(day, 47.03, 5))
        self.assertFalse(g.guard_tripped(day, 47.05, 5))
        self.assertFalse(g.guard_tripped({}, 10.0, 5))


if __name__ == "__main__":
    unittest.main()
