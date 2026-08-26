import fs from "node:fs";
import path from "node:path";

console.log("SETUP RUNNING, DB_USER before:", process.env.DB_USER);

const envPath = path.resolve(process.cwd(), ".env.local");
console.log("SETUP envPath:", envPath, "exists:", fs.existsSync(envPath));try {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
} catch {
  // ignore
}
