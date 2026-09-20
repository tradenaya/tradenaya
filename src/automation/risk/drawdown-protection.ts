import type { RiskCheckResult, WalletInfo } from "./types";

export interface DrawdownProtection {
  check(wallet: WalletInfo, maxDrawdownPct: number): RiskCheckResult;
}

export class DefaultDrawdownProtection implements DrawdownProtection {
  check(wallet: WalletInfo, maxDrawdownPct: number): RiskCheckResult {
    const equity = Number(wallet.equity ?? wallet.balance);
    const peak = Number(wallet.peakBalance) || equity;

    if (!(peak > 0) || !(equity > 0)) {
      console.warn(
        `[drawdown] check — no usable data (equity ${equity}, peak ${peak}); drawdown protection skipped`,
      );
      return { name: "drawdown", passed: true, message: "Drawdown protection not applicable (no equity data)." };
    }

    const drawdownPct = ((peak - equity) / peak) * 100;

    // This is an ACCOUNT-LEVEL metric: wallet.equity and wallet.peakBalance are
    // the same across every symbol, so an identical drawdown % for every
    // candidate is expected — never a per-symbol calculation or a cached value.
    const logPrefix =
      `[drawdown] check — equity ${equity} (fallback balance ${wallet.balance}) | peak ${peak} | ` +
      `drawdown ${drawdownPct.toFixed(2)}% (limit ${maxDrawdownPct}%) | symbol-independent ACCOUNT-level metric`;

    if (equity < peak && drawdownPct >= maxDrawdownPct) {
      console.warn(`${logPrefix} -> REJECT`);
      return {
        name: "drawdown",
        passed: false,
        message: `Maximum drawdown of ${drawdownPct.toFixed(2)}% reached (limit ${maxDrawdownPct}%). Equity ${equity} is ${drawdownPct.toFixed(2)}% below the account peak of ${peak}.`,
      };
    }

    console.log(`${logPrefix} -> pass`);
    return {
      name: "drawdown",
      passed: true,
      message: `Current drawdown ${drawdownPct.toFixed(2)}% is within the limit of ${maxDrawdownPct}%.`,
    };
  }
}
