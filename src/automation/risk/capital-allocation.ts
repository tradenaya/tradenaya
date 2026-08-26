import type { CapitalSelection, WalletInfo } from "./types";

export interface CapitalAllocationResult {
  allocatedCapital: number;
  maxAllowed: number;
  valid: boolean;
  reason: string;
}

export interface CapitalAllocation {
  allocate(
    wallet: WalletInfo,
    capital: CapitalSelection,
    maxCapitalAllocationPct: number,
    minWalletBalance: number,
  ): CapitalAllocationResult;
}

export class DefaultCapitalAllocation implements CapitalAllocation {
  allocate(
    wallet: WalletInfo,
    capital: CapitalSelection,
    maxCapitalAllocationPct: number,
    minWalletBalance: number,
  ): CapitalAllocationResult {
    const balance = Number(wallet.balance);
    const maxAllowed = balance * (maxCapitalAllocationPct / 100);

    const allocated =
      capital.mode === "percent"
        ? balance * ((Number(capital.percent) || 0) / 100)
        : Number(capital.amount) || 0;

    if (!Number.isFinite(balance) || balance <= 0) {
      return { allocatedCapital: 0, maxAllowed: 0, valid: false, reason: "Wallet balance is invalid or zero." };
    }

    if (!(allocated > 0)) {
      return { allocatedCapital: 0, maxAllowed, valid: false, reason: "Selected capital must be greater than zero." };
    }

    if (allocated > maxAllowed) {
      return {
        allocatedCapital: 0,
        maxAllowed,
        valid: false,
        reason: `Selected capital ${allocated.toFixed(2)} exceeds the maximum allocation of ${maxAllowed.toFixed(2)} (${maxCapitalAllocationPct}% of wallet).`,
      };
    }

    const available = balance - minWalletBalance;
    if (allocated > available) {
      return {
        allocatedCapital: 0,
        maxAllowed,
        valid: false,
        reason: `Selected capital ${allocated.toFixed(2)} exceeds the available balance of ${available.toFixed(2)} after the minimum reserve of ${minWalletBalance.toFixed(2)}.`,
      };
    }

    return {
      allocatedCapital: allocated,
      maxAllowed,
      valid: true,
      reason: "Capital allocation is within limits.",
    };
  }
}
