import { db } from "@/lib/db";
import type { OrderHistoryInsert, OrderHistoryQuery, OrderHistoryRow, Paged } from "./types";

function ms(value: unknown): string | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSearch(search: string): { sql: string; params: string[] } {
  const term = search.trim();
  if (!term) return { sql: "", params: [] };
  const like = `%${term}%`;
  return {
    sql: ` AND (o.symbol LIKE ? OR o.status LIKE ? OR o.order_type LIKE ? OR o.order_context LIKE ? OR o.exchange_order_id LIKE ? OR o.client_order_id LIKE ? OR o.message LIKE ?)`,
    params: [like, like, like, like, like, like, like],
  };
}

const BASE_COLUMNS = `
  o.id, o.user_id, o.user_email, o.user_code,
  o.exchange, o.symbol, o.side, o.order_type, o.order_context,
  o.quantity, o.price, o.trigger_price, o.reduce_only,
  o.status, o.exchange_order_id, o.client_order_id,
  o.response_status, o.message, o.amount_used,
  o.pnl, o.realized_pnl, o.is_profit,
  o.created_at, o.updated_at
`;

function mapRow(row: Record<string, unknown>): OrderHistoryRow {
  return {
    id: Number(row.id),
    userCode: row.user_code != null ? String(row.user_code) : null,
    exchange: row.exchange != null ? String(row.exchange) : null,
    symbol: String(row.symbol),
    side: row.side === "SELL" ? "SELL" : "BUY",
    orderType: row.order_type != null ? String(row.order_type) : "MARKET",
    orderContext: row.order_context != null ? String(row.order_context) : "entry",
    quantity: num(row.quantity),
    price: num(row.price),
    triggerPrice: num(row.trigger_price),
    reduceOnly: Boolean(row.reduce_only),
    status: row.status != null ? String(row.status) : "PENDING",
    exchangeOrderId: row.exchange_order_id != null ? String(row.exchange_order_id) : null,
    clientOrderId: row.client_order_id != null ? String(row.client_order_id) : null,
    responseStatus: row.response_status != null ? String(row.response_status) : null,
    message: row.message != null ? String(row.message) : null,
    amountUsed: num(row.amount_used),
    pnl: num(row.pnl),
    realizedPnl: num(row.realized_pnl),
    isProfit: row.is_profit == null ? null : Boolean(row.is_profit),
    createdAt: ms(row.created_at)!,
    updatedAt: ms(row.updated_at)!,
  };
}

export interface IOrderHistoryRepository {
  getOrders(userId: number, query: OrderHistoryQuery): Promise<Paged<OrderHistoryRow>>;
}

export class OrderHistoryRepository implements IOrderHistoryRepository {
  async ensureTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS futures_orders_history (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT NULL,
        user_email VARCHAR(255) NULL,
        user_code VARCHAR(100) NULL,
        exchange VARCHAR(50) NULL,
        symbol VARCHAR(50) NOT NULL,
        side VARCHAR(10) NOT NULL,
        order_type VARCHAR(30) NOT NULL,
        order_context VARCHAR(30) NOT NULL DEFAULT 'entry',
        quantity DECIMAL(18, 8) NULL,
        price DECIMAL(18, 8) NULL,
        trigger_price DECIMAL(18, 8) NULL,
        reduce_only TINYINT(1) NOT NULL DEFAULT 0,
        status VARCHAR(40) NOT NULL,
        exchange_order_id VARCHAR(255) NULL,
        client_order_id VARCHAR(255) NULL,
        response_status VARCHAR(50) NULL,
        message TEXT NULL,
        amount_used DECIMAL(18, 8) NULL,
        avg_execution_price DECIMAL(18, 8) NULL,
        execution_fee DECIMAL(18, 8) NULL,
        pnl DECIMAL(18, 8) NULL,
        realized_pnl DECIMAL(18, 8) NULL,
        is_profit TINYINT(1) NULL,
        raw_response JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_user_symbol_created (user_id, symbol, created_at),
        KEY idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'futures_orders_history';`,
    );
    const columns = new Set((rows as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME));
    if (!columns.has("exchange")) {
      await db.query(`ALTER TABLE futures_orders_history ADD COLUMN exchange VARCHAR(50) NULL;`);
    }
  }

  async saveOrder(input: OrderHistoryInsert) {
    await this.ensureTable();

    if (input.quantity == null && input.price == null && input.triggerPrice == null) {
      return;
    }

    await db.query(
      `INSERT INTO futures_orders_history (
        user_id, user_email, user_code, exchange, symbol, side, order_type, order_context,
        quantity, price, trigger_price, reduce_only, status, exchange_order_id,
        client_order_id, response_status, message, amount_used, avg_execution_price,
        execution_fee, pnl, realized_pnl, is_profit, raw_response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        input.userId,
        input.userEmail,
        input.userCode,
        input.exchange ?? "EXCHANGE_2",
        input.symbol,
        input.side,
        input.orderType,
        input.orderContext,
        num(input.quantity),
        num(input.price),
        num(input.triggerPrice),
        input.reduceOnly ? 1 : 0,
        input.status,
        input.exchangeOrderId,
        input.clientOrderId,
        input.responseStatus,
        input.message,
        num(input.amountUsed),
        num(input.avgExecutionPrice),
        num(input.executionFee),
        num(input.pnl),
        num(input.realizedPnl),
        input.isProfit == null ? null : input.isProfit ? 1 : 0,
        input.rawResponse,
      ],
    );
  }

  async getOrders(userId: number, query: OrderHistoryQuery): Promise<Paged<OrderHistoryRow>> {
    await this.ensureTable();
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(Math.max(query.pageSize || 25, 1), 100);
    const offset = (page - 1) * pageSize;
    const { sql, params } = buildSearch(query.search ?? "");

    const results = await Promise.all([
      db.query(
        `SELECT COUNT(*) AS total FROM futures_orders_history o WHERE o.user_id = ?${sql};`,
        [userId, ...params],
      ),
      db.query(
        `SELECT ${BASE_COLUMNS}
         FROM futures_orders_history o
         WHERE o.user_id = ?${sql}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ? OFFSET ?;`,
        [userId, ...params, pageSize, offset],
      ),
    ]);
    const countRows = results[0][0] as Array<Record<string, unknown>>;
    const rows = results[1][0] as Array<Record<string, unknown>>;

    const total = Number(countRows?.[0]?.total ?? 0);
    return {
      items: rows.map(mapRow),
      total,
      page,
      pageSize,
      totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    };
  }
}
