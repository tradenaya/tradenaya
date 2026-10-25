// Admin switches stored in app_settings; the env var is the default until the
// admin changes it on the admin page.
import { config } from "../config/env.js";
import { execute, queryOne } from "../db/pool.js";

/** New sign-ups wait for the admin's approval (needed while the Google app is in Testing mode). */
export async function signupApprovalRequired(): Promise<boolean> {
  const row = await queryOne<{ value: string }>("SELECT value FROM app_settings WHERE name = 'signup_approval'");
  return row ? row.value === "1" : config().signupApproval;
}

export async function setSignupApproval(on: boolean): Promise<void> {
  await execute("INSERT INTO app_settings (name, value) VALUES ('signup_approval', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [on ? "1" : "0"]);
}
