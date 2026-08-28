import type { ExitReason } from "./PositionManagerTypes";

const EXECUTED_STATUSES = new Set(["EXECUTED", "FILLED", "ALL_DONE", "CLOSED"]);

export interface ExecutedCloseInfo {
  reason: ExitReason;
  price: number | null;
  realizedPnl: number | null;
  fees: number | null;
}

export interface ExecutedCloseClientLike {
  getOrderStatus(userId: number, orderId: string): Promise<{ status?: string | null; raw?: Record<string, unknown> }>;
}

export interface LedgerClientLike {
  getTransactions(
    userId: number,
    opts?: { symbol?: string; type?: string; fromTime?: number; toTime?: number; limit?: number },
  ): Promise<Array<{ type?: string; amount?: number; fee?: number | null; timestamp?: number; orderId?: string | null }>>;
}

export interface ConfirmedClose {
  confirmed: boolean;
  reason: ExitReason | null;
  price: number | null;
  realizedPnl: number | null;
  fees: number | null;
  /** Milliseconds when a realized P&L transaction was recorded (if available). */
  closedAtMs: number | null;
}

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Inspect the protective (TP/SL) order statuses and, if either has executed,
 * report the closing details the exchange returned (reason, fill price, the
 * exchange's realised P&L and fee). Used to reconcile a position that was
 * closed on the exchange while this server was not watching it.
 */
export async function detectExecutedClose(
  client: ExecutedCloseClientLike,
  userId: number,
  position: { stopLossOrderId: string | null; takeProfitOrderId: string | null },
): Promise<ExecutedCloseInfo | null> {
  const check = async (orderId: string | null, reason: ExitReason): Promise<ExecutedCloseInfo | null> => {
    if (!orderId) return null;
    const order = await client.getOrderStatus(userId, orderId).catch(() => null);
    if (!order || !EXECUTED_STATUSES.has(String(order.status ?? ""))) return null;
    return {
      reason,
      price: toNum(order.raw?.avg_execution_price) ?? null,
      realizedPnl: toNum(order.raw?.realised_pnl) ?? null,
      fees: toNum(order.raw?.execution_fee) ?? null,
    };
  };

  return (await check(position.takeProfitOrderId, "TAKE_PROFIT")) ?? (await check(position.stopLossOrderId, "STOP_LOSS"));
}

/**
 * Confirm that a position that is no longer returned by getPositions was REALLY
 * closed on the exchange, rather than being a transient/empty read.
 *
 * Evidence considered, in order of reliability:
 *   1. A protective SL/TP order reports an executed/filled status  -> confirmed.
 *   2. The transaction ledger contains a realized P&L for the symbol over the
 *      position's lifetime                                     -> confirmed (real PnL/fees).
 *   3. A protective order reports a terminal-cancelled status while the
 *      position is simultaneously absent -> the position was closed elsewhere
 *      (manual/liquidation) but is genuinely gone              -> confirmed.
 *
 * If NONE of the above can be established — because the reads failed or the
 * exchange simply had no trace — `confirmed` stays false and the caller must
 * NOT mark the position closed (avoiding a false MANUAL_CLOSE on a transient
 * read or a fabricated close reason).
 */
export async function confirmExternalClose(
  client: ExecutedCloseClientLike & LedgerClientLike,
  userId: number,
  position: { stopLossOrderId: string | null; takeProfitOrderId: string | null; symbol: string; createdAt: string },
): Promise<ConfirmedClose> {
  // 1. Protective order executed -> strongest evidence with real reason/price.
  const executed = await detectExecutedClose(client, userId, position);
  if (executed) {
    return {
      confirmed: true,
      reason: executed.reason,
      price: executed.price,
      realizedPnl: executed.realizedPnl,
      fees: executed.fees,
      closedAtMs: null,
    };
  }

  // 2. Transaction ledger — a realized P&L on this symbol is proof of a close
  //    and carries real accounting.
  let pnlTx: { amount?: number; fee?: number | null; timestamp?: number } | null = null;
  let ledgerReachable = false;
  try {
    const txs = await client.getTransactions(userId, {
      symbol: position.symbol,
      type: "P&L",
      fromTime: position.createdAt ? new Date(position.createdAt).getTime() : undefined,
      limit: 20,
    });
    ledgerReachable = true;
    pnlTx = txs[0] ?? null;
  } catch {
    ledgerReachable = true;
    // unreachable — fall through
  }

  if (pnlTx) {
    return {
      confirmed: true,
      reason: "MANUAL_CLOSE",
      price: null,
      realizedPnl: typeof pnlTx.amount === "number" ? pnlTx.amount : null,
      fees: pnlTx.fee ?? null,
      closedAtMs: typeof pnlTx.timestamp === "number" && pnlTx.timestamp > 0 ? pnlTx.timestamp : null,
    };
  }

  // 3. A protective order terminal-cancelled while the position is absent
  //    (succeeded read) is consistent with the position having been closed
  //    externally (manual close / liquidation). This is still confirmation the
  //    position is gone.
  for (const orderId of [position.stopLossOrderId, position.takeProfitOrderId]) {
    if (!orderId) continue;
    let status = "";
    try {
      status = String((await client.getOrderStatus(userId, orderId))?.status ?? "");
    } catch {
      continue;
    }
    if (["CANCELLED", "CANCELLATION_RAISED", "CANCELED", "REJECTED", "EXPIRED"].includes(status)) {
      return { confirmed: true, reason: "MANUAL_CLOSE", price: null, realizedPnl: null, fees: null, closedAtMs: null };
    }
  }

  void ledgerReachable;
  return { confirmed: false, reason: null, price: null, realizedPnl: null, fees: null, closedAtMs: null };
}
