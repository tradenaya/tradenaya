import type { ExecutionState } from "@/automation/executor/types";
import type { PositionState } from "@/automation/position/PositionManagerTypes";
import type { SchedulerState } from "./SchedulerTypes";
import type { BotLifecycleService } from "@/automation/service/bot-lifecycle";

export const ALLOWED_TRANSITIONS: Record<SchedulerState, SchedulerState[]> = {
  STOPPED: ["STARTING", "PAUSED", "RECOVERING", "RUNNING"],
  STARTING: ["RUNNING", "STOPPED", "ERROR", "RECOVERING"],
  RUNNING: ["ANALYZING", "STOPPING", "PAUSED", "ERROR", "RECOVERING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED"],
  ANALYZING: ["RUNNING", "TRADE_PLANNED", "ERROR", "STOPPING", "STOPPED", "RECOVERING"],
  TRADE_PLANNED: ["ORDER_PENDING", "RUNNING", "ERROR", "STOPPING", "RECOVERING"],
  ORDER_PENDING: ["POSITION_OPEN", "POSITION_MANAGED", "RUNNING", "ERROR", "STOPPED", "RECOVERING"],
  POSITION_OPEN: ["POSITION_MANAGED", "STOPPING", "STOPPED", "ERROR", "RECOVERING", "RUNNING"],
  POSITION_MANAGED: ["POSITION_OPEN", "STOPPING", "STOPPED", "ERROR", "RECOVERING", "RUNNING"],
  PAUSED: ["RUNNING", "STOPPING", "STOPPED", "RECOVERING", "STARTING"],
  STOPPING: ["STOPPED", "ERROR", "RECOVERING", "PAUSED", "RUNNING"],
  ERROR: ["RECOVERING", "STARTING", "STOPPED", "RUNNING"],
  RECOVERING: ["RUNNING", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED", "ERROR", "STOPPED"],
};

export function canTransition(from: SchedulerState, to: SchedulerState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function stateFromExecutionState(state: ExecutionState): SchedulerState {
  switch (state) {
    case "MONITORING_ENTRY":
      return "ORDER_PENDING";
    case "ENTRY_FILLED":
    case "PARTIALLY_FILLED":
    case "UNPROTECTED":
      return "POSITION_OPEN";
    default:
      return "RUNNING";
  }
}

export function stateFromPositionState(state: PositionState): SchedulerState {
  switch (state) {
    case "WAITING_ENTRY":
    case "ENTRY_PENDING":
      return "ORDER_PENDING";
    case "ENTRY_EXECUTED":
    case "UNPROTECTED":
      return "POSITION_OPEN";
    case "PROTECTED":
    case "TRAILING":
    case "CLOSING":
      return "POSITION_MANAGED";
    default:
      return "RUNNING";
  }
}

export class SchedulerStateManager {
  constructor(private readonly lifecycle: BotLifecycleService) {}

  async transition(botId: number, from: SchedulerState, to: SchedulerState, currentTrade?: string | null): Promise<boolean> {
    // Validate against the bot's *actual* persisted state, not the (possibly
    // stale) `from` passed by the caller. Callers frequently resume a cycle
    // with the status captured before ANALYSIS started, which made
    // "RUNNING -> RUNNING" (the post-analysis path) fail the transition check
    // and left the bot stuck in ANALYZING, invisible to the scheduler.
    const current = await this.lifecycle.getBotById(botId);
    const actual = (current?.status as SchedulerState) ?? from;

    // Idempotent: already in the target state is a successful no-op.
    if (actual === to) return true;
    if (!canTransition(actual, to)) return false;

    await this.lifecycle.updateBotStatus(botId, to, currentTrade);
    return true;
  }
}
