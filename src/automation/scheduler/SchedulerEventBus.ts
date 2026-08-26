import { EventEmitter } from "events";
import type { SchedulerEvent, SchedulerEventType } from "./SchedulerTypes";

export class SchedulerEventBus {
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly persist?: (event: SchedulerEvent) => Promise<void>,
    private readonly onError: (error: unknown) => void = (error) => console.error("SchedulerEventBus persist failed", error),
  ) {}

  async emit(event: Omit<SchedulerEvent, "timestamp">): Promise<void> {
    const full: SchedulerEvent = { ...event, timestamp: new Date().toISOString() };
    this.emitter.emit(full.type, full);
    if (this.persist) {
      try {
        await this.persist(full);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  on(type: SchedulerEventType, listener: (event: SchedulerEvent) => void): void {
    this.emitter.on(type, listener);
  }
}
