import mysql from "mysql2/promise";
import { config } from "../config/env.js";
import { errInfo, log } from "../lib/logger.js";
import { migrations as allMigrations, type Migration } from "./migrations.js";

const ACCESS_DENIED = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"]);

function assertSafeName(name: string) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error("DB_NAME may only contain letters, digits and underscores.");
}

function grantHelp(dbName: string): string {
  const { db } = config();
  return (
    `The MySQL user '${db.user}' is not allowed to create or change the '${dbName}' database. ` +
    `Ask a MySQL admin to run:  CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4; ` +
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${db.user}'@'%'; ` +
    `(for tests also: GRANT ALL PRIVILEGES ON \`jobdraft_test\`.* TO '${db.user}'@'%';)  then FLUSH PRIVILEGES; and restart JobDraft.`
  );
}

async function serverConnection() {
  const { db } = config();
  return mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password, charset: "utf8mb4", multipleStatements: false });
}

/** CREATE DATABASE IF NOT EXISTS, connecting without a default database. */
export async function ensureDatabase(dbName = config().db.name): Promise<void> {
  assertSafeName(dbName);
  const conn = await serverConnection();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (ACCESS_DENIED.has(code)) {
      // The database may already exist (created by an admin) — that's fine.
      const [rows] = await conn.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [dbName]);
      if ((rows as unknown[]).length === 0) {
        log.error("db_permission_missing", { message: grantHelp(dbName) });
        throw err;
      }
    } else {
      throw err;
    }
  } finally {
    await conn.end();
  }
}

export async function dropDatabase(dbName: string): Promise<void> {
  assertSafeName(dbName);
  if (!/test|e2e/.test(dbName)) throw new Error("Refusing to drop a non-test database");
  const conn = await serverConnection();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  } finally {
    await conn.end();
  }
}

/** Applies every migration newer than the recorded version, in order. */
export async function runMigrations(dbName = config().db.name, migrations: Migration[] = allMigrations): Promise<number[]> {
  assertSafeName(dbName);
  const { db } = config();
  const conn = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password, database: dbName, charset: "utf8mb4" });
  const applied: number[] = [];
  try {
    // Only one process migrates at a time (several pm2 instances may start together).
    const [lockRows] = await conn.query("SELECT GET_LOCK(?, 60) AS got", [`${dbName}_migrate`]);
    if ((lockRows as { got: number }[])[0]?.got !== 1) throw new Error("Could not acquire the migration lock");
    try {
      await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT UNSIGNED NOT NULL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      const [rows] = await conn.query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations");
      const current = Number((rows as { v: number }[])[0]?.v ?? 0);
      const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > current);
      for (const m of pending) {
        for (const sql of m.statements) await conn.query(sql);
        await conn.query("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [m.version, m.name]);
        applied.push(m.version);
        log.info("migration_applied", { version: m.version, name: m.name });
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [`${dbName}_migrate`]);
    }
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (ACCESS_DENIED.has(code) || code === "ER_TABLEACCESS_DENIED_ERROR") log.error("db_permission_missing", { message: grantHelp(dbName) });
    else log.error("migration_failed", { error: errInfo(err) });
    throw err;
  } finally {
    await conn.end();
  }
  return applied;
}

export async function initDatabase(): Promise<void> {
  const name = config().db.name;
  await ensureDatabase(name);
  const applied = await runMigrations(name);
  log.info("db_ready", { database: name, newlyApplied: applied.length });
}
