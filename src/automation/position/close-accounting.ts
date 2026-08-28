import type { FuturesTransaction } from "@/automation/executor/client";
import type { PositionRecord } from "./PositionManagerTypes";

type TransactionClient = {
  getTransactions(userId: number, opts?: { symbol?: string; type?: string; fromTime?: number; toTime?: number; limit?: number }): Promise<FuturesTransaction[]>;
};

export interface CloseAccounting {
  grossProfit: number;
  /** Trading commission for entry + exit (USDT). */
  commission: number;
  /** Funding fees accrued while the position was open (USDT). */
  fundingFee: number;
  /** True net P&L = grossProfit - commission - fundingFee. */
  realizedPnl: number;
  /** Whether any cost was estimated instead of confirmed by the exchange. */
  estimated: boolean;
}

/** Price-move P&L before any costs, sign-aware for BUY/SELL. */
export function grossProfitOf(
  side: string,
  entry: number | null | undefined,
  exit: number | null | undefined,
  qty: number | null | undefined,
): number | null {
  if (entry == null || exit == null || qty == null || !(entry > 0) || !(exit > 0) || !(qty > 0)) return null;
  const raw = side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
  return round(raw);
}

/**
 * Reconcile a closed position's true accounting. The gross price-move P&L is
 * always computable from prices. Commissions and funding are fetched from the
 * exchange's transaction ledger so the result ties to the wallet; if the ledger
 * is unreachable we fall back to an estimated round-trip commission and zero
 * funding, flagged as `estimated`.
 */
export async function reconcileClose(
  client: TransactionClient,
  userId: number,
  position: PositionRecord,
  entryPrice: number | null,
  exitPrice: number | null,
): Promise<CloseAccounting> {
  const qty = position.filledQuantity ?? position.quantity;
  const gross = grossProfitOf(position.side, entryPrice, exitPrice, qty);

  const windowOpen = position.createdAt ? new Date(position.createdAt).getTime() : undefined;
  const windowClose = position.closedAt ? new Date(position.closedAt).getTime() : undefined;

  let commission = 0;
  let fundingFee = 0;
  let estimated = false;

  try {
    const [commissionTx, fundingTx] = await Promise.all([
      client
        .getTransactions(userId, {
          symbol: position.symbol,
          type: "commission",
          fromTime: windowOpen,
          toTime: windowClose,
          limit: 100,
        })
        .catch(() => null),
      client
        .getTransactions(userId, {
          symbol: position.symbol,
          type: "funding fee",
          fromTime: windowOpen,
          toTime: windowClose,
          limit: 100,
        })
        .catch(() => null),
    ]);

    if (commissionTx) {
      for (const t of commissionTx) commission += Math.abs(amountOf(t));
    } else {
      estimated = true;
    }
    if (fundingTx) {
      for (const t of fundingTx) fundingFee += Math.abs(amountOf(t));
    } else {
      estimated = true;
    }
  } catch {
    estimated = true;
  }

  if (commission === 0 && entryPrice != null && exitPrice != null && qty != null) {
    // Fallback: round-trip commission estimate consistent with the entry/exit
    // notional. Keep it flagged as estimated.
    const rate = 0.0005;
    commission += (entryPrice * qty + exitPrice * qty) * rate;
    estimated = true;
  }

  const grossSafe = gross ?? 0;
  const realizedPnl = grossSafe - commission - fundingFee;

  return {
    grossProfit: grossSafe,
    commission: round(commission),
    fundingFee: round(fundingFee),
    realizedPnl: round(realizedPnl),
    estimated,
  };
}

function amountOf(tx: { amount?: number; fee?: number | null }): number {
  return tx.amount ?? tx.fee ?? 0;
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
