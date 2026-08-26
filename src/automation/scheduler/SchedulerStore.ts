import { db } from "@/lib/db";
import { executionStore, type ExecutionStore } from "@/automation/executor/store";
import { positionStore, type PositionStore } from "@/automation/position/PositionStore";
import { BotLifecycleService, type BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { ExecutionRecord } from "@/automation/executor/types";
import type { PositionRecord } from "@/automation/position/PositionManagerTypes";
import type { SchedulerEvent } from "./SchedulerTypes";

export interface SchedulerStoreDeps {
  lifecycle?: BotLifecycleService;
  executionStore?: ExecutionStore;
  positionStore?: PositionStore;
}

export class SchedulerStore {
  readonly lifecycle: BotLifecycleService;
  readonly executions: ExecutionStore;
  readonly positions: PositionStore;

  constructor(deps: SchedulerStoreDeps = {}) {
    this.lifecycle = deps.lifecycle ?? new BotLifecycleService();
    this.executions = deps.executionStore ?? executionStore;
    this.positions = deps.positionStore ?? positionStore;
  }

  async ensureEventsTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automation_scheduler_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        bot_id INT NOT NULL,
        user_id INT NOT NULL,
        type VARCHAR(50) NOT NULL,
        message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_user_created (user_id, created_at),
        KEY idx_bot_created (bot_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  async saveEvent(event: SchedulerEvent) {
    await this.ensureEventsTable();
    await db.query(
      `INSERT INTO automation_scheduler_events (bot_id, user_id, type, message) VALUES (?, ?, ?, ?);`,
      [event.botId, event.userId, event.type, event.message],
    );
  }

  async getActiveExecutionForBot(botId: number): Promise<ExecutionRecord | null> {
    const executions = await this.executions.getActiveExecutions();
    return executions.find((execution) => execution.botId === botId) ?? null;
  }

  async getActivePositionForBot(botId: number): Promise<PositionRecord | null> {
    const positions = await this.positions.getActivePositions();
    return positions.find((position) => position.botId === botId) ?? null;
  }

  async hasActiveTradeForBot(botId: number): Promise<boolean> {
    const [execution, position] = await Promise.all([
      this.getActiveExecutionForBot(botId),
      this.getActivePositionForBot(botId),
    ]);
    return Boolean(execution) || Boolean(position);
  }

  async getDailyStats(userId: number): Promise<{ realizedPnl: number; tradeCount: number }> {
    return this.positions.getDailyStats(userId, new Date().toISOString().slice(0, 10));
  }

  async getBot(id: number): Promise<BotRuntimeState | null> {
    return this.lifecycle.getBotById(id);
  }

  async getBotForUser(userId: number, botId: number): Promise<BotRuntimeState | null> {
    return this.lifecycle.getBotByUserAndId(userId, botId);
  }
}
