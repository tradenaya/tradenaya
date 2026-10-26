export interface PositionSizeInput {
  allocatedCapital: number;
  leverage: number;
  maxRiskPerTradePct: number;
  side: "BUY" | "SELL";
  limitPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** RISKY trade style: use the whole allocated capital as margin (no max-risk cap). */
  fullAllocation?: boolean;
}

export interface PositionSizeResult {
  positionSize: number;
  notional: number;
  margin: number;
  expectedLoss: number;
  expectedProfit: number;
  riskPercentage: number;
  valid: boolean;
  reason: string;
}

export interface PositionSizeCalculator {
  calculate(input: PositionSizeInput): PositionSizeResult;
}

export class DefaultPositionSizeCalculator implements PositionSizeCalculator {
  calculate(input: PositionSizeInput): PositionSizeResult {
    const { allocatedCapital, leverage, maxRiskPerTradePct, side, limitPrice, stopLoss, takeProfit, fullAllocation } = input;

    if (!(allocatedCapital > 0)) return this.invalid("Allocated capital must be greater than zero.");
    if (!(leverage > 0)) return this.invalid("Leverage must be greater than zero.");
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) return this.invalid("Limit entry price is invalid.");
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) return this.invalid("Stop loss is invalid.");
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) return this.invalid("Take profit is invalid.");

    const stopDistance = side === "BUY" ? limitPrice - stopLoss : stopLoss - limitPrice;
    if (!(stopDistance > 0)) return this.invalid("Stop loss must be on the losing side of the entry price.");

    const takeProfitDistance = side === "BUY" ? takeProfit - limitPrice : limitPrice - takeProfit;
    if (!(takeProfitDistance > 0)) return this.invalid("Take profit must be on the winning side of the entry price.");

    const capitalCappedSize = (allocatedCapital * leverage) / limitPrice;
    let positionSize: number;
    if (fullAllocation) {
      // RISKY: the whole allocated capital is the margin; the stop-loss still
      // limits the loss, but no longer to max-risk-per-trade.
      positionSize = capitalCappedSize;
    } else {
      const riskAmount = allocatedCapital * (maxRiskPerTradePct / 100);
      if (!(riskAmount > 0)) return this.invalid("Computed risk amount is zero.");
      positionSize = Math.min(riskAmount / stopDistance, capitalCappedSize);
    }

    if (!Number.isFinite(positionSize) || positionSize <= 0) return this.invalid("Position size is invalid.");

    const notional = positionSize * limitPrice;
    const margin = notional / leverage;
    const expectedLoss = stopDistance * positionSize;
    const expectedProfit = takeProfitDistance * positionSize;
    const riskPercentage = (expectedLoss / allocatedCapital) * 100;

    return {
      positionSize,
      notional,
      margin,
      expectedLoss,
      expectedProfit,
      riskPercentage,
      valid: true,
      reason: fullAllocation
        ? "Risky trade style: position uses the whole allocated capital as margin."
        : "Position sized against configured risk and capital limits.",
    };
  }

  private invalid(reason: string): PositionSizeResult {
    return {
      positionSize: 0,
      notional: 0,
      margin: 0,
      expectedLoss: 0,
      expectedProfit: 0,
      riskPercentage: 0,
      valid: false,
      reason,
    };
  }
}
