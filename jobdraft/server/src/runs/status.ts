import { execute, query, queryOne } from "../db/pool.js";

interface ItemState {
  type: "draft" | "auto_send" | "link_only";
  send_state: string;
  outcome: string;
}

const FINAL_SEND_STATES = new Set(["cancelled", "removed", "skipped", "failed"]);

/** An application needs no more attention once it has an outcome, or was cancelled/removed/skipped/failed. */
export function isFinal(i: Pick<ItemState, "send_state" | "outcome">): boolean {
  return i.outcome !== "open" || FINAL_SEND_STATES.has(i.send_state);
}

/**
 * ready_to_send while drafts wait for the user; sending while the queue works;
 * sent when auto-sends are done and nothing waits; completed once every item is final.
 */
export function computeRunStatus(items: ItemState[]): "no_matches" | "ready_to_send" | "sending" | "sent" | "completed" {
  const apps = items.filter((i) => i.type !== "link_only");
  if (!apps.length) return "no_matches";
  if (apps.every(isFinal)) return "completed";
  if (apps.some((i) => i.send_state === "none")) return "ready_to_send";
  if (apps.some((i) => i.send_state === "scheduled" || i.send_state === "sending")) return "sending";
  return "sent";
}

/** Recompute counts and status of a finished run (no-op while running or after failure). */
export async function refreshRunStatus(runId: number): Promise<void> {
  const run = await queryOne<{ status: string }>("SELECT status FROM runs WHERE id = ?", [runId]);
  if (!run || run.status === "running" || run.status === "failed") return;
  const items = await query<ItemState>("SELECT type, send_state, outcome FROM run_items WHERE run_id = ?", [runId]);
  await execute(
    `UPDATE runs SET status = ?,
       drafts_count = ?, auto_send_count = ?, sent_count = ?, link_only_count = ?
     WHERE id = ?`,
    [
      computeRunStatus(items),
      items.filter((i) => i.type === "draft").length,
      items.filter((i) => i.type === "auto_send").length,
      items.filter((i) => i.send_state === "sent").length,
      items.filter((i) => i.type === "link_only").length,
      runId,
    ],
  );
}

export async function refreshRunsForUser(userId: number): Promise<void> {
  const runs = await query<{ id: number }>("SELECT id FROM runs WHERE user_id = ? AND status NOT IN ('running','failed','no_matches','completed')", [userId]);
  for (const r of runs) await refreshRunStatus(Number(r.id));
}
