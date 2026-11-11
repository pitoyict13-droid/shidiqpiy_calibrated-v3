import sys
import unittest
from math import log
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import orderflow_core as of


def bars_from_closes(closes, opens=None):
    bars = []
    for i, close in enumerate(closes):
        open_price = closes[i - 1] if opens is None and i else (
            opens[i] if opens else close)
        bars.append({"open": open_price, "high": close, "low": close,
                     "close": close, "volume": 1.0, "taker_buy_volume": 0.5,
                     "t": i, "trades": 1})
    return bars


class BookMetricTests(unittest.TestCase):
    def test_book_skew(self):
        self.assertAlmostEqual(of.book_skew(200, 100), log(2.0))

    def test_book_skew_empty_side(self):
        self.assertIsNone(of.book_skew(0, 100))

    def test_book_imbalance(self):
        self.assertAlmostEqual(of.book_imbalance(150, 50), 0.5)
        self.assertAlmostEqual(of.book_imbalance(50, 150), -0.5)

    def test_book_imbalance_empty(self):
        self.assertEqual(of.book_imbalance(0, 0), 0.0)


class TakerFlowTests(unittest.TestCase):
    def test_extremes(self):
        self.assertAlmostEqual(of.taker_imbalance(10, 0), 1.0)
        self.assertAlmostEqual(of.taker_imbalance(0, 10), -1.0)
        self.assertEqual(of.taker_imbalance(0, 0), 0.0)

    def test_flow_from_kline(self):
        self.assertAlmostEqual(of.flow_from_kline(10, 7), 0.4)

    def test_flow_clamps_bad_input(self):
        self.assertAlmostEqual(of.flow_from_kline(10, 12), 1.0)
        self.assertIsNone(of.flow_from_kline(0, 0))

    def test_parse_kline(self):
        row = [1730000000000, "100.5", "101", "99", "100", "12.5",
               1730000059999, "1250", 42, "8.75", "875", "0"]
        bar = of.parse_kline(row)
        self.assertEqual(bar["t"], 1730000000000)
        self.assertAlmostEqual(bar["taker_buy_volume"], 8.75)
        self.assertEqual(bar["trades"], 42)


class ForwardReturnTests(unittest.TestCase):
    def test_forward_return(self):
        bars = bars_from_closes([100.0, 101.0, 99.0])
        self.assertAlmostEqual(of.forward_return(bars, 0, 1), 100.0)
        self.assertAlmostEqual(of.forward_return(bars, 1, 1), -198.01980198, 4)

    def test_edge_returns_none(self):
        bars = bars_from_closes([100.0, 101.0])
        self.assertIsNone(of.forward_return(bars, 1, 1))


class StatisticTests(unittest.TestCase):
    def test_correlation(self):
        self.assertAlmostEqual(of.correlation([(1, 2), (2, 4), (3, 6)]), 1.0)
        self.assertAlmostEqual(of.correlation([(1, 3), (2, 2), (3, 1)]), -1.0)

    def test_constant_has_no_correlation(self):
        self.assertEqual(of.correlation([(1, 5), (1, 6)]), 0.0)

    def test_thresholds(self):
        flows = [float(i) for i in range(100)]
        low, high = of.thresholds(flows, 0.9)
        self.assertEqual(low, 10.0)
        self.assertEqual(high, 90.0)

    def test_bucket_stats(self):
        bars = bars_from_closes([100.0 + i for i in range(41)])
        flows = [float(i) for i in range(41)]
        buckets = of.bucket_stats(bars, flows, horizon=1, buckets=4)
        self.assertEqual(len(buckets), 4)
        self.assertLess(buckets[0]["flow_high"], buckets[-1]["flow_low"])
        self.assertGreater(buckets[-1]["mean_ret"], 0)


class SimulateTests(unittest.TestCase):
    def make_bars(self):
        closes = [100, 100, 101, 101, 101, 101, 99, 99, 99, 99]
        return bars_from_closes(closes)

    def test_momentum_long(self):
        bars = self.make_bars()
        bars[1]["open"] = 100.0
        bars[2]["close"] = 101.0
        flows = [1.0] + [0.0] * (len(bars) - 1)
        trades = of.simulate(bars, flows, low=-0.9, high=0.9, hold=2,
                             fee_bps=10.0)
        self.assertEqual(len(trades), 1)
        self.assertEqual(trades[0]["side"], 1)
        self.assertAlmostEqual(trades[0]["gross_bps"], 100.0)
        self.assertAlmostEqual(trades[0]["net_bps"], 80.0)

    def test_contrarian_flips(self):
        bars = self.make_bars()
        flows = [1.0] + [0.0] * (len(bars) - 1)
        trades = of.simulate(bars, flows, low=-0.9, high=0.9, hold=2,
                             fee_bps=0.0, mode="contrarian")
        self.assertEqual(trades[0]["side"], -1)
        self.assertAlmostEqual(trades[0]["gross_bps"], -100.0)

    def test_trades_are_non_overlapping(self):
        bars = self.make_bars()
        flows = [1.0] * len(bars)
        trades = of.simulate(bars, flows, low=-0.9, high=0.9, hold=2,
                             fee_bps=0.0)
        self.assertEqual([t["index"] for t in trades], [0, 3, 6])

    def test_none_flow_skipped(self):
        bars = self.make_bars()
        flows = [None] * len(bars)
        self.assertEqual(of.simulate(bars, flows, -0.9, 0.9, hold=2), [])

    def test_invalid_mode(self):
        with self.assertRaises(ValueError):
            of.simulate([], [], -1, 1, mode="mean-reversion")


class SummarizeTests(unittest.TestCase):
    def test_metrics(self):
        trades = [{"net_bps": 10.0, "gross_bps": 12.0},
                  {"net_bps": -5.0, "gross_bps": -3.0}]
        stats = of.summarize(trades)
        self.assertEqual(stats["trades"], 2)
        self.assertAlmostEqual(stats["winrate"], 0.5)
        self.assertAlmostEqual(stats["avg_net"], 2.5)
        self.assertAlmostEqual(stats["total_net"], 5.0)
        self.assertAlmostEqual(stats["profit_factor"], 2.0)
        self.assertAlmostEqual(stats["max_dd"], 5.0)

    def test_empty(self):
        stats = of.summarize([])
        self.assertEqual(stats["trades"], 0)
        self.assertEqual(stats["max_dd"], 0.0)


if __name__ == "__main__":
    unittest.main()
