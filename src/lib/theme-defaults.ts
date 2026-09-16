export const ADMIN_DEFAULTS = {
  lightPrimary: "#c99a58",
  lightSecondary: "#a89880",
  lightAccent: "#dfb978",
  lightSidebar: "#0a0907",
  lightBackground: "#f5f4f0",
  lightSurface: "#faf8f4",
  lightText: "#1a1510",
  // primary will be a warm gold/bronze shade matching the landing page
  darkPrimary: "#c99a58",
  darkSecondary: "#a89880",
  darkAccent: "#dfb978",
  darkSidebar: "#070605",
  darkBackground: "#070605",
  // cards / surfaces: warm dark brown
  darkSurface: "#0a0907",
  darkText: "#eee5d8",
};

export const CUSTOMER_DEFAULTS = {
  lightPrimary: "#c99a58",
  lightSecondary: "#a89880",
  lightAccent: "#dfb978",
  lightBackground: "#f5f4f0",
  lightSurface: "#faf8f4",
  lightText: "#1a1510",
  darkPrimary: "#c99a58",
  darkSecondary: "#a89880",
  darkAccent: "#dfb978",
  darkBackground: "#070605",
  darkSurface: "#0a0907",
  darkText: "#eee5d8",
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