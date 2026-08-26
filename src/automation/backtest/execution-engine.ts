import type { MarketCandle } from "@/automation/types";
import type {
  BacktestExecutionPolicy,
  BacktestPositionSide,
  BacktestSide,
  BacktestTrade,
  SimulatedOrder,
  SimulatedPosition,
} from "./types";
import { BacktestOrderSimulator, applyExitSlippage } from "./order-simulator";
import { BacktestTrailingStop } from "./trailing-stop";
import { BacktestPositionManager } from "./position-manager";
import type { BacktestPortfolio } from "./portfolio";

export interface PlaceOrderInput {
  symbol: string;
  side: BacktestSide;
  limitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  leverage: number;
  margin: number;
  createdAt: number;
  expiresAt: number;
  reason: string;
  trailingEnabled: boolean;
  trailingDistancePct: number;
  trailingActivationPct: number;
}

export interface CandleProcessingResult {
  orderFilled: boolean;
  positionClosed: boolean;
  trade?: BacktestTrade;
}

export interface ExecutionEngineOptions {
  feeRateBps: number;
  slippageBps: number;
  executionPolicy: BacktestExecutionPolicy;
  backtestId?: number;
  trailingActivationPct?: number;
}

/**
 * Simulation execution layer.
 *
 * This is the ONLY module that mutates simulated order/position state, and it
 * has ZERO access to the live Order Executor, Position Manager, CoinSwitch
 * client or any API credentials. It depends only on candle data, the
 * configured backtest parameters and the simulated portfolio. Live execution
 * (Risk Manager -> OrderExecutor -> CoinSwitch) and simulated execution
 * (Risk Manager -> BacktestExecutionEngine -> simulated position) are
 * therefore architecturally disjoint — a backtest cannot accidentally place a
 * live order.
 */
export class BacktestExecutionEngine {
  private activeOrder: SimulatedOrder | null = null;
  private openPosition: SimulatedPosition | null = null;
  private readonly trades: BacktestTrade[] = [];
  private orderSeq = 0;
  private readonly orderSimulator: BacktestOrderSimulator;
  private readonly trailing = new BacktestTrailingStop();
  private readonly positions = new BacktestPositionManager();
  private readonly backtestId: number;
  private readonly trailingActivationPct: number;

  constructor(
    private readonly options: ExecutionEngineOptions,
    private readonly portfolio: BacktestPortfolio,
  ) {
    this.orderSimulator = new BacktestOrderSimulator(options.executionPolicy);
    this.backtestId = options.backtestId ?? 0;
    this.trailingActivationPct = options.trailingActivationPct ?? 0;
  }

  getActiveOrder(): SimulatedOrder | null {
    return this.activeOrder;
  }

  getOpenPosition(): SimulatedPosition | null {
    return this.openPosition;
  }

  getTrades(): BacktestTrade[] {
    return this.trades;
  }

  /** True when there is neither a pending entry order nor an open position. */
  isIdle(): boolean {
    return this.activeOrder === null && this.openPosition === null;
  }

  placeOrder(input: PlaceOrderInput): void {
    this.activeOrder = {
      id: ++this.orderSeq,
      symbol: input.symbol,
      side: input.side,
      type: "LIMIT",
      limitPrice: input.limitPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      quantity: input.quantity,
      leverage: input.leverage,
      margin: input.margin,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      reason: input.reason,
      trailingEnabled: input.trailingEnabled,
      trailingDistancePct: input.trailingDistancePct,
      trailingActivationPct: input.trailingActivationPct,
    };
  }

  cancelActiveOrder(): void {
    this.activeOrder = null;
  }

  /**
   * Advance the simulation by one candle. A pending LIMIT entry is evaluated
   * for a fill; an open position is evaluated for TP/SL and trailing updates.
   */
  processCandle(candle: MarketCandle): CandleProcessingResult {
    if (this.openPosition) return this.processOpenPosition(candle);
    if (this.activeOrder) return this.processPendingOrder(candle);
    return { orderFilled: false, positionClosed: false };
  }

  /** Close any still-open position at the final available price (END_OF_BACKTEST). */
  closeAtEndOfBacktest(exitTime: number, finalPrice: number): BacktestTrade | null {
    const position = this.openPosition;
    if (!position) return null;

    // Ensure MFE/MAE account for the final candle before closing.
    const exitPrice = applyExitSlippage(finalPrice, position.side, this.options.slippageBps);
    const { trade } = this.positions.close(position, exitTime, exitPrice, "END_OF_BACKTEST", this.options.feeRateBps);
    this.recordTrade(trade);
    this.portfolio.releaseMargin(position.margin);
    this.portfolio.settleTrade(trade.netPnl, exitTime);
    this.openPosition = null;
    return trade;
  }

  // ---- internals ----

  private processOpenPosition(candle: MarketCandle): CandleProcessingResult {
    const position = this.openPosition as SimulatedPosition;
    this.positions.observe(position, candle);

    const exit = this.orderSimulator.checkExit(position, candle);
    if (exit.triggered) {
      return this.finalizeClose(position, candle.timestamp, exit.exitPrice, exit.exitReason);
    }

    this.updateTrailing(position, candle);
    return { orderFilled: false, positionClosed: false };
  }

  private processPendingOrder(candle: MarketCandle): CandleProcessingResult {
    const order = this.activeOrder as SimulatedOrder;

    if (candle.timestamp > order.expiresAt) {
      this.activeOrder = null;
      return { orderFilled: false, positionClosed: false };
    }

    if (!this.orderSimulator.limitFillable(order, candle)) {
      return { orderFilled: false, positionClosed: false };
    }

    const fillPrice = this.orderSimulator.fillPrice(order);
    const position = this.positions.open({
      order,
      fillPrice,
      fillTime: candle.timestamp,
      candle,
      feeRateBps: this.options.feeRateBps,
    });

    this.portfolio.lockMargin(order.margin);
    this.activeOrder = null;
    this.openPosition = position;

    // The same candle may also reach TP/SL; the configured policy decides.
    const exit = this.orderSimulator.checkExit(position, candle);
    if (exit.triggered) {
      return this.finalizeClose(position, candle.timestamp, exit.exitPrice, exit.exitReason);
    }

    this.updateTrailing(position, candle);
    return { orderFilled: true, positionClosed: false };
  }

  private updateTrailing(position: SimulatedPosition, candle: MarketCandle): void {
    if (!position.trailingEnabled || !position.stopLoss) return;
    const result = this.trailing.update({
      position,
      candleHigh: candle.high,
      candleLow: candle.low,
      candleClose: candle.close,
      distancePct: position.trailingDistancePct,
      activationPct: position.trailingActivationPct,
    });
    if (result.moved) {
      this.positions.applyTrailing(position, result.newStopLoss, result.activated);
    }
  }

  private finalizeClose(position: SimulatedPosition, exitTime: number, rawExitPrice: number, reason: SimulatedPosition["exitReason"]): CandleProcessingResult {
    const exitPrice = applyExitSlippage(rawExitPrice, position.side as BacktestPositionSide, this.options.slippageBps);
    const { trade } = this.positions.close(position, exitTime, exitPrice, reason as BacktestTrade["exitReason"], this.options.feeRateBps);
    this.recordTrade(trade);
    this.portfolio.releaseMargin(position.margin);
    this.portfolio.settleTrade(trade.netPnl, exitTime);
    this.openPosition = null;
    return { orderFilled: false, positionClosed: true, trade };
  }

  private recordTrade(trade: BacktestTrade): void {
    this.trades.push({ ...trade, backtestId: this.backtestId });
  }
}
