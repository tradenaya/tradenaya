import type { ExitReason } from "./PositionManagerTypes";
import { isFullyFilled } from "@/automation/executor/order-status";
import type { ClosedOrderRecord } from "@/automation/executor/client";
import { SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT, estimateLiquidationPrice } from "@/automation/risk/liquidation-safety";

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

export interface ClosedOrderClientLike {
  getClosedOrders(
    userId: number,
    opts?: { symbol?: string; status?: string; limit?: number; fromTime?: number; toTime?: number },
  ): Promise<{ orders: ClosedOrderRecord[]; cursor: number | null }>;
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
    if (!order || !isFullyFilled(order?.status)) return null;
    return {
      reason,
      price: toNum(order.raw?.avg_execution_price) ?? null,
      realizedPnl: toNum(order.raw?.realised_pnl) ?? null,
      fees: toNum(order.raw?.execution_fee) ?? null,
    };
  };

  return (await check(position.takeProfitOrderId, "TAKE_PROFIT")) ?? (await check(position.stopLossOrderId, "STOP_LOSS"));
}

/** Terminal fully-executed statuses as reported by /futures/orders/closed. */
const CLOSED_ORDER_FILLED = new Set(["EXECUTED", "FILLED", "ALL_DONE", "CLOSED", "FILLED_CLOSED", "PARTIALLY_EXECUTED"]);

/**
 * Extract an executable close record from the exchange's closed order history.
 * A terminal, reduce-only, opposite-side fill on the position's symbol is hard
 * proof that the position closed and carries the REAL reason (STOP vs TP vs
 * external) with the exchange's fill price / realised P&L / fee — even when the
 * SL/TP order IDs were never persisted locally (e.g. the server crashed between
 * protective-order placement and the DB write, or the row was lost).
 *
 * Matches by known SL/TP order id first (deterministic reason), then by any
 * reduce-only opposite-side fill, deriving the reason from the order type.
 */
export function closedOrderClose(
  orders: ClosedOrderRecord[],
  position: { side: string; stopLossOrderId: string | null; takeProfitOrderId: string | null },
): ExecutedCloseInfo | null {
  const opposite = String(position.side ?? "").toUpperCase() === "SELL" ? "BUY" : "SELL";
  const usable = (o: ClosedOrderRecord): boolean =>
    o.orderId != null &&
    o.reduceOnly === true &&
    o.execQuantity > 0 &&
    CLOSED_ORDER_FILLED.has(String(o.status ?? "").toUpperCase()) &&
    String(o.side ?? "").toUpperCase() === opposite;

  for (const o of orders) {
    if (!usable(o)) continue;
    if (o.orderId === position.takeProfitOrderId) {
      return { reason: "TAKE_PROFIT", price: o.avgExecutionPrice ?? o.price, realizedPnl: o.realizedPnl, fees: o.executionFee };
    }
    if (o.orderId === position.stopLossOrderId) {
      return { reason: "STOP_LOSS", price: o.avgExecutionPrice ?? o.price, realizedPnl: o.realizedPnl, fees: o.executionFee };
    }
  }

  for (const o of orders) {
    if (!usable(o)) continue;
    const type = String(o.orderType ?? "").toUpperCase();
    const reason = type.includes("STOP") ? "STOP_LOSS" : type.includes("PROFIT") ? "TAKE_PROFIT" : "MANUAL_CLOSE";
    return { reason, price: o.avgExecutionPrice ?? o.price, realizedPnl: o.realizedPnl, fees: o.executionFee };
  }

  return null;
}

/**
 * Query the close-proof from the closed-order history. Bounded to <=2 calls:
 * first the position's lifetime window (when known), then the most recent
 * window as a fallback for very old positions whose window is outside the
 * exchange's closed-order retention. A read failure yields null (NOT evidence).
 */
export async function detectClosedOrderClose(
  client: ClosedOrderClientLike,
  userId: number,
  position: { symbol: string; side: string; stopLossOrderId: string | null; takeProfitOrderId: string | null; createdAt: string },
): Promise<ExecutedCloseInfo | null> {
  const fromTime = position.createdAt ? new Date(position.createdAt).getTime() : 0;
  const attempts: Array<{ symbol: string; fromTime?: number; limit: number }> = [
    { symbol: position.symbol, limit: 50 },
  ];
  if (fromTime > 0) {
    attempts.unshift({ symbol: position.symbol, fromTime, limit: 50 });
  }

  for (const opts of attempts) {
    try {
      const { orders } = await client.getClosedOrders(userId, opts);
      const found = closedOrderClose(orders, position);
      if (found) return found;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Confirm that a position that is no longer returned by getPositions was REALLY
 * closed on the exchange, rather than being a transient/empty read.
 *
 * Evidence considered, in order of reliability:
 *   1. A protective SL/TP order reports an executed/filled status  -> confirmed.
 *   2. The closed-order history shows a terminal reduce-only fill on the
 *      symbol                                      -> confirmed (real reason).
 *   3. The transaction ledger contains a realized P&L for the symbol over the
 *      position's lifetime                                     -> confirmed (real PnL/fees).
 *   4. A protective order reports a terminal-cancelled status while the
 *      position is simultaneously absent -> the position was closed elsewhere
 *      (manual/liquidation) but is genuinely gone              -> confirmed.
 *
 * If NONE of the above can be established — because the reads failed or the
 * exchange simply had no trace — `confirmed` stays false and the caller must
 * NOT mark the position closed (avoiding a false MANUAL_CLOSE on a transient
 * read or a fabricated close reason).
 */
export async function confirmExternalClose(
  client: ExecutedCloseClientLike & LedgerClientLike & ClosedOrderClientLike,
  userId: number,
  position: { stopLossOrderId: string | null; takeProfitOrderId: string | null; symbol: string; createdAt: string; side: string },
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

  // 2. Closed-order history — a terminal reduce-only fill on this symbol
  //    proves the close and carries the real reason (STOP vs TP vs external).
  const closed = await detectClosedOrderClose(client, userId, position);
  if (closed) {
    return {
      confirmed: true,
      reason: closed.reason,
      price: closed.price,
      realizedPnl: closed.realizedPnl,
      fees: closed.fees,
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

export interface LiquidationSuspicion {
  suspected: boolean;
  boundary: number | null;
  reasoning: string;
  realizedPnl: number | null;
  fees: number | null;
  closedAtMs: number | null;
}

export interface LiquidationPositionLike {
  side: string;
  entryPrice: number | null;
  leverage: number | null;
  quantity: number | null;
  filledQuantity: number | null;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  symbol: string;
  createdAt: string;
}

/**
 * Determine whether a position that is GONE from the exchange was most likely
 * LIQUIDATED rather than closed normally (SL/TP/manual).
 *
 * Evidence considered:
 *   1. The current price has traded strictly past the estimated liquidation
 *      boundary — for a LONG that means price <= boundary, for a SHORT price >=
 *      boundary. A working SL for a LONG sits ABOVE the boundary, so once price
 *      is below it no resting protective order could possibly have filled.
 *   2. The ledger shows a realized P&L ≈ the FULL initial margin
 *      (−qty · entry / leverage) — a normal SL fill loses only the stop
 *      distance, whereas liquidation wipes the entire margin.
 *
 * Absence of either signal returns a "not suspected" verdict — the caller then
 * books whatever reason its normal detection produced (never fabricate a
 * liquidation based on a guess alone).
 */
export async function detectLiquidation(
  client: LedgerClientLike,
  userId: number,
  position: LiquidationPositionLike,
  currentPrice: number | null,
): Promise<LiquidationSuspicion> {
  const sideUp = String(position.side ?? "").toUpperCase();
  const entry = toNum(position.entryPrice);
  const leverage = toNum(position.leverage);

  if (sideUp !== "BUY" && sideUp !== "SELL") {
    return { suspected: false, boundary: null, reasoning: "unknown side — cannot estimate liquidation boundary", realizedPnl: null, fees: null, closedAtMs: null };
  }
  if (entry == null || leverage == null || leverage <= 0) {
    return { suspected: false, boundary: null, reasoning: "entry price or leverage unknown — cannot estimate liquidation boundary", realizedPnl: null, fees: null, closedAtMs: null };
  }

  const boundary = estimateLiquidationPrice(sideUp as "BUY" | "SELL", entry, leverage, SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT);
  if (boundary == null) {
    return { suspected: false, boundary: null, reasoning: "liquidation boundary could not be estimated", realizedPnl: null, fees: null, closedAtMs: null };
  }

  // Evidence 1: the current price is already beyond the liquidation boundary.
  if (currentPrice != null) {
    const crossed =
      sideUp === "BUY" ? currentPrice <= boundary : currentPrice >= boundary;
    if (crossed) {
      return {
        suspected: true,
        boundary,
        reasoning: `current price ${currentPrice} is on the liquidated side of the estimated boundary ${boundary} (${sideUp === "BUY" ? "at/below" : "at/above"}) at ${leverage}x — no resting SL/TP could have filled`,
        realizedPnl: null,
        fees: null,
        closedAtMs: null,
      };
    }
  }

  // Evidence 2: the ledger shows a realized loss that wipes the entire margin.
  let realizedPnl: number | null = null;
  let fees: number | null = null;
  let closedAtMs: number | null = null;
  try {
    const txs = await client.getTransactions(userId, {
      symbol: position.symbol,
      type: "P&L",
      fromTime: position.createdAt ? new Date(position.createdAt).getTime() : undefined,
      limit: 20,
    });
    const pnlTx = txs[0] ?? null;
    if (pnlTx) {
      realizedPnl = typeof pnlTx.amount === "number" ? pnlTx.amount : null;
      fees = pnlTx.fee ?? null;
      closedAtMs = typeof pnlTx.timestamp === "number" && pnlTx.timestamp > 0 ? pnlTx.timestamp : null;
    }
  } catch {
    // ledger unreachable — price evidence above is the only signal
  }

  const quantity = toNum(position.filledQuantity) ?? toNum(position.quantity);
  if (realizedPnl != null && quantity != null && realizedPnl < 0) {
    const fullMarginLoss = quantity * entry / leverage;
    if (realizedPnl <= -fullMarginLoss * 0.95) {
      return {
        suspected: true,
        boundary,
        reasoning: `realized P&L ${realizedPnl} ≈ full lost margin ~${fullMarginLoss} at ${leverage}x — liquidation wiped the position`,
        realizedPnl,
        fees,
        closedAtMs,
      };
    }
  }

  return {
    suspected: false,
    boundary,
    reasoning: currentPrice == null
      ? `no price evidence beyond boundary ${boundary} and realized P&L does not wipe the full margin — treating as normal close`
      : `current price ${currentPrice} is not beyond boundary ${boundary} and realized P&L does not wipe the full margin — treating as normal close`,
    realizedPnl,
    fees,
    closedAtMs,
  };
}
