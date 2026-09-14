/**
 * Centralized CoinSwitch futures order-status classification.
 *
 * Every layer (order lifecycle, position monitor, recovery, close detection)
 * previously rolled its own stringly status sets. This module keeps the
 * semantics in one place so a status like RAISED — a stop/target order that
 * has been armed but is NOT filled and NOT cancelled — is never mistaken for
 * a fill or a cancellation, and an unrecognized/read-failed status degrades
 * to "UNKNOWN" (which callers MUST treat as still open, never as done).
 */

export type OrderStatusKind =
  /** Order fully executed — terminal fill, no remainder. */
  | "FILLED"
  /** Order partially executed — a portion filled while the remainder rests. */
  | "PARTIAL"
  /** Order is active/resting on the exchange (OPEN, NEW, RAISED, TRIGGERED, GTC, ...). */
  | "OPEN"
  /** Order reached a terminal cancelled/rejected state — no fill, no remainder. */
  | "CANCELLED"
  /** Status could not be resolved (empty or unrecognized). Never assume filled. */
  | "UNKNOWN";

const FILLED = new Set(["EXECUTED", "FILLED", "ALL_DONE", "CLOSED", "FILLED_CLOSED"]);
const PARTIAL = new Set(["PARTIALLY_EXECUTED", "PARTIALLY_FILLED"]);
const OPEN = new Set(["OPEN", "NEW", "RAISED", "TRIGGERED", "TRIGGERING", "PENDING", "GTC", "ACTIVE", "WORKING", "RESTING"]);
const CANCELLED = new Set(["CANCELLED", "CANCELLATION_RAISED", "CANCELED", "REJECTED", "EXPIRED", "FAILED", "ERROR", "INVALID"]);

export function classifyStatus(status: string | null | undefined): OrderStatusKind {
  const s = String(status ?? "").trim().toUpperCase();
  if (!s) return "UNKNOWN";
  if (FILLED.has(s)) return "FILLED";
  if (PARTIAL.has(s)) return "PARTIAL";
  if (CANCELLED.has(s)) return "CANCELLED";
  if (OPEN.has(s)) return "OPEN";
  return "UNKNOWN";
}

/** Full execution — terminal, no resting remainder. Includes FILLED / EXECUTED / CLOSED / ALL_DONE. */
export function isFullyFilled(status: string | null | undefined): boolean {
  return classifyStatus(status) === "FILLED";
}

/** Partial execution — the remainder is still on the exchange. Entry orders must NOT be treated as terminal here. */
export function isPartiallyFilled(status: string | null | undefined): boolean {
  return classifyStatus(status) === "PARTIAL";
}

/** Partially executed also counts as having executed a portion (used for size accounting). */
export function isExecuted(status: string | null | undefined): boolean {
  const kind = classifyStatus(status);
  return kind === "FILLED" || kind === "PARTIAL";
}

/** Still active/resting on the exchange (RAISED included). Unknown degrades to open for safety. */
export function isOpen(status: string | null | undefined): boolean {
  const kind = classifyStatus(status);
  return kind === "OPEN" || kind === "UNKNOWN";
}

/** Terminal cancelled / rejected / expired — no fill, safe to treat as done. */
export function isTerminalCancelled(status: string | null | undefined): boolean {
  return classifyStatus(status) === "CANCELLED";
}

/** Full fill OR terminal-cancelled — the order is done on the exchange either way. */
export function isTerminalFill(status: string | null | undefined): boolean {
  return classifyStatus(status) === "FILLED";
}

/** Fully filled or terminal-cancelled (for entry orders PARTIAL still has a resting remainder). */
export function isDone(status: string | null | undefined): boolean {
  const kind = classifyStatus(status);
  return kind === "FILLED" || kind === "CANCELLED";
}