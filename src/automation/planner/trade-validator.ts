import type { PlannerContext, PlannerValidationResult, TradePlan } from "./types";
import type { RiskRewardValidator } from "./risk-reward-validator";
import { DefaultRiskRewardValidator } from "./risk-reward-validator";

export interface TradeValidator {
  validate(context: PlannerContext, trade: TradePlan): PlannerValidationResult;
}

export class DefaultTradeValidator implements TradeValidator {
  constructor(
    private readonly riskRewardValidator: RiskRewardValidator = new DefaultRiskRewardValidator(),
  ) {}

  validate(context: PlannerContext, trade: TradePlan): PlannerValidationResult {
    if (trade.action === "WAIT") {
      return { valid: true, reason: trade.reason, riskRewardRatio: 0 };
    }

    const reasons: string[] = [];

    const price = Number(context.currentPrice);
    const limitPrice = Number(trade.limitPrice);
    const stopLoss = Number(trade.stopLoss);
    const takeProfit = Number(trade.takeProfit);

    if (!Number.isFinite(price) || price <= 0) {
      reasons.push("Current price is invalid");
    }

    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      reasons.push("Limit entry price is invalid");
    }

    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      reasons.push("Stop loss is invalid");
    }

    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      reasons.push("Take profit is invalid");
    }

    if (trade.entryType !== "LIMIT") {
      reasons.push("Entry must be a LIMIT order");
    }

    if (reasons.length > 0) {
      return this.result(false, reasons, trade);
    }

    if (trade.action === "BUY") {
      if (limitPrice > price) reasons.push("BUY limit price must be at or below the current price");
      if (stopLoss >= limitPrice) reasons.push("BUY stop loss must be below the entry price");
      if (takeProfit <= limitPrice) reasons.push("BUY take profit must be above the entry price");
    } else if (trade.action === "SELL") {
      if (limitPrice < price) reasons.push("SELL limit price must be at or above the current price");
      if (stopLoss <= limitPrice) reasons.push("SELL stop loss must be above the entry price");
      if (takeProfit >= limitPrice) reasons.push("SELL take profit must be below the entry price");
    } else {
      reasons.push("Action must be BUY or SELL for a trade plan");
    }

    const maxLimitDistancePct = context.config.maxStopDistancePct ?? 0.05;
    const limitDistancePct = Math.abs(limitPrice - price) / price;
    if (limitDistancePct > maxLimitDistancePct) {
      reasons.push("Limit entry price is too far from the current price");
    }

    const minConfidence = context.config.minConfidence ?? 0.55;
    if (trade.confidence < minConfidence) {
      reasons.push(`Signal confidence ${trade.confidence.toFixed(2)} is below ${minConfidence}`);
    }

    const riskReward = this.riskRewardValidator.validate(context, limitPrice, stopLoss, takeProfit);
    if (!riskReward.valid) {
      reasons.push(riskReward.reason);
    }

    return this.result(reasons.length === 0, reasons, trade, riskReward.riskRewardRatio);
  }

  private result(valid: boolean, reasons: string[], trade: TradePlan, riskRewardRatio?: number): PlannerValidationResult {
    return {
      valid,
      reason: valid ? "Trade setup satisfies all validation rules" : reasons.join("; "),
      riskRewardRatio: valid ? Number(trade.riskRewardRatio) || riskRewardRatio || 0 : 0,
    };
  }
}
