import mysql from "mysql2/promise";
import { config } from "../config/env.js";

let pool: mysql.Pool | undefined;

export function getPool(): mysql.Pool {
  if (!pool) {
    const { db } = config();
    pool = mysql.createPool({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.name,
      charset: "utf8mb4",
      // JS Date <-> MySQL DATETIME as UTC (same choice as Tradenaya's pool).
      timezone: "Z",
      dateStrings: ["DATE"],
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

type Params = unknown[];

export async function query<T = mysql.RowDataPacket>(sql: string, params: Params = []): Promise<T[]> {
  const [rows] = await getPool().query(sql, params as never);
  return rows as T[];
}

export async function queryOne<T = mysql.RowDataPacket>(sql: string, params: Params = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: Params = []): Promise<mysql.ResultSetHeader> {
  const [result] = await getPool().query(sql, params as never);
  return result as mysql.ResultSetHeader;
}

export function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string })?.code === "ER_DUP_ENTRY";
}

/** mysql2 returns JSON columns parsed already; older servers may return strings. */
export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
