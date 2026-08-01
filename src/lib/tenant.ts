export const SHOW_TENANT_SELECTOR =
  process.env.NEXT_PUBLIC_ENV === "development";

export function getTenantCode(): string {
  if (typeof window === "undefined") {
    return "";
  }

  if (SHOW_TENANT_SELECTOR) {
    return "";
  }

  const host = window.location.hostname;

  const parts = host.split(".");

  if (parts.length <= 2) {
    return parts[0];
  }

  return parts[0];
}
