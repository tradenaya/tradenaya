import { db } from "@/lib/db";
import type { ExecutionRecord, ExecutionState, ExecutionNotification, OrderRef, ProtectiveStatus } from "./types";

const toOrderRef = (row: any, prefix: "entry" | "stop_loss" | "take_profit"): OrderRef => ({
  orderId: row[`${prefix}_exchange_order_id`] ?? null,
  clientOrderId: row[`${prefix}_client_order_id`] ?? null,
  status: row[`${prefix}_status`] ?? null,
});

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
