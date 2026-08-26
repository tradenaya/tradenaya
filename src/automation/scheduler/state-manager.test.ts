import { describe, expect, it, vi } from "vitest";
import { SchedulerStateManager, canTransition } from "./SchedulerStateManager";

function makeLifecycle(initialStatus = "RUNNING") {
  let status = initialStatus;
  const calls: Array<{ from: string; to: string }> = [];

  return {
    lifecycle: {
      getBotById: vi.fn(async () => ({ status, id: 1 })),
      updateBotStatus: vi.fn(async (_id: number, next: string) => {
        calls.push({ from: status, to: next });
        status = next;
      }),
    },
    get status() {
      return status;
    },
    calls,
  };
}

describe("SchedulerStateManager.transition", () => {
  it("is a no-op (success) when the bot is already in the target state", async () => {
    const fake = makeLifecycle("RUNNING");
    const manager = new SchedulerStateManager(fake.lifecycle as any);

    const ok = await manager.transition(1, "RUNNING", "RUNNING");

    expect(ok).toBe(true);
    expect(fake.lifecycle.updateBotStatus).not.toHaveBeenCalled();
    expect(fake.status).toBe("RUNNING");
  });

  it("uses the persisted state, not the stale `from`, for the transition check", async () => {
    // The cycle started while the bot was RUNNING (stale `from`), but the
    // persisted state is ANALYZING. Transitioning back to RUNNING must work.
    const fake = makeLifecycle("ANALYZING");
    const manager = new SchedulerStateManager(fake.lifecycle as any);

    const ok = await manager.transition(1, "RUNNING", "RUNNING");

    expect(ok).toBe(true);
    expect(fake.lifecycle.updateBotStatus).toHaveBeenCalledWith(1, "RUNNING", undefined);
    expect(fake.status).toBe("RUNNING");
  });

  it("moves ANALYZING -> RUNNING after a WAIT cycle", async () => {
    const fake = makeLifecycle("ANALYZING");
    const manager = new SchedulerStateManager(fake.lifecycle as any);

    const ok = await manager.transition(1, "ANALYZING", "RUNNING");

    expect(ok).toBe(true);
    expect(fake.status).toBe("RUNNING");
  });

  it("rejects illegal transitions against the persisted state", async () => {
    const fake = makeLifecycle("STOPPED");
    const manager = new SchedulerStateManager(fake.lifecycle as any);

    const ok = await manager.transition(1, "STOPPED", "ORDER_PENDING");

    expect(ok).toBe(false);
    expect(fake.lifecycle.updateBotStatus).not.toHaveBeenCalled();
    expect(fake.status).toBe("STOPPED");
  });

  it("preserves canTransition semantics for a normal RUNNING -> ANALYZING move", () => {
    expect(canTransition("RUNNING", "ANALYZING")).toBe(true);
    expect(canTransition("RUNNING", "RUNNING")).toBe(false);
  });
});
