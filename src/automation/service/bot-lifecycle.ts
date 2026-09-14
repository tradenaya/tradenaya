import { db } from "@/lib/db";

/** Convert string/Date inputs to Date so mysql2 serializes them in a TIMESTAMP-compatible format. */
function toDbDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  return value instanceof Date ? value : new Date(value);
}

export type DesiredBotStatus = "RUNNING" | "PAUSED" | "STOPPED";

export type BotStatus =
  | "STOPPED"
  | "STARTING"
  | "RUNNING"
  | "ANALYZING"
  | "TRADE_PLANNED"
  | "ORDER_PENDING"
  | "POSITION_OPEN"
  | "POSITION_MANAGED"
  | "PAUSED"
  | "STOPPING"
  | "ERROR"
  | "RECOVERING";

export interface BotRuntimeState {
  id: number;
  userId: number;
  symbol: string;
  strategy: string;
  leverage: number;
  capital: number;
  capitalMode: "fixed" | "percent";
  walletPercent?: number;
  name?: string | null;
  status: BotStatus;
  desiredStatus?: DesiredBotStatus;
  currentTrade?: string | null;
  lastAnalysisAt?: string | null;
  lastExecutionAt?: string | null;
  configJson?: string | null;
  lastError?: string | null;
  retryCount?: number;
  nextRunAt?: string | null;
  heartbeatAt?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  peakEquity?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

const SCHEDULER_COLUMNS: Array<[string, string]> = [
  ["name", "VARCHAR(100) NULL"],
  ["config_json", "TEXT NULL"],
  ["desired_status", "VARCHAR(20) NOT NULL DEFAULT 'STOPPED'"],
  ["last_error", "TEXT NULL"],
  ["retry_count", "INT NOT NULL DEFAULT 0"],
  ["next_run_at", "TIMESTAMP NULL"],
  ["heartbeat_at", "TIMESTAMP NULL"],
  ["lease_owner", "VARCHAR(64) NULL"],
  ["lease_expires_at", "TIMESTAMP NULL"],
  ["peak_equity", "DECIMAL(18,8) NULL"],
];

export class BotLifecycleService {
  async ensureTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_bots (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        strategy VARCHAR(100) NOT NULL,
        name VARCHAR(100) NULL,
        leverage DECIMAL(10,2) NOT NULL DEFAULT 1,
        capital DECIMAL(18,8) NOT NULL DEFAULT 0,
        capital_mode VARCHAR(20) NOT NULL DEFAULT 'fixed',
        wallet_percent DECIMAL(10,2) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'STOPPED',
        current_trade TEXT NULL,
        last_analysis_at TIMESTAMP NULL,
        last_execution_at TIMESTAMP NULL,
        config_json TEXT NULL,
        desired_status VARCHAR(20) NOT NULL DEFAULT 'STOPPED',
        last_error TEXT NULL,
        retry_count INT NOT NULL DEFAULT 0,
        next_run_at TIMESTAMP NULL,
        heartbeat_at TIMESTAMP NULL,
        lease_owner VARCHAR(64) NULL,
        lease_expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_user_status (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  async ensureSchedulerSchema() {
    await this.ensureTable();
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automation_bots';`,
    );
    const existing = new Set((rows as any[]).map((row) => row.COLUMN_NAME));
    for (const [name, definition] of SCHEDULER_COLUMNS) {
      if (!existing.has(name)) {
        await db.query(`ALTER TABLE automation_bots ADD COLUMN ${name} ${definition};`);
      }
    }
  }

  async createBot(input: Omit<BotRuntimeState, "id" | "status" | "currentTrade" | "lastAnalysisAt" | "lastExecutionAt" | "createdAt" | "updatedAt" | "desiredStatus" | "configJson" | "lastError" | "retryCount" | "nextRunAt" | "heartbeatAt" | "leaseOwner" | "leaseExpiresAt"> & { status?: BotStatus }) {
    await this.ensureSchedulerSchema();
    const [result] = await db.query(
      `INSERT INTO automation_bots (
        user_id, symbol, strategy, leverage, capital, capital_mode, wallet_percent, name, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        input.userId,
        input.symbol,
        input.strategy,
        input.leverage,
        input.capital,
        input.capitalMode,
        input.walletPercent ?? null,
        input.name ?? null,
        input.status ?? "RUNNING",
      ],
    ) as any;

    return Number(result.insertId);
  }

  async updateBotStatus(id: number, status: BotStatus, currentTrade?: string | null) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET status = ?, current_trade = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [status, currentTrade ?? null, id],
    );
  }

  async updateBotHeartbeat(id: number, lastAnalysisAt?: string | null, lastExecutionAt?: string | null) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET last_analysis_at = ?, last_execution_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [toDbDate(lastAnalysisAt), toDbDate(lastExecutionAt), id],
    );
  }

  async setConfig(id: number, configJson: string) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [configJson, id],
    );
  }

  /**
   * Keep the DB symbol + leverage columns in sync with the currently
   * auto-selected coin. The `symbol` column is what the UI/trace shows and the
   * `leverage` column feeds the bot header, so both must reflect the live
   * selection rather than the static defaults saved at creation time.
   */
  async updateSelectedCoin(id: number, symbol: string, leverage: number) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET symbol = ?, leverage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [symbol, leverage, id],
    );
  }

  async updateConfig(
    id: number,
    input: { leverage: number; capital: number; capitalMode: "fixed" | "percent"; walletPercent?: number; name?: string | null; configJson: string },
  ) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET
        leverage = ?, capital = ?, capital_mode = ?, wallet_percent = ?, name = ?, config_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?;`,
      [input.leverage, input.capital, input.capitalMode, input.walletPercent ?? null, input.name ?? null, input.configJson, id],
    );
  }

  async deleteBot(id: number): Promise<boolean> {
    await this.ensureSchedulerSchema();
    const [result] = await db.query(`DELETE FROM automation_bots WHERE id = ?;`, [id]) as any;
    return (result?.affectedRows ?? 0) > 0;
  }

  async updateDesiredStatus(id: number, desiredStatus: DesiredBotStatus) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET desired_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [desiredStatus, id],
    );
  }

  async setRuntimeError(id: number, message: string | null) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [message, id],
    );
  }

  async setRetryCount(id: number, retryCount: number) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET retry_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [retryCount, id],
    );
  }

  async scheduleNextRun(id: number, nextRunAt: Date | null) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [nextRunAt, id],
    );
  }

  async updateHeartbeatAt(id: number, at: Date = new Date()) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [at, id],
    );
  }

  async updatePeakEquity(id: number, peakEquity: number) {
    await this.ensureSchedulerSchema();
    await db.query(
      `UPDATE automation_bots SET peak_equity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
      [peakEquity, id],
    );
  }

  async acquireLease(id: number, owner: string, ttlSeconds: number): Promise<boolean> {
    await this.ensureSchedulerSchema();
    const [result] = await db.query(
      `UPDATE automation_bots SET
        lease_owner = ?, lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < NOW());`,
      [owner, ttlSeconds, id],
    ) as any;
    return (result?.affectedRows ?? 0) > 0;
  }

  async releaseLease(id: number, owner: string): Promise<boolean> {
    await this.ensureSchedulerSchema();
    const [result] = await db.query(
      `UPDATE automation_bots SET lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_owner = ?;`,
      [id, owner],
    ) as any;
    return (result?.affectedRows ?? 0) > 0;
  }

  async extendLease(id: number, owner: string, ttlSeconds: number): Promise<boolean> {
    await this.ensureSchedulerSchema();
    const [result] = await db.query(
      `UPDATE automation_bots SET lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_owner = ?;`,
      [ttlSeconds, id, owner],
    ) as any;
    return (result?.affectedRows ?? 0) > 0;
  }

  async getRunningBots() {
    await this.ensureSchedulerSchema();
    const [rows] = await db.query(`SELECT * FROM automation_bots WHERE status = 'RUNNING' ORDER BY id DESC;`);
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  async getBotById(id: number) {
    await this.ensureSchedulerSchema();
    const [rows] = await db.query(`SELECT * FROM automation_bots WHERE id = ? LIMIT 1;`, [id]);
    return (rows as any[])[0] ? this.mapRow((rows as any[])[0]) : null;
  }

  async getBotsByDesiredStatus(desired: DesiredBotStatus[]) {
    await this.ensureSchedulerSchema();
    const placeholders = desired.map(() => "?").join(",");
    const [rows] = await db.query(
      `SELECT * FROM automation_bots WHERE desired_status IN (${placeholders}) ORDER BY id ASC;`,
      desired,
    );
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  async listBotsByUser(userId: number) {
    await this.ensureSchedulerSchema();
    const [rows] = await db.query(`SELECT * FROM automation_bots WHERE user_id = ? ORDER BY id DESC;`, [userId]);
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  async getBotByUserAndId(userId: number, botId: number) {
    await this.ensureSchedulerSchema();
    const [rows] = await db.query(`SELECT * FROM automation_bots WHERE id = ? AND user_id = ? LIMIT 1;`, [botId, userId]);
    return (rows as any[])[0] ? this.mapRow((rows as any[])[0]) : null;
  }

  async countActiveBotsForUser(userId: number): Promise<number> {
    await this.ensureSchedulerSchema();
    const [rows] = await db.query(
      `SELECT COUNT(*) AS count FROM automation_bots WHERE user_id = ? AND desired_status = 'RUNNING';`,
      [userId],
    );
    return Number((rows as any[])[0]?.count ?? 0);
  }

  async getSchedulableBots() {
    await this.ensureSchedulerSchema();
    const [rows] = await db.query(
      `SELECT * FROM automation_bots
       WHERE desired_status = 'RUNNING'
         AND status IN ('RUNNING','RECOVERING','STARTING')
         AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < NOW())
         AND (next_run_at IS NULL OR next_run_at <= NOW())
       ORDER BY id ASC;`,
    );
    return (rows as any[]).map((row) => this.mapRow(row));
  }

  private mapRow(row: any): BotRuntimeState {
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      symbol: row.symbol,
      strategy: row.strategy,
      name: row.name ?? null,
      leverage: Number(row.leverage),
      capital: Number(row.capital),
      capitalMode: row.capital_mode,
      walletPercent: row.wallet_percent != null ? Number(row.wallet_percent) : undefined,
      status: row.status as BotStatus,
      desiredStatus: (row.desired_status as DesiredBotStatus) ?? "STOPPED",
      currentTrade: row.current_trade ?? null,
      lastAnalysisAt: row.last_analysis_at ?? null,
      lastExecutionAt: row.last_execution_at ?? null,
      configJson: row.config_json ?? null,
      lastError: row.last_error ?? null,
      retryCount: Number(row.retry_count ?? 0),
      nextRunAt: row.next_run_at ?? null,
      heartbeatAt: row.heartbeat_at ?? null,
      leaseOwner: row.lease_owner ?? null,
      leaseExpiresAt: row.lease_expires_at ?? null,
      peakEquity: row.peak_equity != null ? Number(row.peak_equity) : null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }
}
