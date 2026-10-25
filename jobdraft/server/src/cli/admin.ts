// The ONLY way to make someone an admin: run this on the server, where only
// people with shell access can. There is no admin sign-up and no default admin.
//
//   npm run admin -- list
//   npm run admin -- grant you@example.com     (the account must already exist)
//   npm run admin -- revoke you@example.com
import { loadEnvFile } from "../config/env.js";

loadEnvFile();

const { closePool, execute, query, queryOne } = await import("../db/pool.js");
const { audit } = await import("../http/admin-routes.js");

const [command, rawEmail] = process.argv.slice(2);
const email = (rawEmail ?? "").trim().toLowerCase();

async function main() {
  if (command === "list") {
    const admins = await query<{ id: number; email: string; status: string }>("SELECT id, email, status FROM users WHERE role = 'admin' ORDER BY id");
    if (!admins.length) console.log("No admins yet. Make one with: npm run admin -- grant you@example.com");
    for (const a of admins) console.log(`  #${a.id}  ${a.email}${a.status === "active" ? "" : "  (inactive)"}`);
    return;
  }
  if ((command !== "grant" && command !== "revoke") || !email) {
    console.log("Usage: npm run admin -- list | grant <email> | revoke <email>");
    process.exitCode = 1;
    return;
  }
  const user = await queryOne<{ id: number; email: string; role: string; status: string }>("SELECT id, email, role, status FROM users WHERE email = ?", [email]);
  if (!user) {
    console.log(`No JobDraft account for ${email}. Register it on the website first, then run this again.`);
    process.exitCode = 1;
    return;
  }
  if (command === "grant") {
    if (user.role === "admin") return console.log(`${email} is already an admin.`);
    // An admin must be able to log in.
    await execute("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?", [user.id]);
    await audit(null, "admin_grant", user, "server shell");
    console.log(`${email} is now an admin. Log in and open /admin.`);
  } else {
    if (user.role !== "admin") return console.log(`${email} is not an admin.`);
    await execute("UPDATE users SET role = 'user' WHERE id = ?", [user.id]);
    await audit(null, "admin_revoke", user, "server shell");
    console.log(`${email} is no longer an admin (effective immediately).`);
  }
}

try {
  await main();
} catch (err) {
  console.error("admin command failed:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
