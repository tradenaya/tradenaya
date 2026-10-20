// Total professional experience computed in code from role dates — the model's
// arithmetic is never trusted.

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

const PRESENT_RE = /^(present|current|now|till date|to date|today|ongoing|currently working)$/i;

/** Month index (year*12 + month) or null. A bare year means January of that year. */
export function parseResumeDate(raw: string, now = new Date()): number | null {
  const s = raw.trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  if (PRESENT_RE.test(s)) return now.getUTCFullYear() * 12 + now.getUTCMonth();
  let m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(s); // 2021-03, 2021/3, 2021-03-15
  if (m) return Number(m[1]) * 12 + clampMonth(Number(m[2]) - 1);
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s); // 03/2021
  if (m) return Number(m[2]) * 12 + clampMonth(Number(m[1]) - 1);
  m = /^([a-z]+)\s*'?\s*(\d{2}|\d{4})$/.exec(s); // Mar 2021, March 2021, Mar '21
  if (m && m[1]! in MONTHS) return expandYear(m[2]!) * 12 + MONTHS[m[1]!]!;
  m = /^(\d{4})$/.exec(s); // 2021 — start = January, end = January (conservative)
  if (m) return Number(m[1]) * 12;
  return null;
}

function clampMonth(n: number) {
  return Math.min(11, Math.max(0, n));
}

function expandYear(y: string) {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

export interface DatedRole {
  title: string;
  start: string;
  end: string;
  is_current?: boolean;
}

/**
 * Sum of role durations in years (1 decimal), merging overlapping periods and
 * ignoring internships. A role marked is_current runs to today. A missing end
 * date counts as "present" only for the most recent role (index 0); otherwise
 * the role is skipped.
 */
export function computeExperienceYears(roles: DatedRole[], now = new Date()): number {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans: [number, number][] = [];
  roles.forEach((role, i) => {
    if (/\b(intern|internship|trainee)\b/i.test(role.title)) return;
    const start = parseResumeDate(role.start, now);
    let end = role.is_current ? nowIdx : role.end.trim() ? parseResumeDate(role.end, now) : i === 0 ? nowIdx : null;
    if (start === null || end === null) return;
    end = Math.min(end, nowIdx);
    if (end < start) return;
    // Inclusive months: Jan–Dec of the same year is 12 months.
    spans.push([start, end + 1]);
  });
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of spans) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.round((total / 12) * 10) / 10;
}
