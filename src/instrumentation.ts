export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { positionMonitor } = await import("@/automation/position/PositionMonitor");
    const { ensureTables } = await import("@/automation/position/bootstrap");
    try {
      await ensureTables();
    } catch (e) {
      console.error("PositionManager bootstrap: failed to ensure tables", e);
    }
    // ensureStarted is idempotent — it restarts the monitor after a hot reload
    // while never double-starting it. Recovery never assumes positions finished
    // just because this process was previously stopped.
    positionMonitor.ensureStarted().catch((e) => {
      console.error("PositionManager: failed to start monitor", e);
    });

    const { botScheduler } = await import("@/automation/scheduler/BotScheduler");
    botScheduler.start().catch((e) => {
      console.error("BotScheduler: failed to start scheduler", e);
    });
  }
}
