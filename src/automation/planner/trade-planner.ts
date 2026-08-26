import type { PlannerContext, TradePlan } from "./types";
import type { EntryPlanner } from "./entry-planner";
import { DefaultEntryPlanner } from "./entry-planner";
import type { StopLossPlanner } from "./stop-loss-planner";
import { DefaultStopLossPlanner } from "./stop-loss-planner";
import type { TakeProfitPlanner } from "./take-profit-planner";
import { DefaultTakeProfitPlanner } from "./take-profit-planner";
import type { RiskRewardValidator } from "./risk-reward-validator";
import { DefaultRiskRewardValidator } from "./risk-reward-validator";
import type { TradeValidator } from "./trade-validator";
import { DefaultTradeValidator } from "./trade-validator";

export interface TradePlanner {
  plan(context: PlannerContext): TradePlan;
}

export class DefaultTradePlanner implements TradePlanner {
  constructor(
    private readonly entryPlanner: EntryPlanner = new DefaultEntryPlanner(),
    private readonly stopLossPlanner: StopLossPlanner = new DefaultStopLossPlanner(),
    private readonly takeProfitPlanner: TakeProfitPlanner = new DefaultTakeProfitPlanner(),
    private readonly riskRewardValidator: RiskRewardValidator = new DefaultRiskRewardValidator(),
    private readonly tradeValidator: TradeValidator = new DefaultTradeValidator(),
  ) {}

  plan(context: PlannerContext): TradePlan {
    const expiryTime = this.computeExpiryTime(context.config.orderExpiryMinutes);
    const decision = context.strategyDecision;

    if (decision.signal === "WAIT") {
      return this.waitPlan(context, "Strategy engine returned WAIT; no actionable signal.", expiryTime);
    }

    const minConfidence = context.config.minConfidence ?? 0.55;
    if (decision.confidence < minConfidence) {
      return this.waitPlan(
        context,
        `Signal confidence ${decision.confidence.toFixed(2)} is below the minimum of ${minConfidence}.`,
        expiryTime,
      );
    }

    const entry = this.entryPlanner.plan(context);
    if (!entry) {
      return this.waitPlan(context, "Entry planner could not derive a valid LIMIT entry price.", expiryTime);
    }

    const stopLoss = this.stopLossPlanner.plan(context, entry.entryPrice);
    if (!stopLoss) {
      return this.waitPlan(context, "Stop loss planner could not derive a valid stop loss.", expiryTime);
    }

    const takeProfit = this.takeProfitPlanner.plan(context, entry.entryPrice, stopLoss.stopLoss);
    if (!takeProfit) {
      return this.waitPlan(context, "Take profit planner could not derive a valid take profit.", expiryTime);
    }

    const riskReward = this.riskRewardValidator.validate(context, entry.entryPrice, stopLoss.stopLoss, takeProfit.takeProfit);

    const trade: TradePlan = {
      action: decision.signal,
      entryType: "LIMIT",
      limitPrice: entry.entryPrice,
      stopLoss: stopLoss.stopLoss,
      takeProfit: takeProfit.takeProfit,
      riskRewardRatio: riskReward.riskRewardRatio,
      confidence: decision.confidence,
      reason: this.buildReason(decision.reasons, entry.reason, stopLoss.reason, takeProfit.reason),
      expiryTime,
      symbol: context.config.symbol,
      side: decision.signal,
      entryPrice: entry.entryPrice,
      leverage: context.config.leverage,
    };

    const validation = this.tradeValidator.validate(context, trade);
    if (!validation.valid) {
      return this.waitPlan(context, validation.reason, expiryTime);
    }

    return trade;
  }

  private waitPlan(context: PlannerContext, reason: string, expiryTime: string): TradePlan {
    return {
      action: "WAIT",
      entryType: "NONE",
      limitPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskRewardRatio: null,
      confidence: context.strategyDecision.confidence,
      reason,
      expiryTime,
      symbol: context.config.symbol,
      side: "WAIT",
      entryPrice: null,
      leverage: context.config.leverage,
    };
  }

  private buildReason(...parts: Array<string | string[]>): string {
    return parts
      .flat()
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
  }

  private computeExpiryTime(orderExpiryMinutes?: number): string {
    const minutes = orderExpiryMinutes && orderExpiryMinutes > 0 ? orderExpiryMinutes : 120;
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }
}
