import fs from "node:fs/promises";
import { applyTestEnv, TEST_DB } from "./env.js";

// Creates jobdraft_test from scratch through the real migration path (v1 → v2…)
// and drops it afterwards.
export default async function setup() {
  applyTestEnv();
  const { dropDatabase, ensureDatabase, runMigrations } = await import("../src/db/migrate.js");
  const { migrations } = await import("../src/db/migrations.js");
  const { migrationV2 } = await import("../src/db/migration-v2.js");
  const all = migrations.some((m) => m.version === 2) ? migrations : [...migrations, migrationV2];
  await dropDatabase(TEST_DB);
  await ensureDatabase(TEST_DB);
  await runMigrations(TEST_DB, all);
  return async () => {
    await dropDatabase(TEST_DB);
    await fs.rm(process.env.MOCK_STORAGE_DIR!, { recursive: true, force: true });
  };
}
