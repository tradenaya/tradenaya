import { db } from "@/lib/db";

/** Paper (simulated) futures account rows. Amounts in USDT, times in epoch ms. */
export interface PaperOrder {
  orderId: string;
  clientOrderId: string | null;
  userId: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
  quantity: number;
  price: number | null;
  triggerPrice: number | null;
  reduceOnly: boolean;
  leverage: number;
  status: "OPEN" | "EXECUTED" | "CANCELLED";
  execQuantity: number;
  avgExecutionPrice: number | null;
  executionFee: number | null;
  realisedPnl: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PaperPosition {
  userId: number;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  leverage: number;
  positionId: string;
  openedAt: number;
  updatedAt: number;
}

export interface PaperTransaction {
  userId: number;
  symbol: string;
  type: "COMMISSION" | "PNL" | "FUNDING_FEE";
  amount: number;
  orderId: string | null;
  createdAt: number;
}

export interface PaperWallet {
  userId: number;
  balance: number;
  initialBalance: number;
}

export interface PaperStore {
  getWallet(userId: number): Promise<PaperWallet | null>;
  saveWallet(wallet: PaperWallet): Promise<void>;
  listOrders(userId: number, filter?: { status?: PaperOrder["status"]; symbol?: string }): Promise<PaperOrder[]>;
  getOrder(userId: number, orderId: string): Promise<PaperOrder | null>;
  saveOrder(order: PaperOrder): Promise<void>;
  listPositions(userId: number): Promise<PaperPosition[]>;
  savePosition(position: PaperPosition): Promise<void>;
  deletePosition(userId: number, symbol: string): Promise<void>;
  getLeverage(userId: number, symbol: string): Promise<number | null>;
  setLeverage(userId: number, symbol: string, leverage: number): Promise<void>;
  addTransaction(tx: PaperTransaction): Promise<void>;
  listTransactions(userId: number, filter: { symbol?: string; type?: string; from?: number; to?: number }): Promise<PaperTransaction[]>;
  /** Users with open paper orders or positions (for background matching). */
  activeUsers(): Promise<number[]>;
}

/** In-memory store (tests). */
export class MemoryPaperStore implements PaperStore {
  wallets = new Map<number, PaperWallet>();
  orders: PaperOrder[] = [];
  positions: PaperPosition[] = [];
  leverage = new Map<string, number>();
  transactions: PaperTransaction[] = [];

  async getWallet(userId: number) { return this.wallets.get(userId) ?? null; }
  async saveWallet(w: PaperWallet) { this.wallets.set(w.userId, { ...w }); }
  async listOrders(userId: number, f: { status?: PaperOrder["status"]; symbol?: string } = {}) {
    return this.orders.filter((o) => o.userId === userId && (!f.status || o.status === f.status) && (!f.symbol || o.symbol === f.symbol)).map((o) => ({ ...o }));
  }
  async getOrder(userId: number, orderId: string) {
    const o = this.orders.find((x) => x.userId === userId && (x.orderId === orderId || x.clientOrderId === orderId));
    return o ? { ...o } : null;
  }
  async saveOrder(order: PaperOrder) {
    const i = this.orders.findIndex((o) => o.orderId === order.orderId);
    if (i >= 0) this.orders[i] = { ...order };
    else this.orders.push({ ...order });
  }
  async listPositions(userId: number) { return this.positions.filter((p) => p.userId === userId).map((p) => ({ ...p })); }
  async savePosition(p: PaperPosition) {
    const i = this.positions.findIndex((x) => x.userId === p.userId && x.symbol === p.symbol);
    if (i >= 0) this.positions[i] = { ...p };
    else this.positions.push({ ...p });
  }
  async deletePosition(userId: number, symbol: string) { this.positions = this.positions.filter((p) => !(p.userId === userId && p.symbol === symbol)); }
  async getLeverage(userId: number, symbol: string) { return this.leverage.get(`${userId}:${symbol}`) ?? null; }
  async setLeverage(userId: number, symbol: string, leverage: number) { this.leverage.set(`${userId}:${symbol}`, leverage); }
  async addTransaction(tx: PaperTransaction) { this.transactions.push({ ...tx }); }
  async listTransactions(userId: number, f: { symbol?: string; type?: string; from?: number; to?: number }) {
    return this.transactions.filter((t) => t.userId === userId && (!f.symbol || t.symbol === f.symbol) && (!f.type || t.type === f.type) && (f.from == null || t.createdAt >= f.from) && (f.to == null || t.createdAt <= f.to));
  }
  async activeUsers() {
    return [...new Set([...this.orders.filter((o) => o.status === "OPEN").map((o) => o.userId), ...this.positions.map((p) => p.userId)])];
  }
}

// ---- MySQL store -------------------------------------------------------------

/**
 * Paper-trading tables. Created automatically the first time paper trading is
 * used (same statements as database/new/*.sql).
 */
export const PAPER_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS paper_wallets (
    user_id INT NOT NULL,
    balance DECIMAL(24,8) NOT NULL DEFAULT 0,
    initial_balance DECIMAL(24,8) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS paper_orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id VARCHAR(64) NOT NULL,
    client_order_id VARCHAR(64) NULL,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    order_type VARCHAR(30) NOT NULL,
    quantity DECIMAL(24,8) NOT NULL,
    price DECIMAL(24,8) NULL,
    trigger_price DECIMAL(24,8) NULL,
    reduce_only TINYINT(1) NOT NULL DEFAULT 0,
    leverage DECIMAL(10,2) NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL,
    exec_quantity DECIMAL(24,8) NOT NULL DEFAULT 0,
    avg_execution_price DECIMAL(24,8) NULL,
    execution_fee DECIMAL(24,8) NULL,
    realised_pnl DECIMAL(24,8) NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_paper_order_id (order_id),
    KEY idx_paper_orders_user_status (user_id, status),
    KEY idx_paper_orders_user_symbol (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS paper_positions (
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    quantity DECIMAL(24,8) NOT NULL,
    entry_price DECIMAL(24,8) NOT NULL,
    leverage DECIMAL(10,2) NOT NULL DEFAULT 1,
    position_id VARCHAR(64) NOT NULL,
    opened_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS paper_leverage (
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    leverage DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS paper_transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    amount DECIMAL(24,8) NOT NULL,
    order_id VARCHAR(64) NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_paper_tx_user_time (user_id, created_at),
    KEY idx_paper_tx_user_symbol (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

let schemaReady: Promise<void> | null = null;
export function ensurePaperSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of PAPER_SCHEMA_SQL) await db.query(sql);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v ?? "");

function mapOrder(r: Row): PaperOrder {
  return {
    orderId: str(r.order_id),
    clientOrderId: r.client_order_id == null ? null : str(r.client_order_id),
    userId: Number(r.user_id),
    symbol: str(r.symbol),
    side: str(r.side) as PaperOrder["side"],
    orderType: str(r.order_type) as PaperOrder["orderType"],
    quantity: n(r.quantity),
    price: nn(r.price),
    triggerPrice: nn(r.trigger_price),
    reduceOnly: Boolean(Number(r.reduce_only)),
    leverage: n(r.leverage) || 1,
    status: str(r.status) as PaperOrder["status"],
    execQuantity: n(r.exec_quantity),
    avgExecutionPrice: nn(r.avg_execution_price),
    executionFee: nn(r.execution_fee),
    realisedPnl: nn(r.realised_pnl),
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
  };
}

function mapPosition(r: Row): PaperPosition {
  return {
    userId: Number(r.user_id),
    symbol: str(r.symbol),
    side: str(r.side) as PaperPosition["side"],
    quantity: n(r.quantity),
    entryPrice: n(r.entry_price),
    leverage: n(r.leverage) || 1,
    positionId: str(r.position_id),
    openedAt: n(r.opened_at),
    updatedAt: n(r.updated_at),
  };
}

export class MySqlPaperStore implements PaperStore {
  private async q(sql: string, params: unknown[] = []): Promise<Row[]> {
    await ensurePaperSchema();
    const [rows] = await db.query(sql, params);
    return rows as Row[];
  }

  async getWallet(userId: number) {
    const rows = await this.q(`SELECT user_id, balance, initial_balance FROM paper_wallets WHERE user_id = ?`, [userId]);
    return rows[0] ? { userId, balance: n(rows[0].balance), initialBalance: n(rows[0].initial_balance) } : null;
  }
  async saveWallet(w: PaperWallet) {
    await this.q(
      `INSERT INTO paper_wallets (user_id, balance, initial_balance) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE balance = VALUES(balance), initial_balance = VALUES(initial_balance)`,
      [w.userId, w.balance, w.initialBalance],
    );
  }
  async listOrders(userId: number, f: { status?: PaperOrder["status"]; symbol?: string } = {}) {
    const where = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (f.status) { where.push("status = ?"); params.push(f.status); }
    if (f.symbol) { where.push("symbol = ?"); params.push(f.symbol); }
    return (await this.q(`SELECT * FROM paper_orders WHERE ${where.join(" AND ")} ORDER BY created_at ASC, id ASC`, params)).map(mapOrder);
  }
  async getOrder(userId: number, orderId: string) {
    const rows = await this.q(`SELECT * FROM paper_orders WHERE user_id = ? AND (order_id = ? OR client_order_id = ?) LIMIT 1`, [userId, orderId, orderId]);
    return rows[0] ? mapOrder(rows[0]) : null;
  }
  async saveOrder(o: PaperOrder) {
    await this.q(
      `INSERT INTO paper_orders (order_id, client_order_id, user_id, symbol, side, order_type, quantity, price, trigger_price, reduce_only, leverage, status, exec_quantity, avg_execution_price, execution_fee, realised_pnl, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), exec_quantity = VALUES(exec_quantity), avg_execution_price = VALUES(avg_execution_price),
         execution_fee = VALUES(execution_fee), realised_pnl = VALUES(realised_pnl), updated_at = VALUES(updated_at)`,
      [o.orderId, o.clientOrderId, o.userId, o.symbol, o.side, o.orderType, o.quantity, o.price, o.triggerPrice, o.reduceOnly ? 1 : 0, o.leverage, o.status, o.execQuantity, o.avgExecutionPrice, o.executionFee, o.realisedPnl, o.createdAt, o.updatedAt],
    );
  }
  async listPositions(userId: number) {
    return (await this.q(`SELECT * FROM paper_positions WHERE user_id = ?`, [userId])).map(mapPosition);
  }
  async savePosition(p: PaperPosition) {
    await this.q(
      `INSERT INTO paper_positions (user_id, symbol, side, quantity, entry_price, leverage, position_id, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE side = VALUES(side), quantity = VALUES(quantity), entry_price = VALUES(entry_price),
         leverage = VALUES(leverage), position_id = VALUES(position_id), updated_at = VALUES(updated_at)`,
      [p.userId, p.symbol, p.side, p.quantity, p.entryPrice, p.leverage, p.positionId, p.openedAt, p.updatedAt],
    );
  }
  async deletePosition(userId: number, symbol: string) {
    await this.q(`DELETE FROM paper_positions WHERE user_id = ? AND symbol = ?`, [userId, symbol]);
  }
  async getLeverage(userId: number, symbol: string) {
    const rows = await this.q(`SELECT leverage FROM paper_leverage WHERE user_id = ? AND symbol = ?`, [userId, symbol]);
    return rows[0] ? n(rows[0].leverage) : null;
  }
  async setLeverage(userId: number, symbol: string, leverage: number) {
    await this.q(
      `INSERT INTO paper_leverage (user_id, symbol, leverage) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE leverage = VALUES(leverage)`,
      [userId, symbol, leverage],
    );
  }
  async addTransaction(t: PaperTransaction) {
    await this.q(`INSERT INTO paper_transactions (user_id, symbol, type, amount, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [t.userId, t.symbol, t.type, t.amount, t.orderId, t.createdAt]);
  }
  async listTransactions(userId: number, f: { symbol?: string; type?: string; from?: number; to?: number }) {
    const where = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (f.symbol) { where.push("symbol = ?"); params.push(f.symbol); }
    if (f.type) { where.push("type = ?"); params.push(f.type); }
    if (f.from != null) { where.push("created_at >= ?"); params.push(f.from); }
    if (f.to != null) { where.push("created_at <= ?"); params.push(f.to); }
    const rows = await this.q(`SELECT * FROM paper_transactions WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT 500`, params);
    return rows.map((r) => ({ userId, symbol: str(r.symbol), type: str(r.type) as PaperTransaction["type"], amount: n(r.amount), orderId: r.order_id == null ? null : str(r.order_id), createdAt: n(r.created_at) }));
  }
  async activeUsers() {
    const rows = await this.q(`SELECT DISTINCT user_id FROM paper_orders WHERE status = 'OPEN' UNION SELECT DISTINCT user_id FROM paper_positions`);
    return rows.map((r) => Number(r.user_id));
  }
}
