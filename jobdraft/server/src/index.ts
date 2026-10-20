import { ensureSecrets, loadEnvFile } from "./config/env.js";

loadEnvFile();
ensureSecrets();

const { config, logFeatureStatus } = await import("./config/env.js");
const { initDatabase } = await import("./db/migrate.js");
const { closePool } = await import("./db/pool.js");
const { createApp } = await import("./app.js");
const { startScheduler, stopScheduler } = await import("./runs/scheduler.js");
const { errInfo, log } = await import("./lib/logger.js");

async function main() {
  const cfg = config();
  cfg.encryptionKey(); // fail fast on a malformed key
  logFeatureStatus();

  // The database is created and migrated on startup (not on the first request),
  // because the scheduler runs without any API traffic.
  await initDatabase();

  const server = createApp().listen(cfg.port, () => {
    log.info("server_listening", { port: cfg.port, clientUrl: cfg.clientUrl, mock: cfg.mockExternal });
  });

  if (cfg.schedulerEnabled) await startScheduler();
  else log.warn("scheduler_disabled");

  const shutdown = (signal: string) => {
    log.info("shutting_down", { signal });
    stopScheduler();
    server.close(() => void closePool().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("startup_failed", { error: errInfo(err) });
  process.exit(1);
});
