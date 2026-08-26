import type { MarketCandle } from "@/automation/types";
import type { BacktestExitReason, BacktestTrade, SimulatedOrder, SimulatedPosition } from "./types";
import { BacktestPnLCalculator } from "./pnl-calculator";

export interface OpenPositionInput {
  order: SimulatedOrder;
  fillPrice: number;
  fillTime: number;
  candle: MarketCandle;
  feeRateBps: number;
}

export interface ClosePositionResult {
  position: SimulatedPosition;
  trade: BacktestTrade;
}

/**
 * Simulated position lifecycle. Mirrors the live Position Manager states
 * (WAITING_ENTRY -> ENTRY_PENDING -> ENTRY_EXECUTED -> PROTECTED/TRAILING ->
 * CLOSING -> CLOSED) but in pure simulation with no exchange calls and no
 * shared live state.
 */
export class BacktestPositionManager {
  private readonly pnl = new BacktestPnLCalculator();
  private positionSeq = 0;

  open(input: OpenPositionInput): SimulatedPosition {
    const long = input.order.side === "BUY";
    return {
      id: ++this.positionSeq,
      symbol: input.order.symbol,
      side: long ? "LONG" : "SHORT",
      state: "OPEN",
      quantity: input.order.quantity,
      entryPrice: input.fillPrice,
      entryTime: input.fillTime,
      stopLoss: input.order.stopLoss,
      takeProfit: input.order.takeProfit,
      leverage: input.order.leverage,
      margin: input.order.margin,
      trailingEnabled: input.order.trailingEnabled,
      trailingDistancePct: input.order.trailingDistancePct,
      trailingActivationPct: input.order.trailingActivationPct,
      trailingActivated: false,
      highestPrice: long ? Math.max(input.fillPrice, input.candle.high) : input.fillPrice,
      lowestPrice: long ? input.fillPrice : Math.min(input.fillPrice, input.candle.low),
      currentPrice: input.candle.close,
      exitPrice: null,
      exitTime: null,
      exitReason: null,
      grossPnl: null,
      netPnl: null,
      totalFees: null,
      mfe: 0,
      mae: 0,
    };
  }

  /** Track MFE/MAE from a candle while the position is open. */
  observe(position: SimulatedPosition, candle: MarketCandle): void {
    if (position.state !== "OPEN") return;
    const long = position.side === "LONG";
    const mfe = long ? candle.high - position.entryPrice : position.entryPrice - candle.low;
    const mae = long ? position.entryPrice - candle.low : candle.high - position.entryPrice;
    position.mfe = Math.max(position.mfe, mfe);
    position.mae = Math.max(position.mae, mae);
    position.highestPrice = long ? Math.max(position.highestPrice, candle.high) : position.highestPrice;
    position.lowestPrice = long ? position.lowestPrice : Math.min(position.lowestPrice, candle.low);
    position.currentPrice = candle.close;
  }

  /** Apply a trailing-stop candidate produced by BacktestTrailingStop. */
  applyTrailing(position: SimulatedPosition, newStopLoss: number, activated: boolean): void {
    if (position.state !== "OPEN") return;
    position.stopLoss = newStopLoss;
    position.trailingActivated = position.trailingActivated || activated;
  }

  /**
   * Close a position at `exitPrice` and produce the trade record. Fees and PnL
   * reuse BacktestPnLCalculator so the rules match the live calculator.
   */
  close(position: SimulatedPosition, exitTime: number, exitPrice: number, exitReason: BacktestExitReason, feeRateBps: number): ClosePositionResult {
    const calculation = this.pnl.compute({
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice,
      margin: position.margin,
      feeRateBps,
    });

    position.state = "CLOSED";
    position.exitPrice = exitPrice;
    position.exitTime = exitTime;
    position.exitReason = exitReason;
    position.currentPrice = exitPrice;
    position.grossPnl = calculation.grossPnl;
    position.netPnl = calculation.netPnl;
    position.totalFees = calculation.totalFee;

    const trade: BacktestTrade = {
      tradeId: `bt_${position.id}`,
      backtestId: 0,
      symbol: position.symbol,
      side: position.side,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      exitTime,
      exitPrice,
      quantity: position.quantity,
      leverage: position.leverage,
      margin: position.margin,
      grossPnl: calculation.grossPnl,
      entryFee: calculation.entryFee,
      exitFee: calculation.exitFee,
      totalFee: calculation.totalFee,
      netPnl: calculation.netPnl,
      returnPct: calculation.returnPct,
      maxFavorableExcursion: position.mfe,
      maxAdverseExcursion: position.mae,
      exitReason,
      durationMs: Math.max(0, exitTime - position.entryTime),
      plannedRiskReward: this.plannedRiskReward(position),
    };

    return { position, trade };
  }

  private plannedRiskReward(position: SimulatedPosition): number {
    const stopDistance = Math.abs(position.entryPrice - position.stopLoss);
    const targetDistance = Math.abs(position.takeProfit - position.entryPrice);
    if (!(stopDistance > 0)) return 0;
    return targetDistance / stopDistance;
  }
}
