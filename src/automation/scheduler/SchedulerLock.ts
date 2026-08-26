import { randomUUID } from "crypto";
import type { BotLifecycleService } from "@/automation/service/bot-lifecycle";

export class SchedulerLock {
  readonly owner: string;

  constructor(
    private readonly lifecycle: BotLifecycleService,
    private readonly ttlSeconds: number,
  ) {
    this.owner = `${process.pid ?? "server"}-${randomUUID()}`;
  }

  async acquire(botId: number): Promise<boolean> {
    return this.lifecycle.acquireLease(botId, this.owner, this.ttlSeconds);
  }

  async refresh(botId: number): Promise<boolean> {
    return this.lifecycle.extendLease(botId, this.owner, this.ttlSeconds);
  }

  async release(botId: number): Promise<boolean> {
    return this.lifecycle.releaseLease(botId, this.owner);
  }
}
