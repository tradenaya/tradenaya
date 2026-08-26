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
