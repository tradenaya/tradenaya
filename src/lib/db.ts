import mysql from "mysql2/promise";

declare global {
  var __tradeNayaDb: mysql.Pool | undefined;
}

export function getDb(): mysql.Pool {
  if (!global.__tradeNayaDb) {
    global.__tradeNayaDb = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,

      // Treat JS Date <-> MySQL TIMESTAMP as UTC. Without this, mysql2 uses the
      // server's local timezone, which skewed scheduled run times by the local
      // offset (e.g. +5:30) and broke `next_run_at <= NOW()` comparisons.
      timezone: "Z",

      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return global.__tradeNayaDb;
}

// Reusing the pool across hot reloads prevents leaking connections every time a
// module that imports this file is re-evaluated in Next.js dev.
export const db = getDb();