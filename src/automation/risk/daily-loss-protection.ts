import type { DailyStatistics, RiskCheckResult } from "./types";

export interface DailyLossProtection {
  check(daily: DailyStatistics, walletBalance: number, dailyLossLimitPct: number, dailyTradeLimit: number): RiskCheckResult[];
}

export class DefaultDailyLossProtection implements DailyLossProtection {
  check(daily: DailyStatistics, walletBalance: number, dailyLossLimitPct: number, dailyTradeLimit: number): RiskCheckResult[] {
    const checks: RiskCheckResult[] = [];
    const lossLimit = walletBalance * (dailyLossLimitPct / 100);

    if (daily.realizedPnl <= -lossLimit) {
      checks.push({
        name: "daily-loss-limit",
        passed: false,
        message: `Daily loss limit reached: ${daily.realizedPnl.toFixed(2)} is at or beyond the limit of -${lossLimit.toFixed(2)}.`,
      });
    } else {
      checks.push({
        name: "daily-loss-limit",
        passed: true,
        message: `Daily PnL ${daily.realizedPnl.toFixed(2)} is within the loss limit of -${lossLimit.toFixed(2)}.`,
      });
    }

    if (daily.tradeCount >= dailyTradeLimit) {
      checks.push({
        name: "daily-trade-limit",
        passed: false,
        message: `Daily trade limit reached: ${daily.tradeCount} trades (limit ${dailyTradeLimit}).`,
      });
    } else {
      checks.push({
        name: "daily-trade-limit",
        passed: true,
        message: `Trade count ${daily.tradeCount} is below the daily limit of ${dailyTradeLimit}.`,
      });
    }

    return checks;
  }
}
