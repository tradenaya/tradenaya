export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { positionMonitor } = await import("@/automation/position/PositionMonitor");
    const { ensureTables } = await import("@/automation/position/bootstrap");
    try {
      await ensureTables();
    } catch (e) {
      console.error("PositionManager bootstrap: failed to ensure tables", e);
    }
    // Reconciliation MUST finish before the scheduler's first analysis cycle so
    // a bot whose position was already closed on the exchange is never re-entered
    // into a new trade while the DB still thinks it is active. ensureStarted is
    // idempotent (never double-starts after hot reload) and runs the full
    // exchange→DB recovery sweep synchronously before resolving.
    try {
      await positionMonitor.ensureStarted();
    } catch (e) {
      console.error("PositionManager: failed to start monitor (recovery sweep aborted — scheduler will still start)", e);
    }

    const { botScheduler } = await import("@/automation/scheduler/BotScheduler");
    botScheduler.start().catch((e) => {
      console.error("BotScheduler: failed to start scheduler", e);
    });
  }
}
