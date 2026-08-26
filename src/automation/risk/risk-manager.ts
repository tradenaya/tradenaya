import type { RiskAssessment, RiskConfig } from "@/automation/types";
import type { CapitalAllocation } from "./capital-allocation";
import { DefaultCapitalAllocation } from "./capital-allocation";
import type { PositionSizeCalculator } from "./position-size-calculator";
import { DefaultPositionSizeCalculator } from "./position-size-calculator";
import type { RiskValidator } from "./risk-validator";
import { DefaultRiskValidator } from "./risk-validator";
import type { DrawdownProtection } from "./drawdown-protection";
import { DefaultDrawdownProtection } from "./drawdown-protection";
import type { DailyLossProtection } from "./daily-loss-protection";
import { DefaultDailyLossProtection } from "./daily-loss-protection";
import type { ExposureManager } from "./exposure-manager";
import { DefaultExposureManager } from "./exposure-manager";
import type { ValidationEngine } from "./validation-engine";
import { DefaultValidationEngine } from "./validation-engine";
import { DEFAULT_RISK_CONFIG } from "./types";
import type { RiskDecision, RiskManagerConfig, RiskManagerInput } from "./types";

export interface RiskManager {
  evaluate(input: RiskManagerInput): RiskDecision;
  assess(config: RiskConfig, entryPrice: number, stopLoss: number, takeProfit: number): RiskAssessment;
}

export class DefaultRiskManager implements RiskManager {
  constructor(
    private readonly capitalAllocation: CapitalAllocation = new DefaultCapitalAllocation(),
    private readonly positionSizeCalculator: PositionSizeCalculator = new DefaultPositionSizeCalculator(),
    private readonly riskValidator: RiskValidator = new DefaultRiskValidator(),
    private readonly drawdownProtection: DrawdownProtection = new DefaultDrawdownProtection(),
    private readonly dailyLossProtection: DailyLossProtection = new DefaultDailyLossProtection(),
    private readonly exposureManager: ExposureManager = new DefaultExposureManager(),
    private readonly validationEngine: ValidationEngine = new DefaultValidationEngine(),
  ) {}

  evaluate(input: RiskManagerInput): RiskDecision {
    const config: RiskManagerConfig = { ...DEFAULT_RISK_CONFIG, ...input.config };

    const allocation = this.capitalAllocation.allocate(
      input.wallet,
      input.capital,
      config.maxCapitalAllocationPct,
      config.minWalletBalance,
    );

    const position = this.positionSizeCalculator.calculate({
      allocatedCapital: allocation.valid ? allocation.allocatedCapital : 0,
      leverage: input.capital.leverage,
      maxRiskPerTradePct: config.maxRiskPerTradePct,
      side: input.plan.action === "SELL" ? "SELL" : "BUY",
      limitPrice: Number(input.plan.limitPrice ?? 0),
      stopLoss: Number(input.plan.stopLoss ?? 0),
      takeProfit: Number(input.plan.takeProfit ?? 0),
    });

    return this.validationEngine.run(input, config, { allocation, position });
  }

  assess(config: RiskConfig, entryPrice: number, stopLoss: number, takeProfit: number): RiskAssessment {
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const takeProfitDistance = Math.abs(takeProfit - entryPrice);
    const riskReward = takeProfitDistance / Math.max(stopDistance, 1e-8);
    const side = takeProfit >= entryPrice ? "BUY" : "SELL";

    const decision = this.evaluate({
      config: {
        maxRiskPerTradePct: config.maxRiskPerTrade,
        maxCapitalAllocationPct: 100,
        dailyLossLimitPct: config.dailyLossLimit,
        maxLeverage: Number.POSITIVE_INFINITY,
        maxSimultaneousPositions: Number.POSITIVE_INFINITY,
        maxSimultaneousBots: Number.POSITIVE_INFINITY,
        dailyTradeLimit: Number.POSITIVE_INFINITY,
        maxDrawdownPct: 100,
        minRiskRewardRatio: 1,
      },
      wallet: { balance: config.capital, equity: config.capital },
      capital: {
        mode: config.capitalMode,
        amount: config.capitalMode === "fixed" ? config.capital : undefined,
        percent: config.capitalMode === "percent" ? config.walletPercent : undefined,
        leverage: config.leverage,
      },
      plan: {
        action: side,
        entryType: "LIMIT",
        limitPrice: entryPrice,
        stopLoss,
        takeProfit,
        riskRewardRatio: riskReward,
        confidence: 1,
        reason: "Backward-compatible risk assessment.",
        expiryTime: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
      },
      openPositions: [],
      openOrders: [],
      daily: { date: new Date().toISOString().slice(0, 10), realizedPnl: 0, tradeCount: 0 },
      runningBots: 0,
    });

    return {
      allowed: decision.approved,
      reason: decision.reason,
      positionSize: decision.positionSize,
      riskAmount: decision.capitalUsed,
      stopLossDistance: stopDistance,
      takeProfitDistance,
      riskReward,
    };
  }
}
