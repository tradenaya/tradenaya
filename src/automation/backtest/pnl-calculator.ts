import type { BacktestPositionSide } from "./types";
import { Money } from "./decimal";

export interface PnLCalculation {
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  totalFee: number;
  netPnl: number;
  returnPct: number;
}

export interface PnLCalculatorInput {
  side: BacktestPositionSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  margin: number;
  feeRateBps: number;
}

/**
 * Simulated PnL. Mirrors the live PositionPnLCalculator conventions
 * (gross = (exit-entry)*qty for longs, (entry-exit)*qty for shorts; fee =
 * notional * rate per side) but returns the backtest's structured breakdown.
 * All monetary results are fixed-point Money values.
 */
export class BacktestPnLCalculator {
  compute(input: PnLCalculatorInput): PnLCalculation {
    const notionalEntry = input.entryPrice * input.quantity;
    const notionalExit = input.exitPrice * input.quantity;

    const gross =
      input.side === "LONG"
        ? (input.exitPrice - input.entryPrice) * input.quantity
        : (input.entryPrice - input.exitPrice) * input.quantity;

    const feeRate = input.feeRateBps / 10_000;

    const entryFeeMoney = Money.fromNumber(notionalEntry * feeRate);
    const exitFeeMoney = Money.fromNumber(notionalExit * feeRate);
    const grossMoney = Money.fromNumber(gross);
    const totalFeeMoney = entryFeeMoney.add(exitFeeMoney);
    const netMoney = grossMoney.sub(totalFeeMoney);

    const margin = input.margin > 0 ? input.margin : Math.abs(notionalEntry) || 1;
    const returnPct = (netMoney.toNumber() / margin) * 100;

    return {
      grossPnl: grossMoney.toNumber(),
      entryFee: entryFeeMoney.toNumber(),
      exitFee: exitFeeMoney.toNumber(),
      totalFee: totalFeeMoney.toNumber(),
      netPnl: netMoney.toNumber(),
      returnPct,
    };
  }
}
