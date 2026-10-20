// The single source of "now" for scheduling, sending and follow-ups, so tests
// can run days of cron activity with a fake clock.
let fixed: number | null = null;

export const clock = {
  now(): Date {
    return new Date(fixed ?? Date.now());
  },
  /** Tests only: freeze time at this instant. */
  set(at: Date | string | number) {
    fixed = new Date(at).getTime();
  },
  /** Tests only: move the frozen clock forward. */
  advance(ms: number) {
    fixed = (fixed ?? Date.now()) + ms;
  },
  reset() {
    fixed = null;
  },
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
