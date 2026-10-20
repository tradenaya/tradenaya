import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const RESUME = path.join(__dirname, "fixtures", "resume.pdf");
const API = "http://localhost:5056";

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
  await page.getByRole("button", { expanded: false }).filter({ hasText: "Run now" }).first().click();
  const apps = page.getByTestId("application-item");
  await expect(apps.first()).toBeVisible();
  await expect(page.getByTestId("link-item").first()).toBeVisible();
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

  // Reading animation (the mock AI is instant, so hold the response for a few seconds).
  await page.route("**/api/profile/resume", async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await page.locator("#resume-file").setInputFiles(RESUME);
  await confirmWith(page, "Upload resume");
  const reading = page.getByTestId("resume-reading");
  await expect(reading).toBeVisible();
  await expect(reading).toContainText("Reading your resume");
  await expect(reading).toContainText("Usually takes 10–30 seconds");
  await expect(reading.getByText("Reading your experience and skills")).toBeVisible();
  await page.waitForTimeout(5200);
  await page.screenshot({ path: testInfo.outputPath("reading.png") });
  await expect(reading).toBeHidden({ timeout: 30_000 });
  await page.unroute("**/api/profile/resume");
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
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmWith(page, "Create account");
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.locator('label[for="resume-file"]')).toContainText("Upload resume (PDF)");
  await expect(page.getByRole("navigation", { name: "Setup progress" })).toContainText("current step");
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
