import { db } from "@/lib/db";
import { ensureTables } from "@/automation/position/bootstrap";
import type {
  ActivityRow,
  AnalyticsFilters,
  BotRow,
  ClosedTradeRow,
  ExecutionRow,
  OpenPositionRow,
  Paged,
} from "./types";

function isMissingTable(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  return message.includes("ER_NO_SUCH_TABLE") || message.includes("doesn't exist");
}

/** Milliseconds-to-epoch helper. */
function ms(value: unknown): string | null {
  if (value == null) return null;
  return new Date(Number(value)).toISOString();
}

function num(value: unknown): number | null {
  if (value == null) return null;
  return Number(value);
}

function bool(value: unknown): boolean {
  return value != null && (value === true || value === 1 || value === "1");
}

/**
 * Repository over the automation_* tables. Every query is scoped by userId.
 * Kept as an interface so the analytics service can be unit-tested with a fake.
 */
export interface IAnalyticsRepository {
  getBots(userId: number): Promise<BotRow[]>;
  getBot(userId: number, botId: number): Promise<BotRow | null>;
  countBots(userId: number): Promise<{ active: number; total: number }>;
  getClosedTrades(userId: number, filters: AnalyticsFilters): Promise<ClosedTradeRow[]>;
  getClosedTradesPage(
    userId: number,
    filters: AnalyticsFilters,
    page: number,
    pageSize: number,
    sortBy: string,
    sortDir: "asc" | "desc",
  ): Promise<Paged<ClosedTradeRow>>;
  getOpenPositions(userId: number, botId?: number): Promise<OpenPositionRow[]>;
  getActiveExecutions(userId: number, botId?: number): Promise<ExecutionRow[]>;
  getActivity(
    userId: number,
    opts: { botId?: number; limit?: number; offset?: number },
  ): Promise<Paged<ActivityRow>>;
  getClosedTrade(userId: number, tradeId: number): Promise<ClosedTradeRow | null>;
  getExecution(userId: number, executionId: number): Promise<ExecutionRow | null>;
  getTradeEvents(
    userId: number,
    executionId: number,
    limit?: number,
  ): Promise<ActivityRow[]>;
}

interface ClosedTradeRowDb {
  id: number;
  execution_id: number;
  bot_id: number;
  user_id: number;
  symbol: string;
  side: "BUY" | "SELL";
  entry_price: number;
  exit_price: number;
  exit_reason: string;
  realized_pnl: number;
  fees: number;
  gross_profit: number;
  commission: number;
  funding_fee: number;
  position_size: number;
  closed_at: Date;
  created_at: Date;
  trailing_activated: boolean;
  entry_at: Date | null;
  duration_ms: number | null;
  leverage: number | null;
  strategy: string | null;
  highest_price: number | null;
  lowest_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
}

function buildWhere(filters: AnalyticsFilters, prefix = "ct."): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.botId != null) {
    clauses.push(`${prefix}bot_id = ?`);
    params.push(filters.botId);
  }
  if (filters.symbol) {
    clauses.push(`${prefix}symbol = ?`);
    params.push(filters.symbol);
  }
  if (filters.side) {
    clauses.push(`${prefix}side = ?`);
    params.push(filters.side);
  }
  if (filters.exitReason) {
    clauses.push(`${prefix}exit_reason = ?`);
    params.push(filters.exitReason);
  }
  if (filters.startTime != null) {
    clauses.push(`${prefix}closed_at >= FROM_UNIXTIME(?)`);
    params.push(Math.floor(filters.startTime / 1000));
  }
  if (filters.endTime != null) {
    clauses.push(`${prefix}closed_at <= FROM_UNIXTIME(?)`);
    params.push(Math.floor(filters.endTime / 1000));
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
}

function mapClosedTrade(row: ClosedTradeRowDb): ClosedTradeRow {
  return {
    id: Number(row.id),
    executionId: Number(row.execution_id),
    botId: Number(row.bot_id),
    userId: Number(row.user_id),
    symbol: row.symbol,
    side: row.side,
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    exitReason: row.exit_reason,
    realizedPnl: Number(row.realized_pnl),
    fees: Number(row.fees),
    grossProfit: num(row.gross_profit) ?? 0,
    commission: num(row.commission) ?? 0,
    fundingFee: num(row.funding_fee) ?? 0,
    netPnl: (num(row.gross_profit) ?? 0) - (num(row.commission) ?? 0) - (num(row.funding_fee) ?? 0),
    positionSize: Number(row.position_size),
    closedAt: ms(row.closed_at?.getTime?.() ?? row.closed_at)!,
    createdAt: ms(row.created_at?.getTime?.() ?? row.created_at)!,
    entryTime: row.entry_at ? ms(row.entry_at) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    trailingActivated: bool(row.trailing_activated),
    highestPrice: row.highest_price != null ? Number(row.highest_price) : null,
    lowestPrice: row.lowest_price != null ? Number(row.lowest_price) : null,
    leverage: row.leverage != null ? Number(row.leverage) : null,
    stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null,
    takeProfit: row.take_profit != null ? Number(row.take_profit) : null,
  };
}

function mapBot(row: any): BotRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    symbol: row.symbol,
    strategy: row.strategy,
    leverage: Number(row.leverage),
    capital: Number(row.capital),
    capitalMode: row.capital_mode,
    walletPercent: num(row.wallet_percent),
    status: row.status,
    desiredStatus: row.desired_status,
    currentTrade: row.current_trade,
    lastAnalysisAt: ms(row.last_analysis_at),
    lastExecutionAt: ms(row.last_execution_at),
    configJson: row.config_json,
    lastError: row.last_error,
    retryCount: num(row.retry_count),
    heartbeatAt: ms(row.heartbeat_at),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

function mapPosition(row: any): OpenPositionRow {
  return {
    id: Number(row.id),
    executionId: num(row.execution_id),
    botId: Number(row.bot_id),
    userId: Number(row.user_id),
    symbol: row.symbol,
    side: row.side,
    state: row.state,
    quantity: num(row.quantity),
    filledQuantity: num(row.filled_quantity),
    entryPrice: num(row.entry_price),
    currentPrice: num(row.current_price),
    stopLoss: num(row.stop_loss),
    takeProfit: num(row.take_profit),
    leverage: num(row.leverage),
    positionId: row.position_id,
    entryOrderId: row.entry_order_id,
    stopLossOrderId: row.stop_loss_order_id,
    takeProfitOrderId: row.take_profit_order_id,
    stopLossTriggered: bool(row.stop_loss_triggered),
    takeProfitTriggered: bool(row.take_profit_triggered),
    exitPrice: num(row.exit_price),
    exitReason: row.exit_reason,
    realizedPnl: num(row.realized_pnl),
    unrealizedPnl: num(row.unrealized_pnl),
    fees: num(row.fees),
    trailingEnabled: bool(row.trailing_enabled),
    trailingActivated: bool(row.trailing_activated),
    trailingDistancePct: num(row.trailing_distance_pct),
    trailingActivationPct: num(row.trailing_activation_pct),
    highestPrice: num(row.highest_price),
    lowestPrice: num(row.lowest_price),
    errorMessage: row.error_message,
    createdAt: ms(row.created_at)!,
    updatedAt: ms(row.updated_at)!,
    closedAt: ms(row.closed_at),
  };
}

function mapExecution(row: any): ExecutionRow {
  return {
    id: Number(row.id),
    botId: Number(row.bot_id),
    userId: Number(row.user_id),
    symbol: row.symbol,
    side: row.side,
    state: row.state,
    executionKey: row.execution_key,
    limitPrice: num(row.limit_price),
    stopLoss: num(row.stop_loss),
    takeProfit: num(row.take_profit),
    quantity: num(row.quantity),
    filledQuantity: num(row.filled_quantity),
    leverage: num(row.leverage),
    expiresAt: num(row.expires_at),
    positionId: row.position_id,
    entryOrderId: row.entry_order_id,
    entryClientOrderId: row.entry_client_order_id,
    entryStatus: row.entry_status,
    slOrderId: row.sl_order_id,
    slClientOrderId: row.sl_client_order_id,
    slStatus: row.sl_status,
    tpOrderId: row.tp_order_id,
    tpClientOrderId: row.tp_client_order_id,
    tpStatus: row.tp_status,
    protectiveStatus: row.protective_status,
    errorMessage: row.error_message,
    createdAt: ms(row.created_at)!,
    updatedAt: ms(row.updated_at)!,
  };
}

function mapActivity(row: any): ActivityRow {
  return {
    id: Number(row.id),
    type: row.type,
    botId: row.bot_id != null ? Number(row.bot_id) : null,
    userId: Number(row.user_id),
    symbol: row.symbol,
    message: row.message,
    createdAt: ms(row.created_at)!,
    source: row.source,
  };
}

export class BotAnalyticsRepository implements IAnalyticsRepository {
  private schemaPromise: Promise<void> | null = null;

  /**
   * Ensure the automation_* tables exist before querying. Missing tables happen
   * when a long-running server started before a migration landed and was never
   * restarted, so CREATE TABLE on demand fixes them without a redeploy.
   */
  private ensureSchema(): Promise<void> {
    if (!this.schemaPromise) {
      this.schemaPromise = ensureTables().catch((error) => {
        this.schemaPromise = null;
        throw error;
      });
    }
    return this.schemaPromise;
  }

  async getBots(userId: number): Promise<BotRow[]> {
    await this.ensureSchema();
    const [rows] = await db.query(
      `SELECT * FROM automation_bots WHERE user_id = ? ORDER BY id DESC;`,
      [userId],
    );
    return (rows as any[]).map(mapBot);
  }

  async getBot(userId: number, botId: number): Promise<BotRow | null> {
    await this.ensureSchema();
    const [rows] = await db.query(
      `SELECT * FROM automation_bots WHERE id = ? AND user_id = ? LIMIT 1;`,
      [botId, userId],
    );
    return (rows as any[]).length ? mapBot((rows as any[])[0]) : null;
  }

  async countBots(userId: number): Promise<{ active: number; total: number }> {
    await this.ensureSchema();
    const [rows] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN desired_status = 'RUNNING' THEN 1 ELSE 0 END) AS active
       FROM automation_bots
       WHERE user_id = ?;`,
      [userId],
    );
    const row = (rows as any[])[0];
    return { active: Number(row?.active ?? 0), total: Number(row?.total ?? 0) };
  }

  async getClosedTrades(userId: number, filters: AnalyticsFilters): Promise<ClosedTradeRow[]> {
    await this.ensureSchema();
    const { sql, params } = buildWhere(filters);
    const [rows] = await db.query(
      `SELECT
         ct.id, ct.execution_id, ct.bot_id, ct.user_id, ct.symbol, ct.side,
         ct.entry_price, ct.exit_price, ct.exit_reason, ct.realized_pnl, ct.fees,
         ct.gross_profit, ct.commission, ct.funding_fee,
         ct.position_size, ct.closed_at, ct.created_at,
         p.trailing_activated,
         p.highest_price,
         p.lowest_price,
         p.stop_loss,
         p.take_profit,
         p.created_at AS entry_at,
         TIMESTAMPDIFF(MICROSECOND, p.created_at, ct.closed_at) / 1000 AS duration_ms,
         b.leverage, b.strategy
       FROM automation_closed_trades ct
       LEFT JOIN (
         SELECT p1.*
         FROM automation_positions p1
         INNER JOIN (
           SELECT execution_id, bot_id, MAX(id) AS max_id
           FROM automation_positions
           GROUP BY execution_id, bot_id
         ) p2 ON p1.id = p2.max_id
       ) p ON p.execution_id = ct.execution_id AND p.bot_id = ct.bot_id
       LEFT JOIN automation_bots b ON b.id = ct.bot_id
       WHERE ct.user_id = ?${sql}
       ORDER BY ct.closed_at DESC;`,
      [userId, ...params],
    );
    return (rows as any[]).map(mapClosedTrade);
  }

  async getClosedTradesPage(
    userId: number,
    filters: AnalyticsFilters,
    page: number,
    pageSize: number,
    sortBy: string,
    sortDir: "asc" | "desc",
  ): Promise<Paged<ClosedTradeRow>> {
    await this.ensureSchema();
    const { sql, params } = buildWhere(filters);
    const safeSort =
      ["closed_at", "entry_price", "exit_price", "realized_pnl", "fees", "position_size", "symbol", "side", "exit_reason"].includes(sortBy)
        ? sortBy
        : "closed_at";
    const direction = sortDir === "asc" ? "ASC" : "DESC";
    const offset = (page - 1) * pageSize;

    const [[countRows], [rows]] = (await Promise.all([
      db.query(
        `SELECT COUNT(*) AS total FROM automation_closed_trades ct WHERE ct.user_id = ?${sql};`,
        [userId, ...params],
      ),
      db.query(
        `SELECT
           ct.id, ct.execution_id, ct.bot_id, ct.user_id, ct.symbol, ct.side,
           ct.entry_price, ct.exit_price, ct.exit_reason, ct.realized_pnl, ct.fees,
           ct.gross_profit, ct.commission, ct.funding_fee,
           ct.position_size, ct.closed_at, ct.created_at,
           p.trailing_activated,
           p.stop_loss,
           p.take_profit,
           p.created_at AS entry_at,
           TIMESTAMPDIFF(MICROSECOND, p.created_at, ct.closed_at) / 1000 AS duration_ms,
           b.leverage, b.strategy
         FROM automation_closed_trades ct
         LEFT JOIN (
           SELECT p1.*
           FROM automation_positions p1
           INNER JOIN (
             SELECT execution_id, bot_id, MAX(id) AS max_id
             FROM automation_positions
             GROUP BY execution_id, bot_id
           ) p2 ON p1.id = p2.max_id
         ) p ON p.execution_id = ct.execution_id AND p.bot_id = ct.bot_id
         LEFT JOIN automation_bots b ON b.id = ct.bot_id
         WHERE ct.user_id = ?${sql}
         ORDER BY ${safeSort} ${direction}, ct.id ${direction}
         LIMIT ? OFFSET ?;`,
        [userId, ...params, pageSize, offset],
      ),
    ])) as any;

    const total = Number(countRows?.[0]?.total ?? 0);
    return {
      items: (rows as any[]).map(mapClosedTrade),
      total,
      page,
      pageSize,
      totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    };
  }

  async getOpenPositions(userId: number, botId?: number): Promise<OpenPositionRow[]> {
    await this.ensureSchema();
    const [rows] = await db.query(
      `SELECT * FROM automation_positions
       WHERE user_id = ? AND state NOT IN ('CLOSED', 'ERROR')
         ${botId != null ? "AND bot_id = ?" : ""}
       ORDER BY id DESC;`,
      botId != null ? [userId, botId] : [userId],
    );
    return (rows as any[]).map(mapPosition);
  }

  async getActiveExecutions(userId: number, botId?: number): Promise<ExecutionRow[]> {
    try {
      await this.ensureSchema();
      const [rows] = await db.query(
        `SELECT * FROM automation_executions
         WHERE user_id = ? AND state NOT IN ('CANCELLED', 'FAILED', 'CLOSED')
           ${botId != null ? "AND bot_id = ?" : ""}
         ORDER BY id DESC;`,
        botId != null ? [userId, botId] : [userId],
      );
      return (rows as any[]).map(mapExecution);
    } catch (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
  }

  async getActivity(
    userId: number,
    opts: { botId?: number; limit?: number; offset?: number },
  ): Promise<Paged<ActivityRow>> {
    await this.ensureSchema();
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = opts.offset ?? 0;
    const botClause = opts.botId != null ? " AND bot_id = ?" : "";
    const botParams = opts.botId != null ? [opts.botId] : [];

    const [[countRows], [rows]] = (await Promise.all([
      db.query(
        `SELECT
           'scheduler' AS source, id, bot_id, user_id, NULL AS symbol, type, message, created_at
         FROM automation_scheduler_events
         WHERE user_id = ?${botClause}
         UNION ALL
         SELECT
           'position' AS source, id, bot_id, user_id, symbol, type, message, created_at
         FROM automation_position_events
         WHERE user_id = ?${botClause}
         UNION ALL
         SELECT
           'notification' AS source, id, bot_id, user_id, symbol, type, message, created_at
         FROM automation_execution_notifications
         WHERE user_id = ?${botClause};`,
        [userId, ...botParams, userId, ...botParams, userId, ...botParams],
      ),
      db.query(
        `SELECT feed.* FROM (
           SELECT
             'scheduler' AS source, id, bot_id, user_id, NULL AS symbol, type, message, created_at
           FROM automation_scheduler_events
           WHERE user_id = ?${botClause}
           UNION ALL
           SELECT
             'position' AS source, id, bot_id, user_id, symbol, type, message, created_at
           FROM automation_position_events
           WHERE user_id = ?${botClause}
           UNION ALL
           SELECT
             'notification' AS source, id, bot_id, user_id, symbol, type, message, created_at
           FROM automation_execution_notifications
           WHERE user_id = ?${botClause}
         ) AS feed
         ORDER BY feed.created_at DESC, feed.id DESC
         LIMIT ? OFFSET ?;`,
        [userId, ...botParams, userId, ...botParams, userId, ...botParams, limit, offset],
      ),
    ])) as any;

    const total = Number(countRows?.[0]?.total ?? 0);
    return {
      items: (rows as any[]).map(mapActivity),
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      totalPages: limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1,
    };
  }

  private async closedTradeQuery(userId: number, tradeId: number): Promise<ClosedTradeRow | null> {
    await this.ensureSchema();
    const [rows] = await db.query(
      `SELECT
         ct.id, ct.execution_id, ct.bot_id, ct.user_id, ct.symbol, ct.side,
         ct.entry_price, ct.exit_price, ct.exit_reason, ct.realized_pnl, ct.fees,
         ct.gross_profit, ct.commission, ct.funding_fee,
         ct.position_size, ct.closed_at, ct.created_at,
         p.trailing_activated,
         p.highest_price,
         p.lowest_price,
         p.created_at AS entry_at,
         TIMESTAMPDIFF(MICROSECOND, p.created_at, ct.closed_at) / 1000 AS duration_ms,
         b.leverage, b.strategy
       FROM automation_closed_trades ct
       LEFT JOIN (
         SELECT p1.*
         FROM automation_positions p1
         INNER JOIN (
           SELECT execution_id, bot_id, MAX(id) AS max_id
           FROM automation_positions
           GROUP BY execution_id, bot_id
         ) p2 ON p1.id = p2.max_id
       ) p ON p.execution_id = ct.execution_id AND p.bot_id = ct.bot_id
       LEFT JOIN automation_bots b ON b.id = ct.bot_id
       WHERE ct.user_id = ? AND ct.id = ?
       LIMIT 1;`,
      [userId, tradeId],
    );
    return (rows as any[]).length ? mapClosedTrade((rows as any[])[0]) : null;
  }

  async getClosedTrade(userId: number, tradeId: number): Promise<ClosedTradeRow | null> {
    return this.closedTradeQuery(userId, tradeId);
  }

  async getExecution(userId: number, executionId: number): Promise<ExecutionRow | null> {
    try {
      await this.ensureSchema();
      const [rows] = await db.query(
        `SELECT * FROM automation_executions WHERE id = ? AND user_id = ? LIMIT 1;`,
        [executionId, userId],
      );
      return (rows as any[]).length ? mapExecution((rows as any[])[0]) : null;
    } catch (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
  }

  async getTradeEvents(
    userId: number,
    executionId: number,
    limit = 50,
  ): Promise<ActivityRow[]> {
    await this.ensureSchema();
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const [rows] = await db.query(
      `SELECT feed.* FROM (
         SELECT
           'position' AS source, id, bot_id, user_id, symbol, type, message, created_at
         FROM automation_position_events
         WHERE user_id = ? AND execution_id = ?
         UNION ALL
         SELECT
           'notification' AS source, id, bot_id, user_id, symbol, type, message, created_at
         FROM automation_execution_notifications
         WHERE user_id = ? AND execution_id = ?
       ) AS feed
       ORDER BY feed.created_at DESC, feed.id DESC
       LIMIT ?;`,
      [userId, executionId, userId, executionId, safeLimit],
    );
    return (rows as any[]).map(mapActivity);
  }
}
