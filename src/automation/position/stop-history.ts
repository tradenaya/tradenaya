import { db } from "@/lib/db";
import { coinswitchClient } from "@/automation/executor/client";
import { withBotMode } from "@/automation/paper/mode";
import { PositionStore } from "./PositionStore";
import { TREND_BREAKOUT_ID } from "@/automation/strategy/catalog";
import { TRAIL_ARM_R } from "@/automation/strategy/trend-breakout";

/**
 * The full, provable story of a position's stop-loss and take-profit: the
 * original levels, every stop move (old → new level, market price at the time,
 * the exchange orders placed / cancelled), every failed attempt with its
 * reason, and — for open positions — a live check with the exchange that the
 * current stop and target orders really exist.
 *
 * Only the stop-loss trails; the take-profit stays at the level set when the
 * trade was opened.
 */

export interface StopHistoryOrderCheck {
  orderId: string | null;
  /** Status the exchange reports right now (null when it could not be read). */
  status: string | null;
  active: boolean | null;
  checkedAt: string;
  error?: string;
}

export interface StopHistoryMove {
  at: string;
  from: number | null;
  to: number;
  /** Market price when the stop moved (null for moves recorded before details were stored). */
  price: number | null;
  rule: string | null;
  oldOrderId: string | null;
  oldOrderCancelled: boolean | null;
  newOrderId: string | null;
  newOrderStatus: string | null;
}

export interface StopHistoryFailure {
  at: string;
  reason: string;
  wanted: number | null;
}

export interface StopHistory {
  positionId: number;
  executionId: number;
  botId: number;
  symbol: string;
  side: "BUY" | "SELL";
  mode: "LIVE" | "PAPER";
  open: boolean;
  state: string;
  entryPrice: number | null;
  quantity: number | null;
  leverage: number | null;
  /** Your own money in the trade (entry × quantity ÷ leverage). */
  margin: number | null;
  currentPrice: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  openedAt: string;
  closedAt: string | null;
  original: { price: number | null; orderId: string | null; at: string };
  current: { price: number | null; orderId: string | null; check: StopHistoryOrderCheck | null };
  takeProfit: { price: number | null; orderId: string | null; trails: false; check: StopHistoryOrderCheck | null };
  moves: StopHistoryMove[];
  failures: StopHistoryFailure[];
  /** When the trailing stop was switched on (Trend Breakout: after +1.5R). */
  armed: { at: string; bestR: number | null; best: number | null } | null;
  /** How this strategy trails, in plain words, for the "hasn't moved yet" note. */
  trailRule: string;
}

const DONE = new Set(["EXECUTED", "FILLED", "ALL_DONE", "CLOSED", "CANCELLED", "CANCELED", "CANCELLATION_RAISED", "REJECTED", "EXPIRED", "PARTIALLY_EXECUTED"]);
const CLOSED_STATES = new Set(["CLOSED", "CANCELLED", "FAILED"]);

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const same = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-6;

function parseDetails(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Last number in a message such as "stop loss trailed to the 10-candle high 82.078 USDT". */
function levelFromMessage(message: unknown): number | null {
  const m = String(message ?? "").match(/(-?\d+(?:\.\d+)?)(?!.*\d)/);
  return m ? num(m[1]) : null;
}

async function checkOrder(botId: number, userId: number, orderId: string | null): Promise<StopHistoryOrderCheck> {
  const checkedAt = new Date().toISOString();
  if (!orderId) return { orderId, status: null, active: false, checkedAt, error: "no order id recorded" };
  try {
    const order = await withBotMode(botId, () => coinswitchClient.getOrderStatus(userId, orderId));
    const status = order?.status ? String(order.status).toUpperCase() : null;
    return { orderId, status, active: status ? !DONE.has(status) : null, checkedAt };
  } catch (error) {
    return { orderId, status: null, active: null, checkedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getStopHistory(
  userId: number,
  ref: { positionId?: number | null; executionId?: number | null },
  { verify = true }: { verify?: boolean } = {},
): Promise<StopHistory | null> {
  if (!ref.positionId && !ref.executionId) return null;
  const [posRows] = await db.query(
    `SELECT p.*, b.trading_mode, b.strategy AS bot_strategy,
            e.stop_loss AS plan_stop_loss, e.take_profit AS plan_take_profit, e.created_at AS exec_created_at
       FROM automation_positions p
       JOIN automation_bots b ON b.id = p.bot_id
       LEFT JOIN automation_executions e ON e.id = p.execution_id
      WHERE p.user_id = ? AND ${ref.positionId ? "p.id = ?" : "p.execution_id = ?"}
      ORDER BY p.id DESC
      LIMIT 1`,
    [userId, ref.positionId || ref.executionId],
  );
  const p = (posRows as Array<Record<string, unknown>>)[0];
  if (!p) return null;
  const positionId = Number(p.id);

  // Adds the events.details column on databases that predate it.
  await new PositionStore().ensureEventsTable().catch(() => null);

  const mode = String(p.trading_mode ?? "LIVE").toUpperCase() === "PAPER" ? "PAPER" : "LIVE";
  const open = !CLOSED_STATES.has(String(p.state)) && p.closed_at == null;
  const openedAt = iso(p.created_at);
  const closedAt = p.closed_at ? iso(p.closed_at) : null;

  const [eventRows] = await db.query(
    `SELECT type, message, details, created_at FROM automation_position_events
      WHERE position_id = ? AND type IN ('TRAILING_MOVED', 'TRAILING_FAILED', 'TRAILING_ARMED')
      ORDER BY id`,
    [positionId],
  ).catch(() => [[]]);

  // Exchange stop orders recorded in order history for this trade window —
  // used to attach order ids to moves recorded before details were stored.
  const [orderRows] = await db.query(
    `SELECT exchange_order_id, trigger_price, status, created_at FROM futures_orders_history
      WHERE user_id = ? AND symbol = ? AND order_context = 'stop_loss'
        AND ${mode === "PAPER" ? "exchange = 'PAPER'" : "(exchange IS NULL OR exchange <> 'PAPER')"}
        AND created_at >= ? - INTERVAL 2 MINUTE AND created_at <= COALESCE(?, NOW()) + INTERVAL 2 MINUTE
      ORDER BY id`,
    [userId, p.symbol, p.created_at, p.closed_at ?? null],
  ).catch(() => [[]]);
  const stopOrders = (orderRows as Array<Record<string, unknown>>).map((o) => ({
    id: o.exchange_order_id ? String(o.exchange_order_id) : null,
    trigger: num(o.trigger_price),
    status: String(o.status ?? "").toUpperCase(),
  }));

  const originalPrice = num(p.plan_stop_loss) ?? num(p.stop_loss);
  const opened = stopOrders.find((o) => o.status !== "CANCELLED" && same(o.trigger, originalPrice));

  const moves: StopHistoryMove[] = [];
  const failures: StopHistoryFailure[] = [];
  let armed: StopHistory["armed"] = null;
  let prevLevel = originalPrice;
  let prevOrderId: string | null = opened?.id ?? null;
  for (const row of eventRows as Array<Record<string, unknown>>) {
    const d = parseDetails(row.details);
    if (row.type === "TRAILING_ARMED") {
      armed = { at: iso(row.created_at), bestR: num(d?.bestR), best: num(d?.best) };
      continue;
    }
    if (row.type === "TRAILING_FAILED") {
      failures.push({ at: iso(row.created_at), reason: String(d?.reason ?? row.message ?? ""), wanted: num(d?.wanted) });
      continue;
    }
    const to = num(d?.to) ?? levelFromMessage(row.message);
    if (to == null) continue;
    const from = num(d?.from) ?? prevLevel;
    const legacyNew = stopOrders.find((o) => o.status !== "CANCELLED" && same(o.trigger, to));
    const oldOrderId = (d?.oldOrderId as string | undefined) ?? prevOrderId;
    const newOrderId = (d?.newOrderId as string | undefined) ?? legacyNew?.id ?? null;
    const legacyCancelled = oldOrderId ? stopOrders.some((o) => o.id === oldOrderId && o.status === "CANCELLED") : null;
    moves.push({
      at: iso(row.created_at),
      from,
      to,
      price: num(d?.price),
      rule: d?.rule ? String(d.rule) : null,
      oldOrderId: oldOrderId ?? null,
      oldOrderCancelled: typeof d?.oldOrderCancelled === "boolean" ? (d.oldOrderCancelled as boolean) : legacyCancelled || null,
      newOrderId,
      newOrderStatus: d?.newOrderStatus ? String(d.newOrderStatus) : null,
    });
    prevLevel = to;
    prevOrderId = newOrderId;
  }

  const botId = Number(p.bot_id);
  const currentOrderId = p.sl_order_id ? String(p.sl_order_id) : null;
  const tpOrderId = p.tp_order_id ? String(p.tp_order_id) : null;
  const [slCheck, tpCheck] = open && verify
    ? await Promise.all([checkOrder(botId, userId, currentOrderId), checkOrder(botId, userId, tpOrderId)])
    : [null, null];

  const entry = num(p.entry_price);
  const quantity = num(p.filled_quantity) ?? num(p.quantity);
  const leverage = num(p.leverage);
  return {
    positionId,
    executionId: Number(p.execution_id),
    botId,
    symbol: String(p.symbol),
    side: String(p.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
    mode,
    open,
    state: String(p.state),
    entryPrice: entry,
    quantity,
    leverage,
    margin: entry != null && quantity != null && leverage ? (entry * quantity) / leverage : null,
    currentPrice: num(p.current_price),
    exitPrice: num(p.exit_price),
    exitReason: p.exit_reason ? String(p.exit_reason) : null,
    openedAt,
    closedAt,
    original: { price: originalPrice, orderId: opened?.id ?? moves[0]?.oldOrderId ?? (moves.length === 0 ? currentOrderId : null), at: p.exec_created_at ? iso(p.exec_created_at) : openedAt },
    current: { price: num(p.stop_loss), orderId: currentOrderId, check: slCheck },
    takeProfit: { price: num(p.plan_take_profit) ?? num(p.take_profit), orderId: tpOrderId, trails: false, check: tpCheck },
    moves,
    failures,
    armed,
    trailRule:
      String(p.bot_strategy ?? "") === TREND_BREAKOUT_ID
        ? `The stop stays at its original level until the trade is +${TRAIL_ARM_R}R in profit (in profit by ${TRAIL_ARM_R}× the money risked). Then it moves to your entry price, so the trade can no longer lose, and follows the last 10 candles.`
        : p.trailing_enabled
          ? `The stop follows the price ${num(p.trailing_distance_pct) ?? 2}% behind once the trade is ${num(p.trailing_activation_pct) ?? 0.5}% in profit.`
          : "Trailing is off for this trade; the stop stays where it was set.",
  };
}
