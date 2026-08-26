import type { BacktestPositionSide, SimulatedPosition } from "./types";
import { Money } from "./decimal";

export interface DailyStats {
  date: string;
  realizedPnl: Money;
  tradeCount: number;
}

export interface PortfolioWalletSnapshot {
  balance: number;
  equity: number;
  peakBalance: number;
}

/**
 * Simulated account. Tracks realized balance, used margin, unrealized PnL and
 * equity with fixed-point Money so long backtests do not accumulate floating
 * point drift. Realized PnL and fees from a closed trade settle the balance;
 * margin is reserved on entry and released on exit.
 */
export class BacktestPortfolio {
  private balance: Money;
  private usedMargin: Money;
  private unrealized: Money;
  private peakEquity: Money;
  private daily = new Map<string, DailyStats>();

  constructor(
    readonly initialCapital: number,
    private readonly slippageBps: number,
  ) {
    this.balance = Money.fromNumber(initialCapital);
    this.usedMargin = Money.zero();
    this.unrealized = Money.zero();
    this.peakEquity = this.balance;
  }

  getBalance(): number {
    return this.balance.toNumber();
  }

  getUsedMargin(): number {
    return this.usedMargin.toNumber();
  }

  getAvailableBalance(): number {
    return this.balance.sub(this.usedMargin).toNumber();
  }

  getEquity(): number {
    return this.balance.add(this.unrealized).toNumber();
  }

  getPeakEquity(): number {
    return this.peakEquity.toNumber();
  }

  unrealizedPnl(): Money {
    return this.unrealized;
  }

  lockMargin(margin: number): void {
    this.usedMargin = this.usedMargin.add(Money.fromNumber(margin));
  }

  releaseMargin(margin: number): void {
    const amount = Money.fromNumber(margin);
    this.usedMargin = this.usedMargin.sub(amount);
    if (this.usedMargin.isNegative()) this.usedMargin = Money.zero();
  }

  /**
   * Apply the realized result of a closed trade. `netPnl` already includes
   * fees (see BacktestPnLCalculator).
   */
  settleTrade(netPnl: number, exitTimestamp: number): void {
    const pnl = Money.fromNumber(netPnl);
    this.balance = this.balance.add(pnl);
    this.updatePeak();
    this.recordDaily(exitTimestamp, pnl);
  }

  /** Include unrealized PnL of open positions (mark-to-market at a price). */
  markToMarket(positions: SimulatedPosition[], markPrice: number): void {
    let unrealized = Money.zero();
    for (const position of positions) {
      if (position.state !== "OPEN" || !(markPrice > 0)) continue;
      const gross =
        position.side === "LONG"
          ? (markPrice - position.entryPrice) * position.quantity
          : (position.entryPrice - markPrice) * position.quantity;
      unrealized = unrealized.add(Money.fromNumber(gross));
      position.currentPrice = markPrice;
    }
    this.unrealized = unrealized;
    this.updatePeakWith(unrealized);
  }

  updatePeak(): void {
    const equity = this.balance;
    if (equity.gt(this.peakEquity)) this.peakEquity = equity;
  }

  private updatePeakWith(unrealized: Money): void {
    const equity = this.balance.add(unrealized);
    if (equity.gt(this.peakEquity)) this.peakEquity = equity;
  }

  private recordDaily(timestamp: number, pnl: Money): void {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const existing = this.daily.get(date) ?? { date, realizedPnl: Money.zero(), tradeCount: 0 };
    existing.realizedPnl = existing.realizedPnl.add(pnl);
    existing.tradeCount += 1;
    this.daily.set(date, existing);
  }

  dailyStats(date: string): DailyStats {
    return this.daily.get(date) ?? { date, realizedPnl: Money.zero(), tradeCount: 0 };
  }

  walletSnapshot(): PortfolioWalletSnapshot {
    return {
      balance: this.getBalance(),
      equity: this.getEquity(),
      peakBalance: this.getPeakEquity(),
    };
  }

  drawdownPct(): number {
    const peak = this.getPeakEquity();
    const equity = this.getEquity();
    if (!(peak > 0)) return 0;
    return Math.max(0, ((peak - equity) / peak) * 100);
  }
}

export function sideToBacktest(side: string): BacktestPositionSide {
  return String(side ?? "").toUpperCase() === "SELL" ? "SHORT" : "LONG";
}
