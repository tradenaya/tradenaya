/**
 * How a closed trade ended, named by what it actually EARNED.
 *
 * A stop-loss that had moved into profit (trailing) closes the trade with a
 * profit — calling that "SL hit" made winning trades look like losses on every
 * screen. The money and the win/loss counts were always right; this is the one
 * shared rule for the label and colour, so every screen says the same thing.
 */
export type ExitOutcomeKey = "TAKE_PROFIT" | "PROFIT_LOCKED" | "BREAKEVEN" | "STOP_LOSS" | "MANUAL" | "EXCHANGE" | "CANCELLED" | "OTHER";

export interface ExitOutcome {
  key: ExitOutcomeKey;
  label: string;
  /** Tailwind classes for a badge. */
  badge: string;
}

const BADGE = {
  green: "bg-emerald-500/15 text-emerald-400",
  red: "bg-red-500/15 text-red-400",
  grey: "bg-zinc-500/15 text-zinc-400",
  amber: "bg-amber-500/15 text-amber-400",
  violet: "bg-violet-500/15 text-violet-400",
} as const;

/** Profit/loss this small (fees, rounding) counts as breakeven. */
const BREAKEVEN_EPSILON = 1e-6;

export function exitOutcome(reason: string | null | undefined, pnl: number | null | undefined): ExitOutcome {
  const r = String(reason ?? "").toUpperCase();
  const money = Number(pnl);
  const known = Number.isFinite(money);

  if (r.includes("CANCEL") || r.includes("EXPIR") || r === "ERROR") return { key: "CANCELLED", label: "Cancelled", badge: BADGE.grey };
  if (r.includes("TAKE_PROFIT") || r === "TP") return { key: "TAKE_PROFIT", label: "Take-profit hit", badge: BADGE.green };
  if (r.includes("STOP") || r.includes("TRAILING") || r === "SL") {
    if (known && money > BREAKEVEN_EPSILON) return { key: "PROFIT_LOCKED", label: "Profit locked", badge: BADGE.green };
    if (known && money >= -BREAKEVEN_EPSILON) return { key: "BREAKEVEN", label: "Breakeven", badge: BADGE.grey };
    return { key: "STOP_LOSS", label: "Stop-loss (loss)", badge: BADGE.red };
  }
  if (r.includes("MANUAL")) return { key: "MANUAL", label: "Closed manually", badge: BADGE.amber };
  if (r.includes("LIQUIDAT") || r.includes("EXCHANGE")) return { key: "EXCHANGE", label: r.includes("LIQUIDAT") ? "Liquidated" : "Closed on exchange", badge: BADGE.violet };
  return { key: "OTHER", label: reason ? String(reason).replace(/_/g, " ").toLowerCase() : "—", badge: BADGE.grey };
}
