export type SchedulerState =
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

export type SchedulerEventType =
  | "BOT_STARTED"
  | "BOT_STOPPED"
  | "BOT_PAUSED"
  | "BOT_RESUMED"
  | "BOT_CONFIG_UPDATED"
  | "ANALYSIS_STARTED"
  | "ANALYSIS_COMPLETED"
  | "TRADE_PLANNED"
  | "RISK_REJECTED"
  | "ENTRY_ORDER_CREATED"
  | "ENTRY_ORDER_FILLED"
  | "POSITION_OPENED"
  | "POSITION_CLOSED"
  | "BOT_ERROR"
  | "BOT_RECOVERED"
  | "CYCLE_RETRY"
  | "LOCK_ACQUIRED"
  | "LOCK_RELEASED";

// Additional event types for AUTO selection candidate visibility in the
// activity feed / live trace. These are intentionally simple string tokens
// persisted into the same automation_scheduler_events table so the UI can
// display them alongside existing scheduler events.
export type SchedulerEventTypeExtended = SchedulerEventType | "AUTO_SCAN_STARTED" | "AUTO_CANDIDATE" | "AUTO_CANDIDATE_RESULT" | "AUTO_SCAN_COMPLETE";

export interface SchedulerEvent {
  type: SchedulerEventTypeExtended;
  botId: number;
  userId: number;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface SchedulerConfig {
  tickIntervalMs?: number;
  leaseTtlSeconds?: number;
  maxConsecutiveFailures?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  analysisIntervalMinutes?: number;
}

export const DEFAULT_SCHEDULER_CONFIG: Required<SchedulerConfig> = {
  tickIntervalMs: 5000,
  leaseTtlSeconds: 300,
  maxConsecutiveFailures: 5,
  backoffBaseMs: 30000,
  backoffMaxMs: 900000,
  analysisIntervalMinutes: 5,
};

export interface CycleResult {
  executed: boolean;
  state: SchedulerState;
  action: "ANALYZED" | "TRADE_EXECUTED" | "POSITION_HANDOFF" | "ERROR" | "SKIPPED";
  message: string;
}
