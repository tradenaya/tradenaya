const IST = "Asia/Kolkata";

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function formatTimeIst(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)).toUpperCase();
}

/** "Today", "Tomorrow", "Yesterday" or "Sat, 18 Oct" — in IST. */
export function formatDayIst(value: string | Date, now = new Date()): string {
  const d = new Date(value);
  const key = dayKey(d);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(new Date(now.getTime() + 86400000))) return "Tomorrow";
  if (key === dayKey(new Date(now.getTime() - 86400000))) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" }).format(d);
}

export const formatDateTimeIst = (value: string | Date) => `${formatDayIst(value)}, ${formatTimeIst(value)} IST`;

export function formatDateIst(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

/** "09:30" (24h) → "9:30 AM" */
export function formatRunTime(hhmm: string): string {
  const [h = 9, m = 0] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export const TRIGGER_LABEL: Record<string, string> = { scheduled: "Scheduled", manual: "Run now" };

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function formatYears(years: number): string {
  if (years < 1) return years === 0 ? "No full-time experience" : `${Math.round(years * 12)} months`;
  return `${years.toFixed(1).replace(/\.0$/, "")} years`;
}

/** "in 12 min", "in 1 h 5 min", "now" */
export function countdown(to: string | Date, now: number): string {
  const ms = new Date(to).getTime() - now;
  if (ms <= 30_000) return "sending now";
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  return `in ${h} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
}
