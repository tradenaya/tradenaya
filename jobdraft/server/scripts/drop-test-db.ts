// Drops the jobdraft_test database (used after the Playwright e2e run).
import { loadEnvFile } from "../src/config/env.js";
import { dropDatabase } from "../src/db/migrate.js";

process.env.DB_NAME = "jobdraft_test";
loadEnvFile();
await dropDatabase("jobdraft_test");
console.log("Dropped jobdraft_test");
