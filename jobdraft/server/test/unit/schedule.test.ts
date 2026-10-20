import { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";
import { followUpDueAt, isRunDue, istDate, nextRunAt, nextWeekdayWindow, type NextRunInput } from "../../src/lib/time.js";

/** An instant given as IST wall-clock time. */
const ist = (s: string) => DateTime.fromISO(s, { zone: "Asia/Kolkata" }).toJSDate();
const fmt = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: "Asia/Kolkata" }).toFormat("yyyy-MM-dd HH:mm") : null);

const base = (over: Partial<NextRunInput>): NextRunInput => ({
  now: ist("2026-10-20T07:00"),
  runTime: null,
  automationEnabled: true,
  ranToday: false,
  settingsChangedAt: ist("2026-10-01T12:00"),
  ...over,
});

const originalTz = process.env.TZ;
afterAll(() => {
  process.env.TZ = originalTz;
});

describe("next run (shared by the scheduler and the UI)", () => {
  it("defaults to 9:00 AM IST", () => {
    expect(fmt(nextRunAt(base({})))).toBe("2026-10-20 09:00");
  });

  it("before the run time → today; after it → still today (catch-up) within 3 hours; later → tomorrow", () => {
    expect(fmt(nextRunAt(base({ now: ist("2026-10-20T08:59") })))).toBe("2026-10-20 09:00");
    expect(isRunDue(base({ now: ist("2026-10-20T08:59") }))).toBe(false);
    expect(isRunDue(base({ now: ist("2026-10-20T09:00") }))).toBe(true);
    expect(isRunDue(base({ now: ist("2026-10-20T11:59") }))).toBe(true); // missed run, server back within 3 h
    expect(isRunDue(base({ now: ist("2026-10-20T12:00") }))).toBe(false); // 3 h later: skipped silently
    expect(fmt(nextRunAt(base({ now: ist("2026-10-20T12:00") })))).toBe("2026-10-21 09:00");
  });

  it("today's run already done → tomorrow", () => {
    expect(fmt(nextRunAt(base({ now: ist("2026-10-20T09:30"), ranToday: true })))).toBe("2026-10-21 09:00");
    expect(fmt(nextRunAt(base({ now: ist("2026-10-20T07:00"), ranToday: true })))).toBe("2026-10-21 09:00");
  });

  it("time changed to later today → today; to earlier than now → tomorrow (never immediately)", () => {
    const now = ist("2026-10-20T10:00");
    expect(fmt(nextRunAt(base({ now, runTime: "14:00", settingsChangedAt: now })))).toBe("2026-10-20 14:00");
    expect(fmt(nextRunAt(base({ now, runTime: "09:30", settingsChangedAt: now })))).toBe("2026-10-21 09:30");
    expect(isRunDue(base({ now, runTime: "09:30", settingsChangedAt: now }))).toBe(false);
  });

  it("changing the time after today's run doesn't create a second run today", () => {
    const now = ist("2026-10-20T10:00");
    expect(fmt(nextRunAt(base({ now, runTime: "15:00", ranToday: true, settingsChangedAt: now })))).toBe("2026-10-21 15:00");
  });

  it("turning automation ON never triggers an immediate run", () => {
    const at10 = ist("2026-10-20T10:00");
    expect(isRunDue(base({ now: at10, settingsChangedAt: at10 }))).toBe(false);
    expect(fmt(nextRunAt(base({ now: at10, settingsChangedAt: at10 })))).toBe("2026-10-21 09:00");
    const at8 = ist("2026-10-20T08:00");
    expect(fmt(nextRunAt(base({ now: at8, settingsChangedAt: at8 })))).toBe("2026-10-20 09:00");
  });

  it("automation off → no next run", () => {
    expect(nextRunAt(base({ automationEnabled: false }))).toBeNull();
  });

  it("handles late-evening run times around midnight", () => {
    expect(isRunDue(base({ runTime: "23:45", now: ist("2026-10-20T23:50") }))).toBe(true);
    // At 00:30 the next day, yesterday's slot is gone; today's 23:45 is next.
    expect(fmt(nextRunAt(base({ runTime: "23:45", now: ist("2026-10-21T00:30") })))).toBe("2026-10-21 23:45");
  });

  it.each(["UTC", "America/New_York", "Pacific/Kiritimati", "Asia/Kolkata", "Europe/London"])("is correct in IST when the process timezone is %s", (tz) => {
    process.env.TZ = tz;
    expect(new Date(2026, 0, 1).getTimezoneOffset() + 0).toBe(-DateTime.fromObject({ year: 2026, month: 1, day: 1 }, { zone: tz }).offset + 0);
    expect(istDate(ist("2026-10-20T23:50"))).toBe("2026-10-20");
    expect(istDate(ist("2026-10-21T00:10"))).toBe("2026-10-21");
    expect(nextRunAt(base({ now: ist("2026-10-20T07:00") }))!.toISOString()).toBe("2026-10-20T03:30:00.000Z");
    expect(nextRunAt(base({ now: ist("2026-10-20T07:00"), runTime: "18:15" }))!.toISOString()).toBe("2026-10-20T12:45:00.000Z");
    expect(isRunDue(base({ now: new Date("2026-10-20T03:30:00Z") }))).toBe(true);
  });
});

describe("follow-up timing", () => {
  const wd = (d: Date) => DateTime.fromJSDate(d, { zone: "Asia/Kolkata" });

  it("is 7 days after sending, on a weekday, between 10:00 and 11:30 IST", () => {
    for (const sent of ["2026-10-19T15:00", "2026-10-23T09:00", "2026-10-24T11:00", "2026-10-25T23:30", "2026-10-21T10:45"]) {
      for (const r of [0, 0.5, 0.999]) {
        const sentAt = ist(sent);
        const due = followUpDueAt(sentAt, () => r);
        const d = wd(due);
        expect(d.weekday, sent).toBeLessThanOrEqual(5);
        const minutes = d.hour * 60 + d.minute;
        expect(minutes).toBeGreaterThanOrEqual(600);
        expect(minutes).toBeLessThanOrEqual(690);
        expect(due.getTime() - sentAt.getTime()).toBeGreaterThanOrEqual(7 * 86400000);
      }
    }
  });

  it("moves weekend due dates to Monday and late-day ones to the next weekday", () => {
    expect(fmt(followUpDueAt(ist("2026-10-24T09:00"), () => 0))).toBe("2026-11-02 10:00"); // Sat → Sat+7 → Mon
    expect(fmt(followUpDueAt(ist("2026-10-19T15:00"), () => 0))).toBe("2026-10-27 10:00"); // Mon 15:00 → next Mon after 11:30 → Tue
    expect(fmt(followUpDueAt(ist("2026-10-23T09:00"), () => 0))).toBe("2026-10-30 10:00"); // Fri 09:00 → Fri window
  });

  it("follow-up 2 is 7 days after follow-up 1 was sent", () => {
    const fu1Sent = ist("2026-10-27T10:20");
    expect(fmt(followUpDueAt(fu1Sent, () => 0))).toBe("2026-11-03 10:20");
  });

  it("never schedules inside the window earlier than allowed", () => {
    expect(fmt(nextWeekdayWindow(ist("2026-10-20T10:40"), () => 0))).toBe("2026-10-20 10:40");
    expect(fmt(nextWeekdayWindow(ist("2026-10-20T11:31"), () => 0))).toBe("2026-10-21 10:00");
  });
});
