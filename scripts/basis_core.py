"""Cash-and-carry basis logic ported from HTF-Nano-Tick (C++20).

Upstream (`include/strategy/StrategyEngine.hpp`) compares the futures bid with
the spot ask and opens a paired trade when the absolute basis exceeds a
threshold, closing when the basis drops below a smaller threshold or after
maxHoldingPeriodNanos (300 s). Its comments say 0.1% / 0.02% but the code uses
absolute prices (0.001 / 0.0002), which does not scale across assets; this port
keeps the percentages and expresses them in basis points.

The upstream skeleton has no fee model. A round trip pays four taker fees
(spot buy, futures sell, spot sell, futures buy), so callers net them out
before treating a signal as tradable.

Pure functions: no network, no orders, no MetaTrader5 import.
"""

ENTRY_BPS = 10.0
EXIT_BPS = 2.0
MAX_HOLDING_S = 300.0
SPOT_FEE_BPS = 10.0  # OKX taker, spot
FUT_FEE_BPS = 5.0    # OKX taker, USDT perpetual

LONG_SPOT = "long_spot_short_fut"
LONG_FUT = "long_fut_short_spot"


def valid_book(bid, ask):
    return bid is not None and ask is not None and bid > 0 and ask >= bid


def mid(bid, ask):
    return (bid + ask) / 2.0


def reference_price(spot_bid, spot_ask, fut_bid, fut_ask):
    return (mid(spot_bid, spot_ask) + mid(fut_bid, fut_ask)) / 2.0


def to_bps(edge, reference):
    return edge / reference * 10000.0 if reference else 0.0


def edges(spot_bid, spot_ask, fut_bid, fut_ask):
    """Executable basis for each direction, in quote currency."""
    return {
        LONG_SPOT: fut_bid - spot_ask,
        LONG_FUT: spot_bid - fut_ask,
    }


def round_trip_fee_bps(spot_fee_bps=SPOT_FEE_BPS, fut_fee_bps=FUT_FEE_BPS):
    return 2.0 * (spot_fee_bps + fut_fee_bps)


def study(spot_bid, spot_ask, fut_bid, fut_ask, fee_bps=0.0):
    """Basis snapshot; None when a book is crossed or empty."""
    if not (valid_book(spot_bid, spot_ask) and valid_book(fut_bid, fut_ask)):
        return None
    reference = reference_price(spot_bid, spot_ask, fut_bid, fut_ask)
    sides = {}
    for side, edge in edges(spot_bid, spot_ask, fut_bid, fut_ask).items():
        gross = to_bps(edge, reference)
        sides[side] = {"edge": edge, "bps": gross, "net_bps": gross - fee_bps}
    best = max(sides, key=lambda side: sides[side]["net_bps"])
    return {"reference": reference, "best": best, "sides": sides}


def entry_signal(spot_bid, spot_ask, fut_bid, fut_ask,
                 entry_bps=ENTRY_BPS, fee_bps=0.0, min_net_bps=0.0):
    state = study(spot_bid, spot_ask, fut_bid, fut_ask, fee_bps)
    if state is None:
        return None
    side = state["best"]
    best = state["sides"][side]
    if best["bps"] < entry_bps or best["net_bps"] < min_net_bps:
        return None
    return {"side": side, "edge": best["edge"], "edge_bps": best["bps"],
            "net_bps": best["net_bps"], "reference": state["reference"]}


def open_position(signal, qty, now, spot_bid, spot_ask, fut_bid, fut_ask,
                  spot_fee_bps=SPOT_FEE_BPS, fut_fee_bps=FUT_FEE_BPS):
    side = signal["side"]
    if side == LONG_SPOT:
        spot_px, fut_px = spot_ask, fut_bid
    elif side == LONG_FUT:
        spot_px, fut_px = spot_bid, fut_ask
    else:
        raise ValueError(f"side tidak dikenal: {side}")
    fee = (spot_px * spot_fee_bps + fut_px * fut_fee_bps) / 10000.0 * qty
    return {"side": side, "qty": qty, "opened_at": now,
            "spot": spot_px, "fut": fut_px, "entry_basis": signal["edge"],
            "entry_basis_bps": signal["edge_bps"], "entry_fee_usd": fee}


def close_fills(position, spot_bid, spot_ask, fut_bid, fut_ask):
    if position["side"] == LONG_SPOT:
        return spot_bid, fut_ask
    return spot_ask, fut_bid


def close_basis_bps(position, spot_bid, spot_ask, fut_bid, fut_ask):
    """Cost to unwind, in bps of the average mid (negative = locked profit)."""
    spot_px, fut_px = close_fills(position, spot_bid, spot_ask, fut_bid, fut_ask)
    sign = 1.0 if position["side"] == LONG_SPOT else -1.0
    return to_bps(sign * (fut_px - spot_px),
                  reference_price(spot_bid, spot_ask, fut_bid, fut_ask))


def exit_reason(position, spot_bid, spot_ask, fut_bid, fut_ask, now,
                exit_bps=EXIT_BPS, max_holding_s=MAX_HOLDING_S):
    if now - position["opened_at"] >= max_holding_s:
        return "timeout"
    if close_basis_bps(position, spot_bid, spot_ask, fut_bid, fut_ask) <= exit_bps:
        return "converged"
    return None


def close_position(position, spot_bid, spot_ask, fut_bid, fut_ask, now,
                   spot_fee_bps=SPOT_FEE_BPS, fut_fee_bps=FUT_FEE_BPS,
                   reason=None):
    spot_px, fut_px = close_fills(position, spot_bid, spot_ask, fut_bid, fut_ask)
    if position["side"] == LONG_SPOT:
        gross = (spot_px - position["spot"]) + (position["fut"] - fut_px)
    else:
        gross = (fut_px - position["fut"]) + (position["spot"] - spot_px)
    qty = position["qty"]
    exit_fee = (spot_px * spot_fee_bps + fut_px * fut_fee_bps) / 10000.0 * qty
    pnl_gross = gross * qty
    return {"side": position["side"], "qty": qty,
            "opened_at": position["opened_at"], "closed_at": now,
            "spot_entry": position["spot"], "fut_entry": position["fut"],
            "spot_exit": spot_px, "fut_exit": fut_px,
            "entry_basis_bps": position["entry_basis_bps"],
            "close_basis_bps": close_basis_bps(position, spot_bid, spot_ask,
                                               fut_bid, fut_ask),
            "entry_fee_usd": position["entry_fee_usd"],
            "exit_fee_usd": exit_fee,
            "pnl_gross": pnl_gross,
            "pnl_net": pnl_gross - position["entry_fee_usd"] - exit_fee,
            "reason": reason or "manual"}


class PaperBook:
    """Virtual positions sized by notional; never sends orders.

    One position per key (underlying), mirroring the upstream single-position
    limit. Closing uses executable prices, so the spread is paid on entry and
    exit, and the same fee model as the live signal gates the result.
    """

    def __init__(self, notional_usd=1000.0, holding_s=MAX_HOLDING_S,
                 exit_bps=EXIT_BPS, spot_fee_bps=SPOT_FEE_BPS,
                 fut_fee_bps=FUT_FEE_BPS):
        self.notional_usd = notional_usd
        self.holding_s = holding_s
        self.exit_bps = exit_bps
        self.spot_fee_bps = spot_fee_bps
        self.fut_fee_bps = fut_fee_bps
        self.positions = {}
        self.closed = []

    def update(self, key, signal, spot_bid, spot_ask, fut_bid, fut_ask, now):
        position = self.positions.get(key)
        if position is not None:
            reason = exit_reason(position, spot_bid, spot_ask, fut_bid, fut_ask,
                                 now, self.exit_bps, self.holding_s)
            if reason is None:
                position["min_close_bps"] = min(
                    position["min_close_bps"],
                    close_basis_bps(position, spot_bid, spot_ask, fut_bid, fut_ask))
                return {"action": "hold", "position": position}
            trade = close_position(position, spot_bid, spot_ask, fut_bid, fut_ask,
                                   now, self.spot_fee_bps, self.fut_fee_bps, reason)
            trade.update({"key": key, "held_s": now - position["opened_at"],
                          "min_close_bps": position["min_close_bps"],
                          "notional_usd": position["notional_usd"]})
            del self.positions[key]
            self.closed.append(trade)
            return {"action": "close", "trade": trade}
        if signal is None:
            return None
        qty = self.notional_usd / reference_price(spot_bid, spot_ask,
                                                  fut_bid, fut_ask)
        position = open_position(signal, qty, now, spot_bid, spot_ask,
                                 fut_bid, fut_ask, self.spot_fee_bps,
                                 self.fut_fee_bps)
        position.update({"key": key, "notional_usd": self.notional_usd,
                         "min_close_bps": close_basis_bps(
                             position, spot_bid, spot_ask, fut_bid, fut_ask)})
        self.positions[key] = position
        return {"action": "open", "position": position}

    def snapshot(self, now):
        return [{"underlying": pos["key"], "side": pos["side"],
                 "qty": pos["qty"], "age_s": now - pos["opened_at"],
                 "entry_basis_bps": pos["entry_basis_bps"],
                 "min_close_bps": pos["min_close_bps"]}
                for pos in self.positions.values()]
