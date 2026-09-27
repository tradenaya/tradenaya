/**
 * Helpers for the 24-hour expiry time field.
 *
 * Kept in a plain .ts module (rather than inside the .tsx picker) so the rules
 * are unit-testable: the picker normalises what you type, and the page refuses
 * to send anything the server would reject.
 */

/** Strict 24-hour "HH:mm", 00:00-23:59. */
const TIME_LITERAL = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Strict "YYYY-MM-DDTHH:mm" datetime-local literal. */
const DATETIME_LITERAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

function clamp(n: number, max: number): number {
  return Math.min(max, Math.max(0, n));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** True when "HH:mm" is a real 24-hour time the server will accept. */
export function isValidTimeLiteral(value: string): boolean {
  return TIME_LITERAL.test(value);
}

/** True when "YYYY-MM-DDTHH:mm" is a real datetime-local literal. */
export function isValidDatetimeLiteral(value: string): boolean {
  return DATETIME_LITERAL.test(value);
}

/**
 * Turn whatever the user typed into a canonical, clamped value.
 *
 * Digits are the source of truth so both "2054" and "20:54" give "20:54".
 * The result is only a complete "HH:mm" once three or more digits are present;
 * shorter input stays partial so the field can still be typed into. Hours are
 * clamped to 23 and minutes to 59, so the field can never settle on a value the
 * save request would reject.
 */
export function normalizeTimeInput(raw: string): string {
  // An explicit colon is authoritative, so "6:07" stays 06:07 rather than
  // being read as the digit stream "607" (which would mean 23:07 once clamped).
  if (raw.includes(":")) {
    const [hRaw = "", mRaw = ""] = raw.split(":");
    const hours = pad(clamp(Number(hRaw.replace(/\D/g, "")) || 0, 23));
    const minuteDigits = mRaw.replace(/\D/g, "").slice(0, 2);
    if (!minuteDigits) return `${hours}:`;
    return `${hours}:${pad(clamp(Number(minuteDigits), 59))}`;
  }

  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";
  if (digits.length <= 2) return pad(clamp(Number(digits), 23));

  const hours = pad(clamp(Number(digits.slice(0, 2)), 23));
  const minutes = pad(clamp(Number(digits.slice(2)), 59));
  return `${hours}:${minutes}`;
}

/**
 * Combine a picked calendar day and an "HH:mm" time into the exact
 * datetime-local literal to send, or null when either side is unusable.
 * Components are copied verbatim — no timezone conversion happens here.
 */
export function buildExpiryLiteral(date: Date | null, time: string): string | null {
  if (!date || Number.isNaN(date.getTime()) || !isValidTimeLiteral(time)) return null;
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `${y}-${mo}-${d}T${time}`;
}
