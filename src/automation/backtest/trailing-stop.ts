import type { BacktestPositionSide, SimulatedPosition } from "./types";

export interface TrailingUpdateInput {
  position: SimulatedPosition;
  candleHigh: number;
  candleLow: number;
  candleClose: number;
  distancePct: number;
  activationPct: number;
}

export interface TrailingUpdateResult {
  moved: boolean;
  newStopLoss: number;
  activated: boolean;
  highestPrice: number;
  lowestPrice: number;
}

/**
 * Candle-based trailing stop simulation.
 *
 * Conceptually mirrors the live TrailingStopManager: track the highest (long)
 * / lowest (short) price seen, activate after a minimum favorable move, and
 * trail the stop by `distancePct` once activated. It never moves the stop in a
 * risk-increasing direction, and it never makes exchange calls.
 *
 * Within a candle the simulation is deliberately conservative: trailing
 * updates computed from a candle's high/low take effect from the NEXT candle.
 * Stop/target triggers are always evaluated against the stop level at the
 * START of the candle, so a candle can never both raise the stop and then
 * claim that same stop was hit. This avoids assuming intra-candle ordering
 * that the OHLC data cannot prove.
 */
export class BacktestTrailingStop {
  update(input: TrailingUpdateInput): TrailingUpdateResult {
    const { position, candleHigh, candleLow, candleClose } = input;
    const long = position.side === "LONG";

    let highest = position.highestPrice;
    let lowest = position.lowestPrice;
    if (long) highest = Math.max(highest, candleHigh);
    else lowest = Math.min(lowest, candleLow);

    const entry = position.entryPrice;
    const favorableMove = long ? (candleClose - entry) / entry : (entry - candleClose) / entry;
    const activated = position.trailingActivated || favorableMove >= input.activationPct;

    if (!activated) {
      return { moved: false, newStopLoss: position.stopLoss, activated, highestPrice: highest, lowestPrice: lowest };
    }

    const distancePct = input.distancePct / 100;
    const rawCandidate = long ? highest * (1 - distancePct) : lowest * (1 + distancePct);
    const candidate = long ? Math.min(rawCandidate, candleClose) : Math.max(rawCandidate, candleClose);

    const current = position.stopLoss;
    const isBetter = long ? candidate > current : candidate < current;

    if (!isBetter) {
      return { moved: false, newStopLoss: current, activated, highestPrice: highest, lowestPrice: lowest };
    }

    return { moved: true, newStopLoss: candidate, activated, highestPrice: highest, lowestPrice: lowest };
  }
}
