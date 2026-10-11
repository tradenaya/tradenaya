/**
 * Tag a USDT price or amount inside a user-facing log / activity message.
 *
 * Every figure written this way reads "<number> USDT", which is what the
 * client's `localizeUsdtText` recognises and converts when the user switches
 * the display currency to INR. Keep the number's formatting (toFixed etc.) at
 * the call site; this only appends the unit.
 */
export function usdt(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  return `${value} USDT`;
}
