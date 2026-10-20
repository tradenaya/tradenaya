// All scheduling happens in India time (Asia/Kolkata), whatever the server's own
// timezone is. Luxon does the zone maths; nothing here uses local time.
import { DateTime } from "luxon";
import { HOUR } from "./clock.js";

export const IST_TZ = "Asia/Kolkata";
export const DEFAULT_RUN_TIME = "09:00";
/** A missed run still happens if the server is back within this long. */
export const CATCH_UP_HOURS = 3;

const ist = (d: Date) => DateTime.fromJSDate(d, { zone: IST_TZ });

/** "YYYY-MM-DD" in IST. */
export function istDate(now: Date): string {
  return ist(now).toFormat("yyyy-MM-dd");
}

export function isWeekendIst(now: Date): boolean {
  return ist(now).weekday >= 6;
}

/** "9:00", "09:00", "09:00:00" → { hour, minute }. Invalid → 09:00. */
export function parseRunTime(value: string | null | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value ?? "");
  if (!m) return { hour: 9, minute: 0 };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return { hour: 9, minute: 0 };
  return { hour, minute };
}

/** "HH:MM" (24h) */
export function normalizeRunTime(value: string | null | undefined): string {
  const { hour, minute } = parseRunTime(value);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The UTC instant of `runTime` IST on the IST calendar date `date`. */
export function istInstant(date: string, runTime: string): Date {
  const { hour, minute } = parseRunTime(runTime);
  return DateTime.fromISO(date, { zone: IST_TZ }).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

export interface NextRunInput {
  now: Date;
  runTime: string | null;
  automationEnabled: boolean;
  /** A scheduled run already exists for today's IST date. */
  ranToday: boolean;
  /** Latest of run_time_changed_at / automation_changed_at. */
  settingsChangedAt: Date | null;
}

/**
 * When this user's next scheduled run happens — used by BOTH the scheduler
 * (due = nextRun ≤ now) and the UI hint, so they always agree.
 *
 * Today's slot counts only if no scheduled run happened today, the slot was
 * set up before it came round (changing the time or turning automation on
 * never triggers an immediate run), and it is less than 3 hours old (missed
 * runs are caught up once, then skipped). Otherwise: tomorrow at run time.
 */
export function nextRunAt(input: NextRunInput): Date | null {
  if (!input.automationEnabled) return null;
  const runTime = input.runTime ?? DEFAULT_RUN_TIME;
  const today = istDate(input.now);
  const todayAt = istInstant(today, runTime);
  const setUpBeforeSlot = !input.settingsChangedAt || input.settingsChangedAt.getTime() < todayAt.getTime();
  const notTooLate = input.now.getTime() < todayAt.getTime() + CATCH_UP_HOURS * HOUR;
  if (!input.ranToday && setUpBeforeSlot && notTooLate) return todayAt;
  const tomorrow = ist(input.now).plus({ days: 1 }).toFormat("yyyy-MM-dd");
  return istInstant(tomorrow, runTime);
}

export function isRunDue(input: NextRunInput): boolean {
  const next = nextRunAt(input);
  return !!next && next.getTime() <= input.now.getTime();
}

/** Business-hours window for follow-ups: a weekday, 10:00–11:30 IST. */
export const FOLLOWUP_WINDOW = { startMinute: 10 * 60, endMinute: 11 * 60 + 30 };

/**
 * The first weekday 10:00–11:30 IST slot at or after `earliest`, at a random
 * minute inside the window. Never earlier than `earliest`.
 */
export function nextWeekdayWindow(earliest: Date, random: () => number = Math.random): Date {
  let day = ist(earliest).startOf("day");
  for (let i = 0; i < 14; i++) {
    if (day.weekday <= 5) {
      const windowEnd = day.plus({ minutes: FOLLOWUP_WINDOW.endMinute });
      if (windowEnd.toMillis() >= earliest.getTime()) {
        const startMin = Math.max(FOLLOWUP_WINDOW.startMinute, Math.ceil((earliest.getTime() - day.toMillis()) / 60_000));
        const span = FOLLOWUP_WINDOW.endMinute - startMin;
        const minute = startMin + Math.floor(random() * (span + 1));
        return day.plus({ minutes: Math.min(minute, FOLLOWUP_WINDOW.endMinute) }).toJSDate();
      }
    }
    day = day.plus({ days: 1 });
  }
  throw new Error("No weekday window found");
}

/** Follow-up due time: 7 days after `sentAt`, moved into the weekday window. */
export function followUpDueAt(sentAt: Date, random: () => number = Math.random): Date {
  return nextWeekdayWindow(new Date(sentAt.getTime() + 7 * 24 * HOUR), random);
}

/** Start of the IST day containing `now`, as a UTC instant. */
export function istDayStart(now: Date): Date {
  return ist(now).startOf("day").toJSDate();
}
