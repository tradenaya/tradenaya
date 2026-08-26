import { db } from "@/lib/db";
import { BacktestError } from "./errors";
import type {
  BacktestEquityPoint,
  BacktestMetrics,
  BacktestProgress,
  BacktestStatus,
  BacktestTrade,
} from "./types";

export interface BacktestRecord {
  id: number;
  userId: number;
  botId: number | null;
  symbol: string;
  timeframe: string;
  startTime: number;
  endTime: number;
  initialCapital: number;
  config: Record<string, unknown> | null;
  status: BacktestStatus;
  progress: BacktestProgress | null;
  executionPolicy: string | null;
  slippageApplied: boolean;
  metrics: BacktestMetrics | null;
  equityCurve: BacktestEquityPoint[];
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function mapRow(row: any): BacktestRecord {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    botId: row.bot_id != null ? Number(row.bot_id) : null,
    symbol: row.symbol,
    timeframe: row.timeframe,
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    initialCapital: Number(row.initial_capital),
    config: parseJson<Record<string, unknown>>(row.config_json),
    status: row.status,
    progress: parseJson<BacktestProgress>(row.progress_json),
    executionPolicy: row.execution_policy,
    slippageApplied: row.slippage_applied === 1 || row.slippage_applied === true || row.slippage_applied === "1",
    metrics: parseJson<BacktestMetrics>(row.metrics_json),
    equityCurve: parseJson<BacktestEquityPoint[]>(row.equity_curve_json) ?? [],
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export class BacktestStore {
  constructor() {
    this.ensureTables().catch((error) => {
      console.error("[BacktestStore] failed to ensure tables:", error);
    });
  }

  private async ensureTables(): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_backtests (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        bot_id INT NULL,
        symbol VARCHAR(32) NOT NULL,
        timeframe VARCHAR(16) NOT NULL,
        start_time BIGINT NOT NULL,
        end_time BIGINT NOT NULL,
        initial_capital DOUBLE NOT NULL,
        config_json JSON NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
        progress_json JSON NULL,
        execution_policy VARCHAR(16) NULL,
        slippage_applied TINYINT(1) NOT NULL DEFAULT 0,
        metrics_json JSON NULL,
        equity_curve_json JSON NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        KEY idx_user_id (user_id),
        KEY idx_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_backtest_trades (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        backtest_id BIGINT NOT NULL,
        trade_id VARCHAR(64) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        side VARCHAR(8) NOT NULL,
        entry_time BIGINT NOT NULL,
        entry_price DOUBLE NOT NULL,
        exit_time BIGINT NOT NULL,
        exit_price DOUBLE NOT NULL,
        quantity DOUBLE NOT NULL,
        leverage DOUBLE NOT NULL,
        margin DOUBLE NOT NULL,
        gross_pnl DOUBLE NOT NULL,
        entry_fee DOUBLE NOT NULL,
        exit_fee DOUBLE NOT NULL,
        total_fee DOUBLE NOT NULL,
        net_pnl DOUBLE NOT NULL,
        return_pct DOUBLE NOT NULL,
        mfe DOUBLE NOT NULL,
        mae DOUBLE NOT NULL,
        exit_reason VARCHAR(32) NOT NULL,
        duration_ms BIGINT NOT NULL,
        planned_risk_reward DOUBLE NOT NULL,
        KEY idx_backtest_id (backtest_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  }

  async create(input: {
    userId: number;
    botId: number | null;
    symbol: string;
    timeframe: string;
    startTime: number;
    endTime: number;
    initialCapital: number;
    config: Record<string, unknown>;
  }): Promise<number> {
    const [result] = await db.query(
      `INSERT INTO automation_backtests (
         user_id, bot_id, symbol, timeframe, start_time, end_time, initial_capital, config_json, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED');`,
      [
        input.userId,
        input.botId,
        input.symbol,
        input.timeframe,
        input.startTime,
        input.endTime,
        input.initialCapital,
        JSON.stringify(input.config),
      ],
    );
    return Number((result as any).insertId);
  }

  async updateStatus(
    id: number,
    status: BacktestStatus,
    opts: { progress?: BacktestProgress | null; errorMessage?: string | null } = {},
  ): Promise<void> {
    await db.query(
      `UPDATE automation_backtests SET
         status = ?,
         progress_json = ?,
         error_message = ?,
         completed_at = CASE WHEN ? IN ('COMPLETED','FAILED','CANCELLED') THEN CURRENT_TIMESTAMP ELSE completed_at END
       WHERE id = ?;`,
      [
        status,
        opts.progress != null ? JSON.stringify(opts.progress) : null,
        opts.errorMessage ?? null,
        status,
        id,
      ],
    );
  }

  async saveResult(
    id: number,
    input: {
      metrics: BacktestMetrics;
      equityCurve: BacktestEquityPoint[];
      executionPolicy: string;
      slippageApplied: boolean;
      completedAt: number;
    },
  ): Promise<void> {
    await db.query(
      `UPDATE automation_backtests SET
         status = 'COMPLETED',
         metrics_json = ?,
         equity_curve_json = ?,
         execution_policy = ?,
         slippage_applied = ?,
         progress_json = NULL,
         error_message = NULL,
         completed_at = FROM_UNIXTIME(?)
       WHERE id = ?;`,
      [
        JSON.stringify(input.metrics),
        JSON.stringify(input.equityCurve),
        input.executionPolicy,
        input.slippageApplied ? 1 : 0,
        Math.floor(input.completedAt / 1000),
        id,
      ],
    );
  }

  async insertTrades(backtestId: number, trades: BacktestTrade[]): Promise<void> {
    if (trades.length === 0) return;
    const values: unknown[] = [];
    const placeholders = trades
      .map((t) => {
        values.push(
          backtestId,
          t.tradeId,
          t.symbol,
          t.side,
          t.entryTime,
          t.entryPrice,
          t.exitTime,
          t.exitPrice,
          t.quantity,
          t.leverage,
          t.margin,
          t.grossPnl,
          t.entryFee,
          t.exitFee,
          t.totalFee,
          t.netPnl,
          t.returnPct,
          t.maxFavorableExcursion,
          t.maxAdverseExcursion,
          t.exitReason,
          t.durationMs,
          t.plannedRiskReward,
        );
        return "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      })
      .join(", ");
    await db.query(
      `INSERT INTO automation_backtest_trades (
         backtest_id, trade_id, symbol, side, entry_time, entry_price, exit_time, exit_price,
         quantity, leverage, margin, gross_pnl, entry_fee, exit_fee, total_fee, net_pnl,
         return_pct, mfe, mae, exit_reason, duration_ms, planned_risk_reward
       ) VALUES ${placeholders};`,
      values,
    );
  }

  async list(userId: number, limit = 20): Promise<BacktestRecord[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const [rows] = await db.query(
      `SELECT * FROM automation_backtests WHERE user_id = ? ORDER BY id DESC LIMIT ?;`,
      [userId, safeLimit],
    );
    return (rows as any[]).map(mapRow);
  }

  async get(userId: number, id: number): Promise<BacktestRecord | null> {
    const [rows] = await db.query(
      `SELECT * FROM automation_backtests WHERE id = ? AND user_id = ? LIMIT 1;`,
      [id, userId],
    );
    return (rows as any[]).length ? mapRow((rows as any[])[0]) : null;
  }

  async getTrades(userId: number, backtestId: number): Promise<BacktestTrade[]> {
    const [rows] = await db.query(
      `SELECT bt.* FROM automation_backtest_trades bt
       INNER JOIN automation_backtests b ON b.id = bt.backtest_id
       WHERE bt.backtest_id = ? AND b.user_id = ?
       ORDER BY bt.entry_time ASC;`,
      [backtestId, userId],
    );
    return (rows as any[]).map((row) => ({
      tradeId: row.trade_id,
      backtestId: Number(row.backtest_id),
      symbol: row.symbol,
      side: row.side,
      entryTime: Number(row.entry_time),
      entryPrice: Number(row.entry_price),
      exitTime: Number(row.exit_time),
      exitPrice: Number(row.exit_price),
      quantity: Number(row.quantity),
      leverage: Number(row.leverage),
      margin: Number(row.margin),
      grossPnl: Number(row.gross_pnl),
      entryFee: Number(row.entry_fee),
      exitFee: Number(row.exit_fee),
      totalFee: Number(row.total_fee),
      netPnl: Number(row.net_pnl),
      returnPct: Number(row.return_pct),
      maxFavorableExcursion: Number(row.mfe),
      maxAdverseExcursion: Number(row.mae),
      exitReason: row.exit_reason,
      durationMs: Number(row.duration_ms),
      plannedRiskReward: Number(row.planned_risk_reward),
    }));
  }

  async delete(userId: number, id: number): Promise<boolean> {
    const record = await this.get(userId, id);
    if (!record) return false;
    await db.query(`DELETE FROM automation_backtest_trades WHERE backtest_id = ?;`, [id]);
    const [result] = await db.query(`DELETE FROM automation_backtests WHERE id = ? AND user_id = ?;`, [id, userId]);
    return Number((result as any).affectedRows) > 0;
  }

  async countActive(userId: number): Promise<number> {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS count FROM automation_backtests
       WHERE user_id = ? AND status IN ('QUEUED', 'RUNNING');`,
      [userId],
    );
    return Number((rows as any[])[0]?.count ?? 0);
  }
}

/** Normalize a persisted record into the shape the API layer returns. */
export function summarizeBacktest(record: BacktestRecord) {
  const metrics = record.metrics;
  return {
    id: record.id,
    botId: record.botId,
    symbol: record.symbol,
    timeframe: record.timeframe,
    startTime: record.startTime,
    endTime: record.endTime,
    initialCapital: record.initialCapital,
    finalBalance: metrics?.finalBalance ?? null,
    status: record.status,
    totalReturnPct: metrics?.totalReturnPct ?? null,
    totalPnl: metrics?.totalPnl ?? null,
    winRate: metrics?.winRate ?? null,
    maxDrawdownPct: metrics?.maxDrawdownPct ?? null,
    profitFactor: metrics?.profitFactor ?? null,
    tradeCount: metrics?.tradeCount ?? null,
    executionPolicy: record.executionPolicy,
    slippageApplied: record.slippageApplied,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    errorMessage: record.errorMessage,
  };
}
