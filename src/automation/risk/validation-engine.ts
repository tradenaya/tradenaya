import type { CapitalAllocationResult } from "./capital-allocation";
import type { PositionSizeResult } from "./position-size-calculator";
import type { RiskCheckResult, RiskDecision, RiskManagerConfig, RiskManagerInput } from "./types";
import type { RiskValidator } from "./risk-validator";
import { DefaultRiskValidator } from "./risk-validator";
import type { DrawdownProtection } from "./drawdown-protection";
import { DefaultDrawdownProtection } from "./drawdown-protection";
import type { DailyLossProtection } from "./daily-loss-protection";
import { DefaultDailyLossProtection } from "./daily-loss-protection";
import type { ExposureManager } from "./exposure-manager";
import { DefaultExposureManager } from "./exposure-manager";

export interface ValidationSizing {
  allocation: CapitalAllocationResult;
  position: PositionSizeResult;
}

export interface ValidationEngine {
  run(input: RiskManagerInput, config: RiskManagerConfig, sizing: ValidationSizing): RiskDecision;
}

export class DefaultValidationEngine implements ValidationEngine {
  constructor(
    private readonly riskValidator: RiskValidator = new DefaultRiskValidator(),
    private readonly drawdownProtection: DrawdownProtection = new DefaultDrawdownProtection(),
    private readonly dailyLossProtection: DailyLossProtection = new DefaultDailyLossProtection(),
    private readonly exposureManager: ExposureManager = new DefaultExposureManager(),
  ) {}

  run(input: RiskManagerInput, config: RiskManagerConfig, sizing: ValidationSizing): RiskDecision {
    const checks: RiskCheckResult[] = [];
    const plan = input.plan;

    const actionable = plan.action !== "WAIT" && plan.entryType === "LIMIT" && plan.limitPrice != null && plan.stopLoss != null && plan.takeProfit != null;
    checks.push(
      actionable
        ? { name: "actionable-plan", passed: true, message: "Trade plan is actionable." }
        : { name: "actionable-plan", passed: false, message: "Trade plan is not actionable (WAIT or missing levels)." },
    );

    checks.push(
      sizing.allocation.valid
        ? { name: "capital-allocation", passed: true, message: sizing.allocation.reason }
        : { name: "capital-allocation", passed: false, message: sizing.allocation.reason },
    );

    checks.push(
      sizing.position.valid
        ? { name: "position-size", passed: true, message: sizing.position.reason }
        : { name: "position-size", passed: false, message: sizing.position.reason },
    );

    checks.push(
      ...this.riskValidator.check({
        plan,
        leverage: input.capital.leverage,
        riskPercentage: sizing.position.riskPercentage,
        wallet: input.wallet,
        config,
      }),
    );

    checks.push(this.drawdownProtection.check(input.wallet, config.maxDrawdownPct));

    checks.push(
      ...this.dailyLossProtection.check(input.daily, input.wallet.balance, config.dailyLossLimitPct, config.dailyTradeLimit),
    );

    checks.push(
      ...this.exposureManager.check({
        symbol: plan.symbol ?? "",
        openPositions: input.openPositions,
        openOrders: input.openOrders,
        runningBots: input.runningBots ?? 0,
        maxSimultaneousPositions: config.maxSimultaneousPositions,
        maxSimultaneousBots: config.maxSimultaneousBots,
      }),
    );

    const failed = checks.filter((check) => !check.passed);
    const approved = failed.length === 0;

    return {
      approved,
      reason: approved ? "Trade approved by all risk checks." : failed.map((check) => check.message).join("; "),
      positionSize: sizing.position.valid ? sizing.position.positionSize : 0,
      capitalUsed: sizing.position.valid ? sizing.position.margin : 0,
      leverage: input.capital.leverage,
      expectedLoss: sizing.position.valid ? sizing.position.expectedLoss : 0,
      expectedProfit: sizing.position.valid ? sizing.position.expectedProfit : 0,
      riskPercentage: sizing.position.valid ? sizing.position.riskPercentage : 0,
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
