export const ADMIN_DEFAULTS = {
  lightPrimary: "#d1d5db",
  lightSecondary: "#9ca3af",
  lightAccent: "#6b7280",
  lightSidebar: "#111827",
  lightBackground: "#f5f5f5",
  lightSurface: "#f8fafc",
  lightText: "#111827",
  // primary will be a dark gold/bronze shade
  darkPrimary: "#b8860b",
  darkSecondary: "#c1c8d7",
  darkAccent: "#9ca3af",
  darkSidebar: "#090a10",
  darkBackground: "#000000",
  // cards / surfaces: darkest charcoal
  darkSurface: "#0b0d10",
  darkText: "#f8fafc",
};

export const CUSTOMER_DEFAULTS = {
  lightPrimary: "#d1d5db",
  lightSecondary: "#9ca3af",
  lightAccent: "#6b7280",
  lightBackground: "#f5f5f5",
  lightSurface: "#f8fafc",
  lightText: "#111827",
  darkPrimary: "#b8860b",
  darkSecondary: "#c1c8d7",
  darkAccent: "#9ca3af",
  darkBackground: "#000000",
  darkSurface: "#0b0d10",
  darkText: "#f8fafc",
};

function fill<T extends Record<string, unknown>>(
  partial: T,
  defaults: T
): T {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const val = partial[key];
    if (val !== undefined && val !== null && val !== "") {
      result[key] = val;
    }
  }
  return result;
}

export function getDefaultAdminTheme() {
  return {
    allowDarkMode: true,
    defaultMode: "S",
    ...ADMIN_DEFAULTS,
    logoLight: "",
    logoDark: "",
    faviconLight: "",
    faviconDark: "",
    appIconLight: "",
    appIconDark: "",
  };
}

export function getDefaultCustomerTheme() {
  return {
    allowDarkMode: true,
    defaultMode: "S",
    ...CUSTOMER_DEFAULTS,
    logoLight: "",
    logoDark: "",
    faviconLight: "",
    faviconDark: "",
    appIconLight: "",
    appIconDark: "",
    loginBackgroundLight: "",
    loginBackgroundDark: "",
  };
}

export function fillAdminTheme(partial: Record<string, any>) {
  return fill(partial, getDefaultAdminTheme());
}

export function fillCustomerTheme(partial: Record<string, any>) {
  return fill(partial, getDefaultCustomerTheme());
}
