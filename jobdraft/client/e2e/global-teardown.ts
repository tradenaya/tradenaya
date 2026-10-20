import { execSync } from "node:child_process";
import path from "node:path";

/** Drop the jobdraft_test database the e2e server created. */
export default function globalTeardown() {
  try {
    execSync("npm run --silent db:drop-test", { cwd: path.resolve(__dirname, "../../server"), stdio: "inherit" });
  } catch {
    console.warn("Could not drop jobdraft_test (it may already be gone).");
  }
}
