import { db } from "@/lib/db";
import type { ExecutionRecord, ExecutionState, ExecutionNotification, OrderRef, ProtectiveStatus } from "./types";

/** Execution states that are safely reclaimable after a crash (no order placed yet). */
const RECLAIMABLE_WHEN_STALE = new Set<ExecutionState>(["PENDING_ENTRY"]);
/** How long an untouched claim on a not-yet-placed execution may live before a restart may reclaim it. */
const CLAIM_STALE_MS = 30 * 60_000;

const PROTECTIVE_REF_PREFIX: Record<"stop_loss" | "take_profit", "sl" | "tp"> = { stop_loss: "sl", take_profit: "tp" };

const toOrderRef = (row: any, prefix: "entry" | "stop_loss" | "take_profit"): OrderRef => {
  const col = prefix === "entry" ? "entry" : PROTECTIVE_REF_PREFIX[prefix];
  return {
    orderId: row[`${col}_exchange_order_id`] ?? null,
    clientOrderId: row[`${col}_client_order_id`] ?? null,
    status: row[`${col}_status`] ?? null,
  };
};

/** Normalize ISO strings into a TIMESTAMP-compatible value for expires_at. */
function toDbDate(value: string | Date | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

export class ExecutionStore {
  async ensureTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_executions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        bot_id INT NOT NULL,
        user_id INT NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        side VARCHAR(10) NOT NULL,
        state VARCHAR(30) NOT NULL,
        execution_key VARCHAR(100) NOT NULL,
        limit_price DECIMAL(18,8) NULL,
        stop_loss DECIMAL(18,8) NULL,
        take_profit DECIMAL(18,8) NULL,
        quantity DECIMAL(18,8) NULL,
        filled_quantity DECIMAL(18,8) NULL,
        remaining_quantity DECIMAL(18,8) NULL,
        entry_avg_price DECIMAL(18,8) NULL,
        leverage DECIMAL(10,2) NULL,
        expires_at TIMESTAMP NULL,
        position_id VARCHAR(100) NULL,
        entry_exchange_order_id VARCHAR(100) NULL,
        entry_client_order_id VARCHAR(100) NULL,
        entry_status VARCHAR(50) NULL,
        sl_exchange_order_id VARCHAR(100) NULL,
        sl_client_order_id VARCHAR(100) NULL,
        sl_status VARCHAR(50) NULL,
        tp_exchange_order_id VARCHAR(100) NULL,
        tp_client_order_id VARCHAR(100) NULL,
        tp_status VARCHAR(50) NULL,
        protective_status VARCHAR(20) NOT NULL DEFAULT 'NONE',
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_bot_state (bot_id, state),
        KEY idx_user_symbol (user_id, symbol, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migrate tables created before the trade-fill columns existed.
    const [cols] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automation_executions';`,
    );
    const columns = new Set((cols as Array<{ COLUMN_NAME: string }>).map((col) => col.COLUMN_NAME));
    const pending: string[] = [];
    if (!columns.has("remaining_quantity")) pending.push("ADD COLUMN remaining_quantity DECIMAL(18,8) NULL");
    if (!columns.has("entry_avg_price")) pending.push("ADD COLUMN entry_avg_price DECIMAL(18,8) NULL");
    if (pending.length) {
      await db.query(`ALTER TABLE automation_executions ${pending.join(", ")};`);
    }
  }

  async ensureNotificationTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_execution_notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        bot_id INT NOT NULL,
        execution_id BIGINT UNSIGNED NOT NULL,
        type VARCHAR(50) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  async createExecution(input: {
    botId: number;
    userId: number;
    symbol: string;
    side: "BUY" | "SELL";
    executionKey: string;
    limitPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    quantity: number;
    leverage: number;
    expiresAt: string | null;
  }): Promise<number> {
    await this.ensureTable();
    const [result] = await db.query(
      `INSERT INTO automation_executions (
        bot_id, user_id, symbol, side, state, execution_key, limit_price, stop_loss,
        take_profit, quantity, leverage, expires_at, protective_status
      ) VALUES (?, ?, ?, ?, 'PENDING_ENTRY', ?, ?, ?, ?, ?, ?, ?, 'NONE');`,
      [
        input.botId,
        input.userId,
        input.symbol,
        input.side,
        input.executionKey,
        input.limitPrice,
        input.stopLoss,
        input.takeProfit,
        input.quantity,
        input.leverage,
        toDbDate(input.expiresAt),
      ],
    ) as any;
    return Number(result.insertId);
  }

  async updateState(id: number, state: ExecutionState, errorMessage?: string | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_executions SET state = ?, error_message = COALESCE(?, error_message), updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [state, errorMessage ?? null, id],
    );
    // Free the submission claim the moment an execution becomes terminal so a
    // future identical entry (same fingerprint) is allowed again. Best-effort —
    // the claim sweep + stale-reclaim logic guard the crash cases.
    if (state === "CANCELLED" || state === "FAILED" || state === "CLOSED") {
      const key = await this.getExecutionKey(id).catch(() => null);
      if (key) await this.releaseSubmission(key, id).catch(() => null);
    }
  }

  private async getExecutionKey(id: number): Promise<string | null> {
    const [rows] = await db.query(`SELECT execution_key FROM automation_executions WHERE id = ? LIMIT 1;`, [id]);
    return (rows as any[])[0]?.execution_key ?? null;
  }

  async updateEntryRef(id: number, ref: OrderRef) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_executions SET
        entry_exchange_order_id = ?, entry_client_order_id = ?, entry_status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?;`,
      [ref.orderId, ref.clientOrderId, ref.status, id],
    );
  }

  async updatePositionRef(id: number, positionId: string | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_executions SET position_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [positionId, id],
    );
  }

  async updateFilledQuantity(id: number, quantity: number | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_executions SET filled_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [quantity, id],
    );
  }

  /**
   * Persist the actual fill state for a (possibly partial) execution — filled
   * quantity, remaining resting quantity and the exchange-reported average
   * fill price — so partial fills survive restarts and SL/TP sizing never
   * assumes a partial fill was a full fill.
   */
  async updateFill(id: number, filledQuantity: number | null, remainingQuantity: number | null, avgEntryPrice: number | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_executions SET
        filled_quantity = ?, remaining_quantity = ?, entry_avg_price = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?;`,
      [filledQuantity, remainingQuantity, avgEntryPrice, id],
    );
  }

  async updateProtectiveRef(id: number, kind: "sl" | "tp", ref: OrderRef) {
    await this.ensureTable();
    const column = kind === "sl" ? "sl" : "tp";
    await db.query(
      `UPDATE automation_executions SET
        ${column}_exchange_order_id = ?, ${column}_client_order_id = ?, ${column}_status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?;`,
      [ref.orderId, ref.clientOrderId, ref.status, id],
    );
  }

  async updateProtectiveStatus(id: number, status: ProtectiveStatus) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_executions SET protective_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [status, id],
    );
  }

  async getExecution(id: number): Promise<ExecutionRecord | null> {
    await this.ensureTable();
    const [rows] = await db.query(`SELECT * FROM automation_executions WHERE id = ? LIMIT 1;`, [id]);
    const row = (rows as any[])[0];
    if (!row) return null;
    return this.mapRow(row);
  }

  async getByExecutionKey(key: string): Promise<ExecutionRecord | null> {
    await this.ensureTable();
    const [rows] = await db.query(`SELECT * FROM automation_executions WHERE execution_key = ? LIMIT 1;`, [key]);
    const row = (rows as any[])[0];
    if (!row) return null;
    return this.mapRow(row);
  }

  /**
   * Find a still-live execution for a fingerprint (execution_key). Used as the
   * fast-path duplicate guard: the same user/bot/symbol/side/price entry must
   * never be placed again while one is still in flight.
   */
  async getActiveByExecutionKey(key: string): Promise<ExecutionRecord | null> {
    await this.ensureTable();
    const [rows] = await db.query(
      `SELECT * FROM automation_executions
       WHERE execution_key = ? AND state IN ('PENDING_ENTRY','MONITORING_ENTRY','ENTRY_FILLED','PARTIALLY_FILLED','UNPROTECTED')
       ORDER BY id ASC LIMIT 1;`,
      [key],
    );
    const row = (rows as any[])[0];
    if (!row) return null;
    return this.mapRow(row);
  }

  async getActiveExecutions(): Promise<ExecutionRecord[]> {
    await this.ensureTable();
    const [rows] = await db.query(
      `SELECT * FROM automation_executions
       WHERE state IN ('PENDING_ENTRY','MONITORING_ENTRY','ENTRY_FILLED','PARTIALLY_FILLED','UNPROTECTED')
       ORDER BY id ASC;`,
    );
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  async saveNotification(n: ExecutionNotification) {
    await this.ensureNotificationTable();
    await db.query(
      `INSERT INTO automation_execution_notifications (user_id, bot_id, execution_id, type, symbol, message)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [n.userId, n.botId, n.executionId, n.type, n.symbol, n.message],
    );
  }

  async ensureSubmissionsTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_order_submissions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        bot_id INT NOT NULL,
        execution_key VARCHAR(100) NOT NULL,
        execution_id BIGINT UNSIGNED NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'IN_FLIGHT',
        claimed_at TIMESTAMP NULL,
        released_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_execution_key (execution_key),
        KEY idx_holder (status, execution_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  /**
   * Atomically claim the right to submit an entry for a fingerprint
   * (execution_key = user:bot:symbol:side:price). Exactly one concurrent
   * worker can hold a claim at a time, so a retry / duplicate worker / restart
   * can never place two identical entries.
   */
  async claimSubmission(input: { userId: number; botId: number; executionKey: string; executionId: number }): Promise<{ ok: boolean; holderExecutionId: number | null }> {
    await this.ensureSubmissionsTable();

    const [inserted] = (await db.query(
      `INSERT IGNORE INTO automation_order_submissions
         (user_id, bot_id, execution_key, execution_id, status, claimed_at)
       VALUES (?, ?, ?, ?, 'IN_FLIGHT', CURRENT_TIMESTAMP);`,
      [input.userId, input.botId, input.executionKey, input.executionId],
    )) as unknown as Array<{ affectedRows: number }>;
    if (inserted?.affectedRows === 1) {
      return { ok: true, holderExecutionId: null };
    }

    // A row already exists — resolve the holder and either keep it or steal.
    for (let attempt = 0; attempt < 3; attempt++) {
      const [rows] = (await db.query(
        `SELECT execution_id, status, claimed_at FROM automation_order_submissions WHERE execution_key = ? LIMIT 1;`,
        [input.executionKey],
      )) as unknown as Array<Array<{ execution_id: unknown; status: string; claimed_at: unknown }>>;
      const claim = rows[0];
      if (!claim) continue; // removed concurrently → retry the insert path

      const holderExecutionId = Number(claim.execution_id);
      // We already own it (idempotent retry of the same execution).
      if (holderExecutionId === input.executionId && claim.status === "IN_FLIGHT") {
        return { ok: true, holderExecutionId: null };
      }

      if (claim.status === "IN_FLIGHT") {
        if (await this.canReclaim(holderExecutionId, claim.claimed_at)) {
          const [updated] = (await db.query(
            `UPDATE automation_order_submissions
             SET execution_id = ?, status = 'IN_FLIGHT', claimed_at = CURRENT_TIMESTAMP, released_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE execution_key = ? AND status = 'IN_FLIGHT';`,
            [input.executionId, input.executionKey],
          )) as unknown as Array<{ affectedRows: number }>;
          if (updated?.affectedRows === 1) return { ok: true, holderExecutionId: null };
          continue;
        }
        return { ok: false, holderExecutionId };
      }

      if (claim.status === "COMPLETED") {
        const [updated] = (await db.query(
          `UPDATE automation_order_submissions
           SET execution_id = ?, status = 'IN_FLIGHT', claimed_at = CURRENT_TIMESTAMP, released_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE execution_key = ? AND status = 'COMPLETED';`,
          [input.executionId, input.executionKey],
        )) as unknown as Array<{ affectedRows: number }>;
        if (updated?.affectedRows === 1) return { ok: true, holderExecutionId: null };
        continue;
      }

      break;
    }
    return { ok: false, holderExecutionId: null };
  }

  /**
   * True when an IN_FLIGHT claim held by `holderExecutionId` may be taken over:
   * the holder execution is gone or terminal, OR it is a PENDING_ENTRY claim
   * that has sat untouched past CLAIM_STALE_MS (a crash before the order was
   * ever placed). A live MONITORING_ENTRY / partially-filled trade is NEVER
   * reclaimable, otherwise a restart could double-submit while the order rests.
   */
  private async canReclaim(holderExecutionId: number, claimedAt: unknown): Promise<boolean> {
    const lockedStates = new Set<ExecutionState>(["MONITORING_ENTRY", "ENTRY_FILLED", "PARTIALLY_FILLED", "UNPROTECTED"]);
    try {
      const holder = await this.getExecution(holderExecutionId).catch(() => null);
      if (!holder) return true;
      if (holder.state === "CANCELLED" || holder.state === "FAILED" || holder.state === "CLOSED") return true;
      if (lockedStates.has(holder.state)) return false;
      if (RECLAIMABLE_WHEN_STALE.has(holder.state)) {
        const age = claimedAt != null ? Date.now() - new Date(String(claimedAt).replace(" ", "T") + "Z").getTime() : Number.POSITIVE_INFINITY;
        return !Number.isFinite(age) || age > CLAIM_STALE_MS;
      }
      return false;
    } catch {
      return false; // cannot verify the holder — do not steal.
    }
  }

  /** Mark a claim completed so the identical fingerprint can be re-entered later. */
  async releaseSubmission(executionKey: string, executionId: number) {
    await this.ensureSubmissionsTable();
    await db.query(
      `UPDATE automation_order_submissions
       SET status = 'COMPLETED', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE execution_key = ? AND execution_id = ? AND status = 'IN_FLIGHT';`,
      [executionKey, executionId],
    );
  }

  /** Boot-time sweep: complete stale IN_FLIGHT claims whose holder is terminal/gone. */
  async sweepStaleSubmissions() {
    await this.ensureSubmissionsTable();
    const [rows] = (await db.query(
      `SELECT execution_key, execution_id FROM automation_order_submissions WHERE status = 'IN_FLIGHT';`,
    )) as unknown as Array<Array<{ execution_key: string; execution_id: unknown }>>;
    for (const row of rows) {
      if (await this.canReclaim(Number(row.execution_id), null)) {
        await this.releaseSubmission(row.execution_key, Number(row.execution_id));
      }
    }
  }

  private mapRow(row: any): ExecutionRecord {
    return {
      id: Number(row.id),
      botId: Number(row.bot_id),
      userId: Number(row.user_id),
      symbol: row.symbol,
      side: row.side,
      state: row.state as ExecutionState,
      executionKey: row.execution_key,
      limitPrice: row.limit_price != null ? Number(row.limit_price) : null,
      stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null,
      takeProfit: row.take_profit != null ? Number(row.take_profit) : null,
      quantity: row.quantity != null ? Number(row.quantity) : null,
      filledQuantity: row.filled_quantity != null ? Number(row.filled_quantity) : null,
      remainingQuantity: row.remaining_quantity != null ? Number(row.remaining_quantity) : null,
      avgEntryPrice: row.entry_avg_price != null ? Number(row.entry_avg_price) : null,
      leverage: row.leverage != null ? Number(row.leverage) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
      positionId: row.position_id ?? null,
      entry: toOrderRef(row, "entry"),
      stopLossOrder: toOrderRef(row, "stop_loss"),
      takeProfitOrder: toOrderRef(row, "take_profit"),
      protectiveStatus: (row.protective_status as ProtectiveStatus) ?? "NONE",
      errorMessage: row.error_message ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const executionStore = new ExecutionStore();
