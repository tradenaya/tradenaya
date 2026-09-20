import type { PlannerContext, PlannerValidationResult } from "./types";
import { evaluateLiquidationSafety } from "@/automation/risk/liquidation-safety";
import { resolveMinRiskReward } from "./risk-reward-constants";

export interface RiskRewardValidator {
  validate(context: PlannerContext, entryPrice: number, stopLoss: number, takeProfit: number): PlannerValidationResult;
}

export class DefaultRiskRewardValidator implements RiskRewardValidator {
  validate(context: PlannerContext, entryPrice: number, stopLoss: number, takeProfit: number): PlannerValidationResult {
    const price = Number(context.currentPrice);
    const atr = Math.max(Number(context.atr) || 0, price * 0.002);
    const reasons: string[] = [];

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return {
        valid: false,
        reason: "Entry price is invalid",
        riskRewardRatio: 0,
      };
    }

    const stopDistance = Math.abs(entryPrice - stopLoss);
    const takeProfitDistance = Math.abs(takeProfit - entryPrice);
    const riskRewardRatio = stopDistance > 0 ? takeProfitDistance / stopDistance : 0;
    const minRiskRewardRatio = resolveMinRiskReward(context.config);
    const minStopDistancePct = context.config.minStopDistancePct ?? 0.008;
    const maxStopDistancePct = context.config.maxStopDistancePct ?? 0.05;
    const maxVolatilityPct = context.config.maxVolatilityPct ?? 0.03;
    const volatilityPct = price > 0 ? atr / price : 0;

    const symbol = context.config.symbol;
    const logLine =
      `[rr] ${symbol} R:R validation — entry ${entryPrice} | SL ${stopLoss} | TP ${takeProfit} | ` +
      `risk distance ${stopDistance.toFixed(6)} | reward distance ${takeProfitDistance.toFixed(6)} | ` +
      `computed R:R ${riskRewardRatio.toFixed(2)} | required min R:R ${minRiskRewardRatio.value} ` +
      `(source: ${minRiskRewardRatio.source}) | comparison ${riskRewardRatio.toFixed(2)} >= ${minRiskRewardRatio.value} ? ${riskRewardRatio >= minRiskRewardRatio.value}`;

    if (riskRewardRatio < minRiskRewardRatio.value) {
      reasons.push(`Risk reward ratio ${riskRewardRatio.toFixed(2)} is below ${minRiskRewardRatio.value}`);
      console.warn(`${logLine} -> REJECT`);
    } else {
      console.log(`${logLine} -> pass`);
    }

    if (stopDistance < price * minStopDistancePct) {
      reasons.push("Stop loss is too close to entry");
    }

    if (stopDistance > price * maxStopDistancePct) {
      reasons.push("Stop loss is too far from entry");
    }

    if (volatilityPct > maxVolatilityPct) {
      reasons.push("Market volatility is too high");
    }

    // Liquidation-safety guard: the planned SL must be reachable before the
    // position is liquidated at the configured leverage.  The same estimator
    // is used in the executor pre-entry gate; this is a defence-in-depth
    // check so the planner never emits a TradePlan with an unsafe SL.
    const liq = evaluateLiquidationSafety({
      side: context.strategyDecision.signal as "BUY" | "SELL",
      entryPrice,
      stopLoss,
      leverage: context.config.leverage,
    });
    if (!liq.ok) {
      reasons.push(liq.reason);
    }

    return {
      valid: reasons.length === 0,
      reason: reasons.length > 0 ? reasons.join("; ") : "Risk requirements satisfied",
      riskRewardRatio,
    };
  }
}