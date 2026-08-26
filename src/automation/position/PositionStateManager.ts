import { db } from "@/lib/db";
import type { PositionState, PositionStoreLike } from "./PositionManagerTypes";

const TRANSITIONS: Record<PositionState, PositionState[]> = {
  WAITING_ENTRY: ["ENTRY_PENDING", "ENTRY_EXECUTED", "CLOSING", "CLOSED", "ERROR"],
  ENTRY_PENDING: ["ENTRY_EXECUTED", "CLOSING", "CLOSED", "ERROR"],
  ENTRY_EXECUTED: ["PROTECTED", "UNPROTECTED", "TRAILING", "CLOSING", "CLOSED", "ERROR"],
  PROTECTED: ["TRAILING", "UNPROTECTED", "CLOSING", "CLOSED", "ERROR"],
  TRAILING: ["PROTECTED", "UNPROTECTED", "CLOSING", "CLOSED", "ERROR"],
  CLOSING: ["CLOSED", "ERROR"],
  CLOSED: [],
  ERROR: [],
  UNPROTECTED: ["PROTECTED", "TRAILING", "CLOSING", "CLOSED", "ERROR"],
};

export class PositionStateManager {
  private readonly store: PositionStoreLike;

  constructor(store?: PositionStoreLike) {
    this.store = store ?? ({ async updateState() {} } as unknown as PositionStoreLike);
  }

  isValidTransition(from: PositionState, to: PositionState): boolean {
    if (from === to) return true;
    return (TRANSITIONS[from] ?? []).includes(to);
  }

  async transition(positionId: number, expected: PositionState, next: PositionState, errorMessage?: string | null): Promise<boolean> {
    if (expected === next) return true;
    if (!this.isValidTransition(expected, next)) return false;

    const rows = (await db.query(
      `UPDATE automation_positions
       SET state = ?, error_message = COALESCE(?, error_message), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND state = ?;`,
      [next, errorMessage ?? null, positionId, expected],
    )) as unknown as Array<{ affectedRows: number }>;

    return Boolean(rows[0]?.affectedRows);
  }

  async markError(positionId: number, message: string) {
    await db.query(
      `UPDATE automation_positions SET state = 'ERROR', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [message, positionId],
    );
  }
}
