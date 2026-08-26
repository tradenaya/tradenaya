const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const envPath = path.join(process.cwd(), ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

(async () => {
  const db = await mysql.createConnection({
    host: env.DB_HOST || "localhost",
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });
  const [before] = await db.query("SELECT COUNT(*) AS c, MAX(id) AS max_id FROM automation_scheduler_events");
  console.log("EVENTS BEFORE:", JSON.stringify(before[0]));
  console.log("Waiting 15s to see if the scheduler emits events...");
  await new Promise((r) => setTimeout(r, 15000));
  const [after] = await db.query("SELECT COUNT(*) AS c, MAX(id) AS max_id FROM automation_scheduler_events");
  console.log("EVENTS AFTER:", JSON.stringify(after[0]));
  const [rows] = await db.query("SELECT id, type, message, created_at FROM automation_scheduler_events WHERE id > ? ORDER BY id ASC LIMIT 20", [before[0].max_id ?? 0]);
  for (const e of rows) console.log("NEW EVENT:", JSON.stringify(e));
  const [b2] = await db.query("SELECT id, status, desired_status, heartbeat_at, last_analysis_at, next_run_at, lease_owner, lease_expires_at FROM automation_bots WHERE id = 2");
  console.log("BOT2 AFTER:", JSON.stringify(b2[0]));
  await db.end();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
