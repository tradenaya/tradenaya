import type { CoinSwitchClient } from "@/automation/executor/client";
import type { BotLifecycleService, BotRuntimeState } from "@/automation/service/bot-lifecycle";
import { SchedulerStore } from "./SchedulerStore";
import { SchedulerStateManager } from "./SchedulerStateManager";
import { SchedulerEventBus } from "./SchedulerEventBus";
import type { AnalysisCycleRunner } from "./AnalysisCycleRunner";
import type { SchedulerState } from "./SchedulerTypes";

export interface SchedulerRecoveryDependencies {
  store: SchedulerStore;
  stateManager: SchedulerStateManager;
  events: SchedulerEventBus;
  lifecycle: BotLifecycleService;
  client: CoinSwitchClient;
  cycles: AnalysisCycleRunner;
}

export class SchedulerRecovery {
  constructor(private readonly deps: SchedulerRecoveryDependencies) {}

  async recoverAll(): Promise<void> {
    const bots = await this.deps.store.lifecycle.getBotsByDesiredStatus(["RUNNING", "PAUSED"]);
    for (const bot of bots) {
      try {
        await this.recoverBot(bot);
      } catch (error) {
        console.error(`SchedulerRecovery: failed to recover bot ${bot.id}`, error);
      }
    }
  }

  async recoverBot(bot: BotRuntimeState): Promise<void> {
    await this.deps.stateManager.transition(bot.id, this.asState(bot.status), "RECOVERING");
    await this.deps.lifecycle.updateHeartbeatAt(bot.id);
    await this.deps.events.emit({ type: "BOT_RECOVERED", botId: bot.id, userId: bot.userId, message: `Bot ${bot.id} is being recovered after restart` });

    const [execution, position] = await Promise.all([
      this.deps.store.getActiveExecutionForBot(bot.id),
      this.deps.store.getActivePositionForBot(bot.id),
    ]);

    if (position) {
      await this.deps.cycles.handoff(bot);
      return;
    }

    if (execution) {
      const active = await this.deps.cycles.reconcileEntryExecution(bot, execution);
      if (!active) {
        await this.deps.cycles.resume(bot);
        return;
      }
      await this.deps.cycles.handoff(bot);
      return;
    }

    await this.deps.cycles.resume(bot);
  }

  private asState(status: BotRuntimeState["status"]): SchedulerState {
    return status as SchedulerState;
  }
}
