import { BotLifecycleService, type BotRuntimeState, type BotStatus } from "./bot-lifecycle";
import { AutomationEngine } from "@/automation/engine/automation-engine";
import type { AutomationConfig } from "@/automation/types";

export class BotRunnerService {
  constructor(
    private readonly lifecycle = new BotLifecycleService(),
    private readonly engine = new AutomationEngine(),
  ) {}

  async startBot(userId: number, config: AutomationConfig) {
    const botId = await this.lifecycle.createBot({
      userId,
      symbol: config.symbol,
      strategy: "TrendStrategy",
      leverage: config.leverage,
      capital: config.capital,
      capitalMode: config.capitalMode,
      walletPercent: config.walletPercent,
      status: "RUNNING",
    });

    void this.runBotLoop(botId, config);
    return botId;
  }

  async stopBot(botId: number) {
    await this.lifecycle.updateBotStatus(botId, "STOPPED");
  }

  async pauseBot(botId: number) {
    await this.lifecycle.updateBotStatus(botId, "PAUSED");
  }

  private async runBotLoop(botId: number, config: AutomationConfig) {
    const bot = await this.lifecycle.getBotById(botId);
    if (!bot) return;

    while (true) {
      const current = await this.lifecycle.getBotById(botId);
      if (!current || current.status !== "RUNNING") break;

      await this.lifecycle.updateBotHeartbeat(botId, new Date().toISOString(), null);
      const result = await this.engine.run(config);

      if (result.signal === "WAIT") {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      if (result.plan) {
        await this.lifecycle.updateBotStatus(botId, "RUNNING", JSON.stringify(result.plan));
      }

      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}
