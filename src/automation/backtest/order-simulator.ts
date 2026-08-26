import type { MarketCandle } from "@/automation/types";
import type { BacktestExecutionPolicy, BacktestExitReason, BacktestPositionSide, SimulatedOrder, SimulatedPosition } from "./types";

export interface ExitCheckResult {
  triggered: boolean;
  exitReason: BacktestExitReason;
  exitPrice: number;
}

export interface OrderFillResult {
  filled: boolean;
  fillPrice: number;
}

/**
 * Deterministic execution-policy model for a candle-level backtest.
 *
 * OHLC candles cannot reveal the intra-candle sequence of prices, so the
 * simulation makes explicit, documented assumptions:
 *
 *  - A BUY  LIMIT at X fills when candle.low  <= X (fill at X).
 *  - A SELL LIMIT at X fills when candle.high >= X (fill at X).
 *  - For a LONG,  TP is reachable when high >= TP and SL when low <= SL.
 *  - For a SHORT, TP is reachable when low <= TP and SL when high >= SL.
 *  - When TP and SL are both reachable in one candle, the configured policy
 *    decides which is assumed to have executed first
 *    (CONSERVATIVE / STOP_FIRST assume SL first; TARGET_FIRST assumes TP first).
 */
export class BacktestOrderSimulator {
  constructor(private readonly policy: BacktestExecutionPolicy = "CONSERVATIVE") {}

  /** True when the LIMIT entry could have filled during this candle. */
  limitFillable(order: SimulatedOrder, candle: MarketCandle): boolean {
    if (order.side === "BUY") return candle.low <= order.limitPrice;
    return candle.high >= order.limitPrice;
  }

  /** Fill price for a limit entry is the limit price itself. */
  fillPrice(order: SimulatedOrder): number {
    return order.limitPrice;
  }

  /**
   * Evaluate whether an open position's TP/SL is triggered by a candle.
   * Uses the stop/target levels as of the START of the candle.
   */
  checkExit(position: SimulatedPosition, candle: MarketCandle): ExitCheckResult {
    const long = position.side === "LONG";
    const tpReached = long ? candle.high >= position.takeProfit : candle.low <= position.takeProfit;
    const slReached = long ? candle.low <= position.stopLoss : candle.high >= position.stopLoss;

    if (!tpReached && !slReached) {
      return { triggered: false, exitReason: "OTHER", exitPrice: position.currentPrice ?? candle.close };
    }

    if (tpReached && slReached) {
      const targetFirst = this.policy === "TARGET_FIRST";
      return targetFirst
        ? { triggered: true, exitReason: "TAKE_PROFIT", exitPrice: position.takeProfit }
        : { triggered: true, exitReason: "STOP_LOSS", exitPrice: position.stopLoss };
    }

    if (tpReached) {
      return { triggered: true, exitReason: "TAKE_PROFIT", exitPrice: position.takeProfit };
    }

    return { triggered: true, exitReason: "STOP_LOSS", exitPrice: position.stopLoss };
  }
}

/**
 * Apply adverse slippage to an exit fill price.
 * Slippage always works against the simulated trade:
 *  - LONG exits are sells -> fill lower than the raw price.
 *  - SHORT exits are buys  -> fill higher than the raw price.
 */
export function applyExitSlippage(rawPrice: number, side: BacktestPositionSide, slippageBps: number): number {
  if (!(slippageBps > 0)) return rawPrice;
  const factor = slippageBps / 10_000;
  return side === "LONG" ? rawPrice * (1 - factor) : rawPrice * (1 + factor);
}
