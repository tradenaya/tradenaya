import type { RiskCheckResult, WalletInfo } from "./types";

export interface DrawdownProtection {
  check(wallet: WalletInfo, maxDrawdownPct: number): RiskCheckResult;
}

export class DefaultDrawdownProtection implements DrawdownProtection {
  check(wallet: WalletInfo, maxDrawdownPct: number): RiskCheckResult {
    const equity = Number(wallet.equity ?? wallet.balance);
    const peak = Number(wallet.peakBalance) || equity;

    if (!(peak > 0) || !(equity > 0)) {
      return { name: "drawdown", passed: true, message: "Drawdown protection not applicable (no equity data)." };
    }

    const drawdownPct = ((peak - equity) / peak) * 100;
    if (equity < peak && drawdownPct >= maxDrawdownPct) {
      return {
        name: "drawdown",
        passed: false,
        message: `Maximum drawdown of ${drawdownPct.toFixed(2)}% reached (limit ${maxDrawdownPct}%).`,
      };
    }

    return {
      name: "drawdown",
      passed: true,
      message: `Current drawdown ${drawdownPct.toFixed(2)}% is within the limit of ${maxDrawdownPct}%.`,
    };
  }
}
