import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, request as pwRequest, test, type Page } from "@playwright/test";

const RESUME = path.join(__dirname, "fixtures", "resume.pdf");
const API = "http://localhost:5056";
/** A well-formed fake key: the e2e server runs in mock mode, so it isn't checked with Google. */
const GEMINI_KEY = "AIzaE2eTestKey_0123456789abcdefghijklmn";

/** No horizontal scrolling at this viewport width. */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `page ${page.url()} scrolls horizontally`).toBeLessThanOrEqual(innerWidth);
}

async function goTo(page: Page, label: string, isMobile: boolean) {
  const nav = isMobile ? page.getByTestId("bottom-nav") : page.locator("header nav");
  await nav.getByRole("link", { name: label }).click();
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
}

/** Uses the clock-dial picker: AM/PM, then the hour, then the minutes, then Set. */
async function pickTime(page: Page, ampm: "AM" | "PM", hour: number, minute: number) {
  await page.getByTestId("run-time-button").click();
  const dialog = page.getByRole("dialog", { name: "Choose your daily run time" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: ampm, exact: true }).click();
  await dialog.getByRole("button", { name: `${hour} o'clock` }).click();
  await expect(dialog.getByRole("group", { name: "Minutes" })).toBeVisible(); // dial switched to minutes
  await dialog.getByRole("button", { name: `${String(minute).padStart(2, "0")} minutes` }).click();
  await dialog.getByRole("button", { name: /^Set / }).click();
  await expect(dialog).toBeHidden();
}

/** Every important action asks first: check the popup appeared, then confirm it. */
async function confirmWith(page: Page, label: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Name").fill("Priya Sharma");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-1");
  await page.getByLabel("Gemini API key").fill(GEMINI_KEY);
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmWith(page, "Create account");
  await expect(page).toHaveURL(/\/setup/);
}

test("login and register pages fit the screen", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
});

test("register → setup → automation ON → run now → dashboard sends → history → automation OFF", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const isMobile = testInfo.project.name.startsWith("mobile");
  await register(page, `e2e-${testInfo.project.name}-${Date.now()}@example.org`);
  // The e2e server is shared by both viewports: undo any earlier fast-forward.
  expect((await page.request.post(`${API}/api/__test/reset-clock`)).ok()).toBe(true);

  // Setup with the 3-step progress indicator
  await expect(page.getByRole("heading", { level: 1, name: "Setup" })).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Setup progress" });
  await expect(steps).toContainText("Resume");
  await expect(steps).toContainText("Preferences");
  await expect(steps).toContainText("Connect Gmail");
  await expectNoHorizontalOverflow(page);
  if (isMobile) await expect(page.getByTestId("bottom-nav")).toBeVisible();
  else await expect(page.getByTestId("bottom-nav")).toBeHidden();

  // 1. Resume upload + preview (past employers become "companies to skip")
  await page.locator("#resume-file").setInputFiles(RESUME);
  await confirmWith(page, "Upload resume");
  await expect(page.getByText("Something read wrong? Edit the details, or upload a corrected resume.")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#resume")).toContainText("Acme Retail Tech");
  const skip = page.getByRole("list", { name: "Companies to skip" });
  await expect(skip).toContainText("Acme Retail Tech");
  await expect(skip).toContainText("from resume");

  // 2. Preferences: one role, Bengaluru, salary, run time with a live "Next run" hint
  const roles = page.getByRole("list", { name: "Selected roles" });
  await expect(roles.getByText("Software Engineer", { exact: true })).toBeVisible();
  for (const name of await roles.getByRole("button", { name: /^Remove / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!))) {
    if (name !== "Remove Software Engineer") await roles.getByRole("button", { name, exact: true }).click();
  }
  await expect(roles.getByRole("listitem")).toHaveCount(1);
  // Related roles: one tap adds a tag (then remove it again for this flow).
  const related = page.getByTestId("related-roles").getByRole("button");
  await expect(related.first()).toBeVisible();
  const extra = (await related.first().textContent())!.trim();
  await related.first().click();
  await expect(roles.getByText(extra, { exact: true })).toBeVisible();
  await roles.getByRole("button", { name: `Remove ${extra}`, exact: true }).click();
  await expect(roles.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("combobox", { name: /Locations/ }).fill("bangal");
  await page.getByRole("option", { name: /Bengaluru/ }).click();
  await page.getByLabel("Expected salary (LPA)").fill("12");
  const hint = page.getByTestId("next-run-hint");
  await expect(hint).toContainText("Next run:");
  await pickTime(page, "PM", 11, 45);
  await expect(page.getByTestId("run-time-button")).toContainText("11:45 PM");
  await expect(hint).toContainText("11:45 PM IST");
  await pickTime(page, "AM", 6, 15);
  await expect(hint).toContainText("6:15 AM IST");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await confirmWith(page, "Save preferences");
  await expect(page.getByText("Preferences saved.")).toBeVisible();

  // 3. Connect Gmail (mocked OAuth round trip)
  await page.getByRole("button", { name: "Connect Gmail" }).click();
  await confirmWith(page, "Continue to Google");
  await expect(page.getByText(/Gmail connected/).first()).toBeVisible();
  await expect(page.locator("#gmail")).toContainText("mock.user@gmail.com");
  await expect(page.locator("#gmail")).toContainText("Read email headers only");
  await expectNoHorizontalOverflow(page);

  // Dashboard → Automation ON → Run now
  await goTo(page, "Dashboard", isMobile);
  const automation = page.getByRole("switch", { name: /Automation/ });
  await expect(automation).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("next-run")).toHaveText("Automation is off");
  await automation.click();
  await confirmWith(page, "Turn on");
  await expect(automation).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("next-run")).toContainText("6:15 AM IST");
  await expect(page.getByRole("link", { name: "Open Gmail drafts" })).toHaveAttribute("href", "https://mail.google.com/mail/u/0/#drafts");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Run now" }).click();
  await confirmWith(page, "Run now");
  await expect(page.locator("#last-run").getByText("Ready to send")).toBeVisible({ timeout: 60_000 });

  // Scheduled sends with a countdown and Cancel
  const upcoming = page.getByTestId("upcoming-item");
  await expect(upcoming.first()).toBeVisible();
  const count = await upcoming.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await expect(upcoming.first()).toContainText(/in (29|30|31) min/);
  await upcoming.first().getByRole("button", { name: /^Cancel application/ }).click();
  await confirmWith(page, "Cancel email");
  await expect(page.getByText("Cancelled. It stays in your Gmail drafts.")).toBeVisible();
  await expect(upcoming).toHaveCount(count - 1);
  await expectNoHorizontalOverflow(page);

  // Fast-forward the (mock) server clock past the 30-minute window so the queue sends.
  const tick = await page.request.post(`${API}/api/__test/tick`, { data: { minutes: 35 } });
  expect(tick.ok()).toBe(true);

  // History → expand → status chips, timeline and "Stop follow-ups"
  await goTo(page, "History", isMobile);
  // The run card shows the funnel in one line: "Fetched N → after filters N → suitable N → emails N → link-only N".
  await expect(page.getByTestId("funnel-summary").first()).toContainText(/Fetched \d+.*after filters \d+.*suitable \d+.*emails \d+.*link-only \d+/);
  await page.getByRole("button", { expanded: false }).filter({ hasText: "Run now" }).first().click();
  const apps = page.getByTestId("application-item");
  await expect(apps.first()).toBeVisible();
  await expect(page.getByTestId("link-item").first()).toBeVisible();
  // "Apply via link": a cover note for the application form, written on request.
  const link = page.getByTestId("link-item").first();
  await link.getByRole("button", { name: /^Write a cover note for / }).click();
  await expect(link.getByTestId("cover-note")).toContainText("Dear Hiring Team,");
  await expect(link.getByRole("button", { name: "Copy" })).toBeVisible();
  await link.screenshot({ path: testInfo.outputPath("cover-note.png") });
  await link.getByRole("button", { name: /^Hide a cover note for / }).click();
  await expect(link.getByTestId("cover-note")).toBeHidden();
  // Tap the funnel for per-step details.
  await page.getByRole("button", { name: /How this run went/ }).click();
  const funnel = page.getByTestId("funnel");
  await expect(funnel.getByRole("heading", { name: "Removed by filters" })).toBeVisible();
  await expect(funnel).toContainText("Past employers / companies to skip");
  await expect(funnel).toContainText("Demo source");
  await expectNoHorizontalOverflow(page);
  await funnel.screenshot({ path: testInfo.outputPath("funnel.png") });
  const sent = apps.filter({ hasText: /Sent ·/ }).first();
  await expect(sent).toBeVisible();
  await expect(sent.getByRole("list", { name: "Timeline" })).toContainText("Waiting for a reply");
  await expect(apps.filter({ hasText: "Cancelled — kept as a draft" })).toHaveCount(1);
  await expect(apps.filter({ hasText: "Draft – waiting for you" }).first()).toBeVisible();
  await sent.getByRole("button", { name: "Stop follow-ups" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Stop follow-ups" }).click();
  await expect(page.getByText("No more follow-ups will be sent for this application.")).toBeVisible();
  await expect(apps.filter({ hasText: "Stopped" }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Dashboard → Automation OFF
  await goTo(page, "Dashboard", isMobile);
  await page.getByRole("switch", { name: /Automation/ }).click();
  await confirmWith(page, "Turn off");
  await expect(page.getByRole("switch", { name: /Automation/ })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("next-run")).toHaveText("Automation is off");
  await expect(page.getByRole("button", { name: "Run now" })).toBeDisabled();

  // Account page fits too, and the theme toggle works
  await goTo(page, "Account", isMobile);
  await expect(page.getByRole("button", { name: "Deactivate account" })).toBeVisible();
  await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).click();
  await expectNoHorizontalOverflow(page);
});

test("resume: size check first, reading animation, then edit the details", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await register(page, `e2e-edit-${testInfo.project.name}-${Date.now()}@example.org`);
  await expect(page.getByText("PDF only · max 5 MB · text-based, not a scan")).toBeVisible();

  // Too big: rejected straight away with its size — no popup, no upload.
  let uploads = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/profile/resume")) uploads++;
  });
  await page.locator("#resume-file").setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(6 * 1024 * 1024, 0x20) });
  await expect(page.locator("#resume").getByRole("alert")).toContainText('"huge.pdf" is 6.0 MB. The maximum is 5 MB');
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(uploads).toBe(0);

  // A slow AI read: the upload answers 202 and the page polls the status until it's done
  // (the mock AI is instant, so the browser is told "still reading" for a few polls).
  let saved: unknown = null;
  let polls = 0;
  await page.route("**/api/profile/resume", async (route) => {
    // Really upload (same session cookie), but tell the page it's still being read.
    const res = await page.request.post(`${API}/api/profile/resume`, {
      multipart: { resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(RESUME) } },
    });
    expect(res.status()).toBe(200);
    saved = await res.json();
    await route.fulfill({ status: 202, json: { status: "reading" } });
  });
  await page.route("**/api/profile/resume/status", async (route) => {
    polls++;
    if (polls < 6 || !saved) return route.fulfill({ json: { status: "reading", fileName: "resume.pdf", seconds: 3 * polls } });
    await route.fulfill({ json: { status: "done", profile: saved } });
  });
  await page.locator("#resume-file").setInputFiles(RESUME);
  await confirmWith(page, "Upload resume");
  const reading = page.getByTestId("resume-reading");
  await expect(reading).toBeVisible();
  await expect(reading).toContainText("Reading your resume");
  await expect(reading).toContainText("Usually takes 10–30 seconds");
  await expect(reading.getByText("Reading your experience and skills")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("reading.png") });
  // Refreshing mid-read picks the read back up.
  await expect.poll(() => polls).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(reading).toBeVisible();
  await expect(reading).toContainText("resume.pdf");
  await expect(reading).toBeHidden({ timeout: 30_000 });
  expect(polls).toBeGreaterThanOrEqual(6);
  await page.unroute("**/api/profile/resume");
  await page.unroute("**/api/profile/resume/status");
  await expect(page.locator("#resume")).toContainText("Priya Sharma");

  // Edit: change the name, a role and skills; Save asks first.
  await page.getByRole("button", { name: "Edit details" }).click();
  const editor = page.getByTestId("resume-editor");
  await expect(editor).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("editor.png"), fullPage: true });
  await editor.getByLabel("Full name").fill("Priya K. Sharma");
  await editor.getByLabel("Job title").first().fill("Lead Engineer");
  await editor.getByPlaceholder("Add a skill, e.g. React").fill("Kubernetes");
  await editor.getByRole("button", { name: "Add skill" }).click();
  // A bad date is reported on the field.
  await editor.getByLabel("Start").first().fill("sometime");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await confirmWith(page, "Save changes");
  await expect(editor.getByText("Use a date like 2024-06, Jun 2024 or 2024.")).toBeVisible();
  await editor.getByLabel("Start").first().fill("2019-04");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await confirmWith(page, "Save changes");
  await expect(editor).toBeHidden();
  const card = page.locator("#resume");
  await expect(card).toContainText("Priya K. Sharma");
  await expect(card).toContainText("Lead Engineer");
  await expect(card).toContainText("Kubernetes");

  // Cancel with changes asks before throwing them away.
  await page.getByRole("button", { name: "Edit details" }).click();
  await editor.getByLabel("Full name").fill("Someone Else");
  await editor.getByRole("button", { name: "Cancel" }).click();
  await confirmWith(page, "Discard changes");
  await expect(editor).toBeHidden();
  await expect(card).toContainText("Priya K. Sharma");
});

test("deactivate account → confirmation screen → register again with the same email from scratch", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name.startsWith("mobile");
  const email = `bye-${testInfo.project.name}-${Date.now()}@example.org`;
  await register(page, email);
  await goTo(page, "Account", isMobile);
  await page.getByRole("button", { name: "Deactivate account" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("No more emails will be drafted");
  await expect(dialog).toContainText("start from the beginning");
  await dialog.getByLabel("Enter your password to confirm").fill("wrong-password");
  await dialog.getByRole("button", { name: "Yes, delete permanently" }).click();
  await expect(dialog).toContainText("Incorrect password");
  await dialog.getByLabel("Enter your password to confirm").fill("e2e-password-1");
  await dialog.getByRole("button", { name: "Yes, delete permanently" }).click();

  await expect(page).toHaveURL(/\/register\?deactivated=1/);
  await expect(page.getByTestId("deactivated-banner")).toContainText("Your account has been deactivated");
  await expect(page.getByRole("heading", { name: "Start again" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByLabel("Name").fill("Priya Sharma");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-2");
  await page.getByLabel("Gemini API key").fill(GEMINI_KEY);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmWith(page, "Create account");
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.locator('label[for="resume-file"]')).toContainText("Upload resume (PDF)");
  await expect(page.getByRole("navigation", { name: "Setup progress" })).toContainText("current step");
});

test("sending mode: disabled while automation is OFF, one mode at a time, confirmation for Send all instantly", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const isMobile = testInfo.project.name.startsWith("mobile");
  await register(page, `e2e-mode-${testInfo.project.name}-${Date.now()}@example.org`);
  // Resume and preferences through the API (same session) — this test is about the selector.
  const upload = await page.request.post(`${API}/api/profile/resume`, {
    multipart: { resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(RESUME) } },
  });
  expect(upload.ok()).toBe(true);
  const prefs = await page.request.put(`${API}/api/profile/preferences`, {
    data: { target_roles: ["Software Engineer"], locations: ["Bengaluru, Karnataka"], expected_salary_lpa: 12, run_time: "09:00" },
  });
  expect(prefs.ok()).toBe(true);
  await page.reload();

  // Automation OFF: visible but disabled, with the hint.
  const group = page.getByRole("radiogroup", { name: "Sending mode" });
  await expect(group).toBeVisible();
  await expect(page.locator("#send-mode")).toContainText("Turn on automation to use");
  for (const name of ["Drafts only", "Smart send (recommended)", "Send all", "Send all instantly"]) await expect(group.getByRole("radio", { name, exact: true })).toBeDisabled();
  await expect(group.getByRole("radio", { name: "Smart send (recommended)", exact: true })).toHaveAttribute("aria-checked", "true"); // the default

  // Connect Gmail and turn automation on.
  await page.getByRole("button", { name: "Connect Gmail" }).click();
  await confirmWith(page, "Continue to Google");
  await expect(page.getByText(/Gmail connected/).first()).toBeVisible();
  const on = await page.request.put(`${API}/api/automation`, { data: { enabled: true } });
  expect(on.ok()).toBe(true);
  await page.reload();
  await expect(group.getByRole("radio", { name: "Drafts only", exact: true })).toBeEnabled();
  await expectNoHorizontalOverflow(page);

  const radio = (name: string) => group.getByRole("radio", { name, exact: true });
  const expectOnly = async (name: string) => {
    await expect(radio(name)).toHaveAttribute("aria-checked", "true");
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
  };
  // Touch targets are at least 44px tall.
  for (const r of await group.getByRole("radio").all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await radio("Drafts only").click();
  await confirmWith(page, "Switch to Drafts only");
  await expectOnly("Drafts only");
  await radio("Send all").click();
  await confirmWith(page, "Switch to Send all");
  await expectOnly("Send all");

  // Send all instantly asks first; "Go back" keeps the current mode.
  await radio("Send all instantly").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Emails will be sent without a chance to cancel. Continue?");
  await page.screenshot({ path: testInfo.outputPath("send-mode-confirm.png") });
  await dialog.getByRole("button", { name: "Go back" }).click();
  await expectOnly("Send all");
  await radio("Send all instantly").click();
  await confirmWith(page, "Continue");
  await expectOnly("Send all instantly");
  await page.locator("#send-mode").screenshot({ path: testInfo.outputPath("send-mode.png") });

  // Dashboard shows the mode next to the switch, with a Change link back here.
  await goTo(page, "Dashboard", isMobile);
  const summary = page.getByTestId("send-mode-summary");
  await expect(summary).toContainText("Sending mode: Send all instantly");
  await summary.getByRole("link", { name: "Change" }).click();
  await expect(page).toHaveURL(/\/setup#send-mode/);
  await expect(page.getByRole("radiogroup", { name: "Sending mode" })).toBeVisible();

  // Automation OFF again: disabled, choice kept.
  const off = await page.request.put(`${API}/api/automation`, { data: { enabled: false } });
  expect(off.ok()).toBe(true);
  await page.reload();
  await expect(radio("Send all instantly")).toBeDisabled();
  await expect(radio("Send all instantly")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#send-mode")).toContainText("Turn on automation to use");
});

test("Gemini key: where to get one, required at sign-up, and managed on Setup", async ({ page }, testInfo) => {
  // Registration explains where to get a key, with a link that opens Google AI Studio in a new tab.
  await page.goto("/register");
  const link = page.getByTestId("get-gemini-key");
  await expect(link).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.getByText("Click Create API key, then copy it.")).toBeVisible();
  await page.getByLabel("Name").fill("Priya Sharma");
  await page.getByLabel("Email").fill(`e2e-key-${testInfo.project.name}-${Date.now()}@example.org`);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Paste your Gemini API key.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("register-key.png"), fullPage: true });
  await page.getByLabel("Gemini API key").fill(GEMINI_KEY);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmWith(page, "Create account");
  await expect(page).toHaveURL(/\/setup/);

  // Setup: the saved key shows only its last 4 characters; it can be removed and added back.
  const card = page.locator("#gemini-key");
  await expect(card.getByTestId("gemini-key-status")).toContainText(`Saved key ending in …${GEMINI_KEY.slice(-4)}`);
  await expect(card).not.toContainText(GEMINI_KEY);
  await card.getByRole("button", { name: "Remove" }).click();
  await confirmWith(page, "Remove key");
  await expect(card).toContainText("Add your key to get started");
  await expect(card.getByTestId("get-gemini-key")).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  await card.getByLabel("Gemini API key").fill(GEMINI_KEY);
  await card.getByRole("button", { name: "Save key" }).click();
  await confirmWith(page, "Save key");
  await expect(card.getByTestId("gemini-key-status")).toContainText(`…${GEMINI_KEY.slice(-4)}`);
  await expectNoHorizontalOverflow(page);
});

test("JSearch key: optional, only on Setup, with the steps; not subscribed yet, then a working key", async ({ page }, testInfo) => {
  // Not asked for at sign-up.
  await page.goto("/register");
  await expect(page.getByLabel("RapidAPI key")).toHaveCount(0);
  await register(page, `e2e-jsearch-${testInfo.project.name}-${Date.now()}@example.org`);

  // Setup: an optional card, never a setup step.
  const card = page.locator("#jsearch-key");
  await expect(card).toContainText("More jobs you can apply to by email (optional)");
  await expect(page.getByLabel("RapidAPI key")).toHaveCount(0);
  await card.getByTestId("jsearch-add-key").click();
  for (const id of ["jsearch-open-pricing", "jsearch-open-playground"]) {
    await expect(card.getByTestId(id)).toHaveAttribute("target", "_blank");
    await expect(card.getByTestId(id)).toHaveAttribute("href", /^https:\/\/rapidapi\.com\/letscrape-6bRBa3QguO5\/api\/jsearch\//);
  }
  await expect(card).toContainText("find X-RapidAPI-Key and copy the long value next to it");
  await expectNoHorizontalOverflow(page);
  await card.screenshot({ path: testInfo.outputPath("jsearch-steps.png") });

  // A key that isn't subscribed yet (the demo server treats "notsubscribed" keys that way): kept, with the one step left.
  await card.getByLabel("RapidAPI key").fill("'x-rapidapi-key': 'e2e-notsubscribed-0123456789abcdef',");
  await card.getByRole("button", { name: "Save key" }).click();
  await expect(card.getByTestId("jsearch-not-subscribed")).toContainText("One step left: subscribe to the free plan");
  await expect(card.getByTestId("jsearch-not-subscribed")).toContainText("…cdef");
  await card.getByRole("button", { name: "I've subscribed, check again" }).click();
  await expect(page.getByText("Still not subscribed.")).toBeVisible();
  await card.getByRole("button", { name: "Remove" }).click();
  await confirmWith(page, "Remove key");

  // A working key: only its last 4 characters are shown, with this month's searches.
  await card.getByTestId("jsearch-add-key").click();
  await card.getByLabel("RapidAPI key").fill("e2e-working-key-0123456789abcdefWXYZ");
  await card.getByRole("button", { name: "Save key" }).click();
  await expect(card.getByTestId("jsearch-key-status")).toContainText("Your key ending in …WXYZ works.");
  await expect(card.getByTestId("jsearch-key-status")).toContainText("1 of 200 searches used this month");
  await expect(card).not.toContainText("e2e-working-key-0123456789abcdefWXYZ");
  await expectNoHorizontalOverflow(page);
  await card.screenshot({ path: testInfo.outputPath("jsearch-saved.png") });
});

/** The real server command, against the e2e test database (the only way to make an admin). */
function grantAdmin(email: string) {
  return execFileSync("npx", ["tsx", "src/cli/admin.ts", "grant", email], {
    cwd: path.resolve(__dirname, "../../server"),
    env: { ...process.env, DB_NAME: "jobdraft_test", NODE_ENV: "test", MOCK_EXTERNAL: "true" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

test("admin: granted only from the server, sees users, deactivates, uses JobDraft as a user, creates and deletes accounts", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const isMobile = testInfo.project.name.startsWith("mobile");
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  // A normal user, in their own browser session.
  const userEmail = `e2e-member-${stamp}@example.org`;
  const member = await pwRequest.newContext();
  expect((await member.post(`${API}/api/auth/register`, { data: { name: "Meera Rao", email: userEmail, password: "member-pass-1", geminiKey: GEMINI_KEY } })).status()).toBe(201);

  // The admin registers like anyone else; nothing on the website makes them admin.
  const adminEmail = `e2e-admin-${stamp}@example.org`;
  await register(page, adminEmail);
  await page.goto("/admin");
  await expect(page.getByText("This page is for JobDraft admins.")).toBeVisible();
  expect(grantAdmin(adminEmail)).toContain("is now an admin");
  await page.reload();
  await expect(page.getByTestId("admin-totals")).toBeVisible();
  const nav = isMobile ? page.getByTestId("bottom-nav") : page.locator("header nav");
  await expect(nav.getByRole("link", { name: "Admin" })).toBeVisible();

  // Find the user.
  await page.getByLabel("Search users").fill("Meera");
  const row = page.getByTestId("admin-user").filter({ hasText: userEmail });
  await expect(row).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("admin.png"), fullPage: true });

  // Deactivate: they can't log in and are told to ask the admin. Then activate again.
  await row.getByRole("button", { name: "Deactivate Meera Rao" }).click();
  await confirmWith(page, "Deactivate");
  await expect(row).toContainText("Inactive");
  const blocked = await member.get(`${API}/api/auth/me`);
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error).toBe("This account is inactive. Please ask the JobDraft admin to activate it.");
  await row.getByRole("button", { name: "Activate Meera Rao" }).click();
  await confirmWith(page, "Activate");
  await expect(row).not.toContainText("Inactive");
  expect((await member.get(`${API}/api/auth/me`)).status()).toBe(200);

  // Use JobDraft as them, then return to admin.
  await row.getByRole("button", { name: "Use JobDraft as Meera Rao" }).click();
  await confirmWith(page, "Use as this user");
  const banner = page.getByTestId("acting-banner");
  await expect(banner).toContainText("You're using JobDraft as Meera Rao");
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("acting.png") });
  await banner.getByRole("button", { name: "Return to admin" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByTestId("admin-totals")).toBeVisible();

  // Create an account on someone's behalf, then delete it.
  const newEmail = `e2e-created-${stamp}@example.org`;
  await page.getByRole("button", { name: "Create user" }).click();
  const form = page.getByTestId("create-user-form");
  await form.getByLabel("Name").fill("Kiran Das");
  await form.getByLabel("Email").fill(newEmail);
  await form.getByLabel("Password", { exact: true }).fill("kiran-pass-1");
  await form.getByLabel("Their Gemini API key").fill(GEMINI_KEY);
  await form.getByRole("button", { name: "Create account" }).click();
  await confirmWith(page, "Create account");
  await page.getByLabel("Search users").fill("Kiran");
  const created = page.getByTestId("admin-user").filter({ hasText: newEmail });
  await expect(created).toHaveCount(1);
  await created.getByRole("button", { name: "Delete Kiran Das" }).click();
  await confirmWith(page, "Delete permanently");
  await expect(created).toHaveCount(0);
  await expect(page.getByTestId("admin-audit")).toContainText("Deleted account");
  await member.dispose();
});

test("sign-up approval: the account waits, the admin adds the email to Google test users and approves, then they can log in", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const adminEmail = `e2e-approver-${stamp}@example.org`;
  await register(page, adminEmail);
  grantAdmin(adminEmail);
  await page.goto("/admin");
  const card = page.locator("#approvals");
  const sw = card.getByRole("switch", { name: "New sign-ups need approval" });
  await expect(sw).toHaveAttribute("aria-checked", "false"); // off on this test server
  await sw.click();
  await confirmWith(page, "Require approval");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  try {
    // A friend signs up in their own browser: told to wait, can't log in yet.
    const friendEmail = `e2e-friend-${stamp}@example.org`;
    const friendCtx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const friend = await friendCtx.newPage();
    await friend.goto("/register");
    await friend.getByLabel("Name").fill("Asha Friend");
    await friend.getByLabel("Email").fill(friendEmail);
    await friend.getByLabel("Password", { exact: true }).fill("friend-pass-1");
    await friend.getByLabel("Gemini API key").fill(GEMINI_KEY);
    await friend.getByRole("button", { name: "Create account" }).click();
    await confirmWith(friend, "Create account");
    await expect(friend.getByTestId("pending-approval")).toContainText("The JobDraft admin needs to approve it before you can log in.");
    await friend.screenshot({ path: testInfo.outputPath("pending.png") });
    await friend.goto("/login");
    await friend.getByLabel("Email").fill(friendEmail);
    await friend.getByLabel("Password", { exact: true }).fill("friend-pass-1");
    await friend.getByRole("button", { name: "Log in" }).click();
    await expect(friend.getByText(/waiting for the admin's approval/)).toBeVisible();

    // The admin sees them waiting, with the Google test-users page one click away.
    await page.reload();
    const row = page.getByTestId("pending-user").filter({ hasText: friendEmail });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("google-test-users")).toHaveAttribute("href", /^https:\/\/console\.cloud\.google\.com\/auth\/audience/);
    await expect(row.getByTestId("google-test-users")).toHaveAttribute("target", "_blank");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("approvals.png"), fullPage: true });
    await row.getByRole("button", { name: "Approve Asha Friend" }).click();
    await confirmWith(page, "Approve");
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("admin-user").filter({ hasText: friendEmail })).toContainText("Asha Friend");

    // Now the friend can log in.
    await friend.getByRole("button", { name: "Log in" }).click();
    await expect(friend).toHaveURL(/\/(dashboard|setup)/);
    await friendCtx.close();
  } finally {
    // Leave the shared test server as it was.
    await page.request.put(`${API}/api/admin/settings`, { data: { signupApproval: false } });
  }
});

test("touch targets in the bottom nav are at least 44px", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile only");
  await register(page, `tap-${Date.now()}@example.org`);
  for (const link of await page.getByTestId("bottom-nav").getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
});
