import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import basis_core as b


class StudyTests(unittest.TestCase):
    def test_edges_executable_prices(self):
        edges = b.edges(100.00, 100.02, 100.60, 100.62)
        self.assertAlmostEqual(edges[b.LONG_SPOT], 0.58)
        self.assertAlmostEqual(edges[b.LONG_FUT], -0.62)

    def test_reference_is_average_mid(self):
        ref = b.reference_price(100.00, 100.02, 100.60, 100.62)
        self.assertAlmostEqual(ref, 100.31)

    def test_to_bps(self):
        self.assertAlmostEqual(b.to_bps(0.58, 100.31), 57.82, places=2)

    def test_study_picks_wider_side(self):
        state = b.study(100.60, 100.62, 100.00, 100.04)
        self.assertEqual(state["best"], b.LONG_FUT)
        self.assertAlmostEqual(state["sides"][b.LONG_FUT]["bps"], 55.82, places=2)

    def test_study_rejects_crossed_book(self):
        self.assertIsNone(b.study(100.05, 100.00, 100.60, 100.62))
        self.assertIsNone(b.study(0.0, 0.0, 100.60, 100.62))

    def test_round_trip_fee(self):
        self.assertAlmostEqual(b.round_trip_fee_bps(10, 5), 30.0)


class EntryTests(unittest.TestCase):
    def test_signal_above_threshold(self):
        sig = b.entry_signal(100.00, 100.02, 100.60, 100.62, entry_bps=10)
        self.assertEqual(sig["side"], b.LONG_SPOT)
        self.assertAlmostEqual(sig["edge"], 0.58)
        self.assertAlmostEqual(sig["net_bps"], sig["edge_bps"])

    def test_signal_below_threshold_is_none(self):
        self.assertIsNone(b.entry_signal(100.00, 100.02, 100.04, 100.06,
                                        entry_bps=10))

    def test_fees_can_block_signal(self):
        sig = b.entry_signal(100.00, 100.02, 100.20, 100.22,
                             entry_bps=10, fee_bps=30)
        self.assertIsNone(sig)

    def test_fee_aware_override(self):
        sig = b.entry_signal(100.00, 100.02, 100.60, 100.62,
                             entry_bps=10, fee_bps=30, min_net_bps=-100)
        self.assertIsNotNone(sig)
        self.assertAlmostEqual(sig["net_bps"], sig["edge_bps"] - 30)


class PositionTests(unittest.TestCase):
    def setUp(self):
        self.signal = b.entry_signal(100.00, 100.02, 100.60, 100.62,
                                     entry_bps=10, fee_bps=0)
        self.pos = b.open_position(self.signal, 2, 1000,
                                   100.00, 100.02, 100.60, 100.62)

    def test_open_fills_buy_ask_sell_bid(self):
        self.assertAlmostEqual(self.pos["spot"], 100.02)
        self.assertAlmostEqual(self.pos["fut"], 100.60)
        self.assertAlmostEqual(self.pos["entry_fee_usd"],
                               (100.02 * 0.001 + 100.60 * 0.0005) * 2)

    def test_close_quote_mirror(self):
        spot_px, fut_px = b.close_fills(self.pos, 100.40, 100.42, 100.22, 100.24)
        self.assertAlmostEqual(spot_px, 100.40)
        self.assertAlmostEqual(fut_px, 100.24)

    def test_close_basis_negative_after_convergence(self):
        got = b.close_basis_bps(self.pos, 100.40, 100.42, 100.22, 100.24)
        self.assertLess(got, 0)
        self.assertAlmostEqual(got, -15.95, places=1)

    def test_exit_on_convergence(self):
        reason = b.exit_reason(self.pos, 100.40, 100.42, 100.22, 100.24, 1100)
        self.assertEqual(reason, "converged")

    def test_no_exit_while_basis_wide(self):
        reason = b.exit_reason(self.pos, 100.00, 100.02, 100.60, 100.62, 1100)
        self.assertIsNone(reason)

    def test_timeout_has_priority(self):
        reason = b.exit_reason(self.pos, 100.40, 100.42, 100.22, 100.24,
                               self.pos["opened_at"] + b.MAX_HOLDING_S)
        self.assertEqual(reason, "timeout")

    def test_pnl_matches_basis_and_fees(self):
        result = b.close_position(self.pos, 100.40, 100.42, 100.22, 100.24, 1100)
        self.assertAlmostEqual(result["pnl_gross"], 1.48)
        self.assertAlmostEqual(result["exit_fee_usd"], (100.40 * 0.001 + 100.24 * 0.0005) * 2)
        self.assertAlmostEqual(result["pnl_net"],
                               1.48 - result["entry_fee_usd"] - result["exit_fee_usd"])
        self.assertGreater(result["pnl_net"], 0.8)

    def test_pnl_identity_for_long_fut(self):
        signal = b.entry_signal(100.60, 100.62, 100.00, 100.04, entry_bps=10)
        pos = b.open_position(signal, 1, 0, 100.60, 100.62, 100.00, 100.04)
        result = b.close_position(pos, 100.20, 100.22, 100.50, 100.52, 60)
        self.assertAlmostEqual(result["pnl_gross"], 0.84)
        self.assertAlmostEqual(result["close_basis_bps"], -27.90, places=1)
        self.assertAlmostEqual(result["pnl_net"], 0.84 - 0.15062 - 0.15047,
                               places=6)

    def test_quantity_scales_pnl(self):
        one = b.open_position(self.signal, 1, 0, 100.00, 100.02, 100.60, 100.62)
        result = b.close_position(one, 100.40, 100.42, 100.22, 100.24, 60)
        self.assertAlmostEqual(result["pnl_gross"], 0.74)


class PaperBookTests(unittest.TestCase):
    def setUp(self):
        self.signal = b.entry_signal(100.00, 100.02, 100.60, 100.62,
                                     entry_bps=10, fee_bps=0)
        self.book = b.PaperBook(notional_usd=1003.1, holding_s=60,
                                exit_bps=2)
        self.entry = (100.00, 100.02, 100.60, 100.62)
        self.converged = (100.40, 100.42, 100.22, 100.24)

    def open(self, now=0):
        return self.book.update("BTC", self.signal, *self.entry, now)

    def test_open_sizes_by_notional(self):
        event = self.open()
        self.assertEqual(event["action"], "open")
        self.assertAlmostEqual(event["position"]["qty"], 10.0)
        self.assertEqual(len(self.book.positions), 1)
        self.assertEqual(self.book.closed, [])

    def test_no_signal_no_position(self):
        self.assertIsNone(self.book.update("BTC", None, *self.entry, 0))
        self.assertEqual(self.book.positions, {})

    def test_single_position_per_key(self):
        self.open()
        event = self.book.update("BTC", self.signal, *self.entry, 5)
        self.assertEqual(event["action"], "hold")
        self.assertEqual(len(self.book.positions), 1)

    def test_hold_tracks_best_close_basis(self):
        self.open()
        mid = (100.20, 100.22, 100.40, 100.42)
        self.book.update("BTC", None, *mid, 5)
        self.assertAlmostEqual(self.book.positions["BTC"]["min_close_bps"],
                               21.93, places=1)

    def test_convergence_closes_with_pnl(self):
        self.open()
        event = self.book.update("BTC", None, *self.converged, 10)
        trade = event["trade"]
        self.assertEqual(event["action"], "close")
        self.assertEqual(trade["reason"], "converged")
        self.assertAlmostEqual(trade["held_s"], 10)
        self.assertAlmostEqual(trade["pnl_gross"], 7.4)
        self.assertAlmostEqual(trade["pnl_net"], 7.4 - 1.5032 - 1.5052, places=6)
        self.assertEqual(self.book.positions, {})
        self.assertEqual(len(self.book.closed), 1)

    def test_timeout_closes_at_a_loss(self):
        self.open()
        event = self.book.update("BTC", None, *self.entry, 60)
        trade = event["trade"]
        self.assertEqual(trade["reason"], "timeout")
        self.assertAlmostEqual(trade["pnl_gross"], -0.4)
        self.assertLess(trade["pnl_net"], 0)

    def test_snapshot_reports_age(self):
        self.open()
        snap = self.book.snapshot(12)
        self.assertEqual(len(snap), 1)
        self.assertAlmostEqual(snap[0]["age_s"], 12)
        self.assertEqual(snap[0]["underlying"], "BTC")


if __name__ == "__main__":
    unittest.main()
