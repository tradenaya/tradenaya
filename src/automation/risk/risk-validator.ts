import type { RiskCheckResult, RiskManagerConfig, WalletInfo } from "./types";
import type { TradePlan } from "@/automation/planner/types";

export interface RiskValidatorInput {
  plan: TradePlan;
  leverage: number;
  riskPercentage: number;
  wallet: WalletInfo;
  config: RiskManagerConfig;
}

export interface RiskValidator {
  check(input: RiskValidatorInput): RiskCheckResult[];
}

export class DefaultRiskValidator implements RiskValidator {
  check(input: RiskValidatorInput): RiskCheckResult[] {
    const { plan, leverage, riskPercentage, wallet, config } = input;
    const tolerance = config.tolerance ?? 1e-9;
    const checks: RiskCheckResult[] = [];

    const riskReward = Number(plan.riskRewardRatio);
    if (!Number.isFinite(riskReward) || riskReward + tolerance < config.minRiskRewardRatio) {
      checks.push({
        name: "risk-reward",
        passed: false,
        message: `Risk reward ratio ${Number.isFinite(riskReward) ? riskReward.toFixed(2) : "N/A"} is below the minimum of ${config.minRiskRewardRatio}.`,
      });
    } else {
      checks.push({
        name: "risk-reward",
        passed: true,
        message: `Risk reward ratio ${riskReward.toFixed(2)} meets the minimum of ${config.minRiskRewardRatio}.`,
      });
    }

    if (riskPercentage - tolerance > config.maxRiskPerTradePct) {
      checks.push({
        name: "max-risk-per-trade",
        passed: false,
        message: `Expected risk ${riskPercentage.toFixed(2)}% exceeds the maximum of ${config.maxRiskPerTradePct}% per trade.`,
      });
    } else {
      checks.push({
        name: "max-risk-per-trade",
        passed: true,
        message: `Expected risk ${riskPercentage.toFixed(2)}% is within the maximum of ${config.maxRiskPerTradePct}%.`,
      });
    }

    if (leverage - tolerance > config.maxLeverage) {
      checks.push({
        name: "max-leverage",
        passed: false,
        message: `Selected leverage ${leverage} exceeds the maximum allowed of ${config.maxLeverage}.`,
      });
    } else {
      checks.push({
        name: "max-leverage",
        passed: true,
        message: `Leverage ${leverage} is within the maximum of ${config.maxLeverage}.`,
      });
    }

    if (Number(wallet.balance) < config.minWalletBalance) {
      checks.push({
        name: "min-wallet-balance",
        passed: false,
        message: `Wallet balance ${Number(wallet.balance).toFixed(2)} is below the required minimum of ${config.minWalletBalance}.`,
      });
    } else {
      checks.push({
        name: "min-wallet-balance",
        passed: true,
        message: "Wallet balance meets the minimum requirement.",
      });
    }

    return checks;
  }
}
