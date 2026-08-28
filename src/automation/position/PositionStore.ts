import { db } from "@/lib/db";
import type { ExecutionRecord } from "@/automation/executor/types";
import type {
  CloseSummaryInput,
  ExitReason,
  PositionEventInput,
  PositionManagerConfig,
  PositionRecord,
  PositionState,
} from "./PositionManagerTypes";
import { OrderHistoryRepository, type OrderHistoryInsert } from "@/automation/order-history";

export class PositionStore {
  async ensureTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_positions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        execution_id BIGINT UNSIGNED NOT NULL,
        bot_id INT NOT NULL,
        user_id INT NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        side VARCHAR(10) NOT NULL,
        state VARCHAR(30) NOT NULL,
        quantity DECIMAL(18,8) NULL,
        filled_quantity DECIMAL(18,8) NULL,
        entry_price DECIMAL(18,8) NULL,
        current_price DECIMAL(18,8) NULL,
        stop_loss DECIMAL(18,8) NULL,
        take_profit DECIMAL(18,8) NULL,
        leverage DECIMAL(10,2) NULL,
        position_id VARCHAR(100) NULL,
        entry_order_id VARCHAR(100) NULL,
        sl_order_id VARCHAR(100) NULL,
        tp_order_id VARCHAR(100) NULL,
        sl_triggered TINYINT(1) NOT NULL DEFAULT 0,
        tp_triggered TINYINT(1) NOT NULL DEFAULT 0,
        exit_price DECIMAL(18,8) NULL,
        exit_reason VARCHAR(30) NULL,
        realized_pnl DECIMAL(18,8) NULL,
        fees DECIMAL(18,8) NULL,
        trailing_enabled TINYINT(1) NOT NULL DEFAULT 0,
        trailing_activated TINYINT(1) NOT NULL DEFAULT 0,
        trailing_distance_pct DECIMAL(10,4) NULL,
        trailing_activation_pct DECIMAL(10,4) NULL,
        highest_price DECIMAL(18,8) NULL,
        lowest_price DECIMAL(18,8) NULL,
        unrealized_pnl DECIMAL(18,8) NULL,
        last_sync_at TIMESTAMP NULL,
        error_message TEXT NULL,
        closed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_bot_state (bot_id, state),
        KEY idx_execution (execution_id),
        KEY idx_user_state (user_id, state)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  async ensureEventsTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_position_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        bot_id INT NOT NULL,
        symbol VARCHAR(50) NULL,
        execution_id BIGINT UNSIGNED NOT NULL,
        position_id BIGINT UNSIGNED NULL,
        type VARCHAR(50) NOT NULL,
        message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_position (position_id),
        KEY idx_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    // Existing databases created before the symbol column was added need an ALTER.
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automation_position_events';`,
    );
    const columns = new Set((rows as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME));
    if (!columns.has("symbol")) {
      await db.query(`ALTER TABLE automation_position_events ADD COLUMN symbol VARCHAR(50) NULL;`);
    }
  }

  async ensureCloseTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_closed_trades (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        execution_id BIGINT UNSIGNED NOT NULL,
        bot_id INT NOT NULL,
        user_id INT NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        side VARCHAR(10) NOT NULL,
        entry_price DECIMAL(18,8) NULL,
        exit_price DECIMAL(18,8) NULL,
        exit_reason VARCHAR(30) NULL,
        realized_pnl DECIMAL(18,8) NULL,
        fees DECIMAL(18,8) NULL,
        position_size DECIMAL(18,8) NULL,
        closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_execution (execution_id),
        KEY idx_user_created (user_id, closed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Add accounting breakdown columns for databases created before this change.
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automation_closed_trades';`,
    );
    const columns = new Set((rows as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME));
    const pending: string[] = [];
    if (!columns.has("gross_profit")) pending.push("ADD COLUMN gross_profit DECIMAL(18,8) NULL DEFAULT 0");
    if (!columns.has("commission")) pending.push("ADD COLUMN commission DECIMAL(18,8) NULL DEFAULT 0");
    if (!columns.has("funding_fee")) pending.push("ADD COLUMN funding_fee DECIMAL(18,8) NULL DEFAULT 0");
    if (pending.length) {
      await db.query(`ALTER TABLE automation_closed_trades ${pending.join(", ")};`);
    }
  }

  async createPosition(execution: ExecutionRecord, config: PositionManagerConfig): Promise<number> {
    await this.ensureTable();
    const trailing = config.trailing;
    const initialState = this.initialState(execution.state);
    const [result] = await db.query(
      `INSERT INTO automation_positions (
        execution_id, bot_id, user_id, symbol, side, state, quantity, stop_loss, take_profit,
        leverage, position_id, entry_order_id, sl_order_id, tp_order_id,
        trailing_enabled, trailing_distance_pct, trailing_activation_pct
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        execution.id,
        execution.botId,
        execution.userId,
        execution.symbol,
        execution.side,
        initialState,
        execution.quantity ?? null,
        execution.stopLoss,
        execution.takeProfit,
        execution.leverage,
        execution.positionId,
        execution.entry.orderId,
        execution.stopLossOrder.orderId,
        execution.takeProfitOrder.orderId,
        trailing?.enabled ? 1 : 0,
        trailing?.distancePct ?? null,
        trailing?.activationPct ?? null,
      ],
    ) as any;
    return Number(result.insertId);
  }

  private initialState(executionState: ExecutionRecord["state"]): PositionState {
    switch (executionState) {
      case "MONITORING_ENTRY":
        return "ENTRY_PENDING";
      case "ENTRY_FILLED":
      case "PARTIALLY_FILLED":
        return "ENTRY_EXECUTED";
      case "UNPROTECTED":
        return "UNPROTECTED";
      default:
        return "WAITING_ENTRY";
    }
  }

  async getPositionByExecutionId(executionId: number): Promise<PositionRecord | null> {
    await this.ensureTable();
    const [rows] = await db.query(`SELECT * FROM automation_positions WHERE execution_id = ? LIMIT 1;`, [executionId]);
    const row = (rows as any[])[0];
    return row ? this.mapRow(row) : null;
  }

  async getPosition(id: number): Promise<PositionRecord | null> {
    await this.ensureTable();
    const [rows] = await db.query(`SELECT * FROM automation_positions WHERE id = ? LIMIT 1;`, [id]);
    const row = (rows as any[])[0];
    return row ? this.mapRow(row) : null;
  }

  async getActivePositions(): Promise<PositionRecord[]> {
    await this.ensureTable();
    const [rows] = await db.query(
      `SELECT * FROM automation_positions
       WHERE state IN ('WAITING_ENTRY','ENTRY_PENDING','ENTRY_EXECUTED','PROTECTED','TRAILING','UNPROTECTED','CLOSING')
       ORDER BY id ASC;`,
    );
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  async updateState(id: number, state: PositionState, errorMessage?: string | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_positions SET state = ?, error_message = COALESCE(?, error_message), updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [state, errorMessage ?? null, id],
    );
  }

  async updatePrices(id: number, currentPrice: number | null, unrealizedPnl: number | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_positions SET current_price = ?, unrealized_pnl = ?, last_sync_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [currentPrice, unrealizedPnl, id],
    );
  }

  async updateEntry(id: number, entryPrice: number | null, filledQuantity: number | null, positionId: string | null, entryOrderId: string | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_positions SET entry_price = ?, filled_quantity = ?, position_id = ?, entry_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [entryPrice, filledQuantity, positionId, entryOrderId, id],
    );
  }

  async updateProtection(id: number, stopLossOrderId: string | null, takeProfitOrderId: string | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_positions SET sl_order_id = ?, tp_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [stopLossOrderId, takeProfitOrderId, id],
    );
  }

  async updateTrailing(id: number, stopLoss: number | null, highestPrice: number | null, lowestPrice: number | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_positions SET stop_loss = ?, highest_price = ?, lowest_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [stopLoss, highestPrice, lowestPrice, id],
    );
  }

  async updateTrailingConfig(id: number, enabled: boolean, distancePct: number | null, activationPct: number | null) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_positions SET trailing_enabled = ?, trailing_distance_pct = ?, trailing_activation_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [enabled ? 1 : 0, distancePct, activationPct, id],
    );
  }

  async markClose(id: number, exitPrice: number, reason: ExitReason, realizedPnl: number, fees: number) {
    await this.ensureTable();
    await db.query(
      `UPDATE automation_positions SET
        state = 'CLOSED', exit_price = ?, exit_reason = ?, realized_pnl = ?, fees = ?,
        sl_triggered = CASE WHEN ? = 'STOP_LOSS' THEN 1 ELSE sl_triggered END,
        tp_triggered = CASE WHEN ? = 'TAKE_PROFIT' THEN 1 ELSE tp_triggered END,
        closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?;`,
      [exitPrice, reason, realizedPnl, fees, reason, reason, id],
    );
  }

  async recordCloseSummary(input: CloseSummaryInput) {
    await this.ensureCloseTable();
    await db.query(
      `INSERT INTO automation_closed_trades (
        execution_id, bot_id, user_id, symbol, side, entry_price, exit_price, exit_reason, realized_pnl, fees, position_size,
        gross_profit, commission, funding_fee
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        exit_price = VALUES(exit_price), exit_reason = VALUES(exit_reason),
        realized_pnl = VALUES(realized_pnl), fees = VALUES(fees),
        gross_profit = VALUES(gross_profit), commission = VALUES(commission), funding_fee = VALUES(funding_fee);`,
      [
        input.position.executionId,
        input.position.botId,
        input.position.userId,
        input.position.symbol,
        input.position.side,
        input.entryPrice,
        input.exitPrice,
        input.reason,
        input.realizedPnl ?? 0,
        input.fees ?? 0,
        input.position.filledQuantity ?? input.position.quantity,
        input.grossProfit ?? 0,
        input.commission ?? 0,
        input.fundingFee ?? 0,
      ],
    );

    await this.recordPositionCloseInHistory(input);
  }

  private async recordPositionCloseInHistory(input: CloseSummaryInput) {
    try {
      const { position, exitPrice, entryPrice, realizedPnl, fees, reason } = input;
      const qty = position.filledQuantity ?? position.quantity ?? 0;
      const entry = entryPrice ?? position.entryPrice ?? 0;
      const exit = exitPrice ?? position.exitPrice ?? 0;
      const amountUsed = entry && qty ? entry * qty : null;
      const row: OrderHistoryInsert = {
        userId: position.userId,
        userEmail: null,
        userCode: null,
        symbol: position.symbol,
        side: position.side,
        orderType: "MARKET",
        orderContext: "close_position",
        quantity: qty || null,
        price: entry || null,
        triggerPrice: exit || null,
        reduceOnly: true,
        status: "FILLED",
        exchangeOrderId: position.positionId ?? null,
        clientOrderId: position.entryOrderId ?? null,
        responseStatus: reason === "TAKE_PROFIT" || reason === "STOP_LOSS" ? "FILLED" : null,
        message: reason ?? null,
        amountUsed,
        avgExecutionPrice: exit || null,
        executionFee: fees ?? null,
        pnl: realizedPnl ?? null,
        realizedPnl: realizedPnl ?? null,
        isProfit: realizedPnl == null ? null : realizedPnl > 0,
        rawResponse: null,
      };
      await new OrderHistoryRepository().saveOrder(row);
    } catch {
      // best-effort: closed-trade history must never break position management
    }
  }

  async getDailyStats(userId: number, date: string): Promise<{ realizedPnl: number; tradeCount: number }> {
    await this.ensureCloseTable();
    const [rows] = await db.query(
      `SELECT COALESCE(SUM(realized_pnl), 0) AS realized_pnl,
              COUNT(CASE WHEN exit_reason <> 'ENTRY_CANCELLED' THEN 1 END) AS trade_count
        FROM automation_closed_trades
        WHERE user_id = ? AND DATE(closed_at) = ?;`,
      [userId, date],
    );
    type StatsRow = { realized_pnl?: number; trade_count?: number };
    const row = (rows as StatsRow[])[0];
    return {
      realizedPnl: Number(row?.realized_pnl ?? 0),
      tradeCount: Number(row?.trade_count ?? 0),
    };
  }

  async saveEvent(input: PositionEventInput) {
    await this.ensureEventsTable();
    await db.query(
      `INSERT INTO automation_position_events (user_id, bot_id, execution_id, position_id, type, message)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [input.userId, input.botId, input.executionId, input.positionId, input.type, input.message],
    );
  }

  private mapRow(row: any): PositionRecord {
    return {
      id: Number(row.id),
      executionId: Number(row.execution_id),
      botId: Number(row.bot_id),
      userId: Number(row.user_id),
      symbol: row.symbol,
      side: row.side,
      state: row.state as PositionState,
      quantity: row.quantity != null ? Number(row.quantity) : null,
      filledQuantity: row.filled_quantity != null ? Number(row.filled_quantity) : null,
      entryPrice: row.entry_price != null ? Number(row.entry_price) : null,
      currentPrice: row.current_price != null ? Number(row.current_price) : null,
      stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null,
      takeProfit: row.take_profit != null ? Number(row.take_profit) : null,
      leverage: row.leverage != null ? Number(row.leverage) : null,
      positionId: row.position_id ?? null,
      entryOrderId: row.entry_order_id ?? null,
      stopLossOrderId: row.sl_order_id ?? null,
      takeProfitOrderId: row.tp_order_id ?? null,
      stopLossTriggered: Boolean(row.sl_triggered),
      takeProfitTriggered: Boolean(row.tp_triggered),
      exitPrice: row.exit_price != null ? Number(row.exit_price) : null,
      exitReason: (row.exit_reason as ExitReason) ?? null,
      realizedPnl: row.realized_pnl != null ? Number(row.realized_pnl) : null,
      fees: row.fees != null ? Number(row.fees) : null,
      trailingEnabled: Boolean(row.trailing_enabled),
      trailingActivated: Boolean(row.trailing_activated),
      trailingDistancePct: row.trailing_distance_pct != null ? Number(row.trailing_distance_pct) : null,
      trailingActivationPct: row.trailing_activation_pct != null ? Number(row.trailing_activation_pct) : null,
      highestPrice: row.highest_price != null ? Number(row.highest_price) : null,
      lowestPrice: row.lowest_price != null ? Number(row.lowest_price) : null,
      unrealizedPnl: row.unrealized_pnl != null ? Number(row.unrealized_pnl) : null,
      lastSyncAt: row.last_sync_at ?? null,
      errorMessage: row.error_message ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at ?? null,
    };
  }
}

export const positionStore = new PositionStore();
