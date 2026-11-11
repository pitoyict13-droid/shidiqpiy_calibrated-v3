import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import session_sweep_core as s

PIP = 0.0001


def neutral(moment):
    return {"dt": moment, "o": 1.1000, "h": 1.1002, "l": 1.0998, "c": 1.1000}


def build_day(high_first=True, high_only=False, with_tp=False, with_sl=False,
              both_sides=False, late=False, day=5):
    base_day = datetime(2026, 1, day)
    bars = []
    start = base_day.replace(hour=3, minute=0)
    for i in range(16):
        bars.append(neutral(start + timedelta(minutes=15 * i)))
    bars[0]["h"] = 1.1010
    bars[1]["l"] = 1.0990
    london = base_day.replace(hour=7, minute=15)
    for i in range(31):
        bars.append(neutral(london + timedelta(minutes=15 * i)))
    base = 16
    if late:
        bars[base + 27].update(h=1.1020, c=1.1012)   # 14:00
        bars[base + 30].update(l=1.0980, c=1.0986)   # 14:45
        return bars
    if high_first:
        bars[base + 3].update(h=1.1020, c=1.1012)    # 08:00 high sweep
        if not high_only:
            bars[base + 11].update(l=1.0980, c=1.0986)  # 10:00 low sweep
    else:
        bars[base + 3].update(l=1.0980, c=1.0986)
        bars[base + 11].update(h=1.1020, c=1.1012)
    if with_tp:
        for i in range(12, 16):
            bars[base + i].update(h=1.0999, l=1.0986)
        bars[base + 16].update(h=1.1002, l=1.0986)   # 11:15 hits mid
    if with_sl:
        for i in range(12, 16):
            bars[base + i].update(h=1.0999, l=1.0986)
        bars[base + 16].update(h=1.0999, l=1.0970)   # 11:15 hits stop
    if both_sides:
        for i in range(12, 16):
            bars[base + i].update(h=1.0999, l=1.0986)
        bars[base + 16].update(h=1.1003, l=1.0970)   # stop and target together
    return bars


class EventTests(unittest.TestCase):
    def test_high_then_low(self):
        events = s.find_events(build_day())
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["order"], "high_low")
        self.assertAlmostEqual(event["asia_high"], 1.1010)
        self.assertAlmostEqual(event["asia_low"], 1.0990)
        self.assertAlmostEqual(event["second_extreme"], 1.0980)
        self.assertEqual(event["first_time"].hour, 8)
        self.assertEqual(event["second_time"].hour, 10)
        self.assertEqual(event["index"], 16 + 11)
        self.assertEqual(event["day_end_index"], 16 + 30)

    def test_low_then_high(self):
        events = s.find_events(build_day(high_first=False))
        self.assertEqual(events[0]["order"], "low_high")
        self.assertAlmostEqual(events[0]["second_extreme"], 1.1020)

    def test_only_one_side_no_event(self):
        self.assertEqual(s.find_events(build_day(high_only=True)), [])

    def test_one_event_per_day(self):
        events = s.find_events(build_day() + build_day(high_first=False, day=6))
        self.assertEqual(len(events), 2)
        self.assertEqual([ev["date"].day for ev in events], [5, 6])

    def test_0700_bar_is_outside_window(self):
        bars = build_day()
        bars.insert(16, {"dt": datetime(2026, 1, 5, 7, 0), "o": 1.1,
                         "h": 1.1005, "l": 1.0985, "c": 1.0990})
        events = s.find_events(bars)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["order"], "high_low")

    def test_late_event_skipped_by_forward_bars(self):
        bars = build_day(late=True)
        events = s.find_events(bars)
        self.assertEqual(len(events), 1)
        self.assertIsNone(s.fade_result(bars, events[0], PIP, 1.0,
                                        min_forward_bars=4))


class FadeTests(unittest.TestCase):
    def setUp(self):
        self.bars = build_day(with_tp=True)
        self.event = s.find_events(self.bars)[0]

    def test_long_entry_and_rr(self):
        result = s.fade_result(self.bars, self.event, PIP, spread_pips=1.0,
                               sl_buffer_pips=3.0, tp_mode="mid")
        self.assertEqual(result["direction"], "long")
        self.assertAlmostEqual(result["entry"], 1.0986 + 0.00005)
        self.assertAlmostEqual(result["sl"], 1.0980 - 3 * PIP)
        self.assertAlmostEqual(result["tp"], 1.1000)
        self.assertAlmostEqual(result["rr"], 13.5 / 9.5, places=2)

    def test_tp_hit(self):
        result = s.fade_result(self.bars, self.event, PIP, 1.0, 3.0, "mid")
        self.assertEqual(result["status"], "TP")
        self.assertAlmostEqual(result["pips"], 13.5, places=2)

    def test_sl_hit(self):
        bars = build_day(with_sl=True)
        event = s.find_events(bars)[0]
        result = s.fade_result(bars, event, PIP, 1.0, 3.0, "mid")
        self.assertEqual(result["status"], "SL")
        self.assertAlmostEqual(result["pips"], -9.5, places=2)

    def test_sl_first_when_both_touch(self):
        bars = build_day(both_sides=True)
        event = s.find_events(bars)[0]
        result = s.fade_result(bars, event, PIP, 1.0, 3.0, "mid")
        self.assertEqual(result["status"], "SL")

    def test_hold_to_close(self):
        bars = build_day(high_first=False)
        event = s.find_events(bars)[0]
        result = s.fade_result(bars, event, PIP, 1.0, tp_mode=None)
        self.assertEqual(result["status"], "TIME")
        self.assertEqual(result["direction"], "short")
        self.assertIsNone(result["sl"])

    def test_opposite_target(self):
        result = s.fade_result(self.bars, self.event, PIP, 1.0, 3.0, "opposite")
        self.assertAlmostEqual(result["tp"], 1.1010)

    def test_invalid_geometry_skipped(self):
        bars = build_day()
        event = s.find_events(bars)[0]
        bars[event["index"]]["c"] = 1.1015  # close above range mid
        self.assertIsNone(s.fade_result(bars, event, PIP, 1.0, 3.0, "mid"))


class SummaryTests(unittest.TestCase):
    def test_summary_metrics(self):
        trades = [
            {"pips": 10, "status": "TP", "rr": 2, "mfe": 12, "mae": -2},
            {"pips": -5, "status": "SL", "rr": 2, "mfe": 1, "mae": -6},
            {"pips": 3, "status": "TIME", "rr": None, "mfe": 4, "mae": -1},
        ]
        stats = s.summarize(trades)
        self.assertEqual(stats["trades"], 3)
        self.assertEqual(stats["status"], {"TP": 1, "SL": 1, "TIME": 1})
        self.assertAlmostEqual(stats["winrate"], 66.67, places=2)
        self.assertAlmostEqual(stats["total_pips"], 8)
        self.assertAlmostEqual(stats["profit_factor"], 13 / 5)
        self.assertAlmostEqual(stats["max_drawdown"], 5)
        self.assertAlmostEqual(stats["avg_rr"], 2)

    def test_empty_summary(self):
        stats = s.summarize([])
        self.assertEqual(stats["trades"], 0)
        self.assertIsNone(stats["profit_factor"])


if __name__ == "__main__":
    unittest.main()
