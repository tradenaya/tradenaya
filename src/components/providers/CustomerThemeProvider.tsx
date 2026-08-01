"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setColorMode } from "@/store/slices/customerThemeSlice";
import { CUSTOMER_DEFAULTS } from "@/lib/theme-defaults";

export function applyThemeToDOM(
  theme: {
    lightPrimary: string;
    lightSecondary: string;
    lightAccent: string;
    lightBackground: string;
    lightSurface: string;
    lightText: string;
    darkPrimary: string;
    darkSecondary: string;
    darkAccent: string;
    darkBackground: string;
    darkSurface: string;
    darkText: string;
  } | null,
  mode: "light" | "dark" = "light"
) {
  const root = document.documentElement;
  const isDark = mode === "dark";

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  const c = isDark ? (theme ? {
    primary: theme.darkPrimary || CUSTOMER_DEFAULTS.darkPrimary,
    secondary: theme.darkSecondary || CUSTOMER_DEFAULTS.darkSecondary,
    accent: theme.darkAccent || CUSTOMER_DEFAULTS.darkAccent,
    background: theme.darkBackground || CUSTOMER_DEFAULTS.darkBackground,
    surface: theme.darkSurface || CUSTOMER_DEFAULTS.darkSurface,
    text: theme.darkText || CUSTOMER_DEFAULTS.darkText,
  } : {
    primary: CUSTOMER_DEFAULTS.darkPrimary,
    secondary: CUSTOMER_DEFAULTS.darkSecondary,
    accent: CUSTOMER_DEFAULTS.darkAccent,
    background: CUSTOMER_DEFAULTS.darkBackground,
    surface: CUSTOMER_DEFAULTS.darkSurface,
    text: CUSTOMER_DEFAULTS.darkText,
  }) : (theme ? {
    primary: theme.lightPrimary || CUSTOMER_DEFAULTS.lightPrimary,
    secondary: theme.lightSecondary || CUSTOMER_DEFAULTS.lightSecondary,
    accent: theme.lightAccent || CUSTOMER_DEFAULTS.lightAccent,
    background: theme.lightBackground || CUSTOMER_DEFAULTS.lightBackground,
    surface: theme.lightSurface || CUSTOMER_DEFAULTS.lightSurface,
    text: theme.lightText || CUSTOMER_DEFAULTS.lightText,
  } : {
    primary: CUSTOMER_DEFAULTS.lightPrimary,
    secondary: CUSTOMER_DEFAULTS.lightSecondary,
    accent: CUSTOMER_DEFAULTS.lightAccent,
    background: CUSTOMER_DEFAULTS.lightBackground,
    surface: CUSTOMER_DEFAULTS.lightSurface,
    text: CUSTOMER_DEFAULTS.lightText,
  });

  root.style.setProperty("--primary", c.primary);
  root.style.setProperty("--secondary", c.secondary);
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--background", c.background);
  root.style.setProperty("--foreground", c.text);
  root.style.setProperty("--card", c.surface);
  root.style.setProperty("--card-foreground", c.text);
  root.style.setProperty("--popover", c.surface);
  root.style.setProperty("--popover-foreground", c.text);
  root.style.setProperty("--border", c.secondary);
  root.style.setProperty("--input", c.secondary);
  root.style.setProperty("--ring", c.primary);
  root.style.setProperty("--muted", c.surface);
  root.style.setProperty("--muted-foreground", c.text);
}

function isAdminRoute(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname === "/admin-signin";
}

function initColorMode(
  defaultMode: string,
  dispatch: ReturnType<typeof useAppDispatch>
): () => void {
  let mediaQuery: MediaQueryList | null = null;
  let cleanup: (() => void) | undefined;

  function resolve() {
    if (defaultMode === "D") {
      dispatch(setColorMode("dark"));
      localStorage.setItem("customer-color-mode", "dark");
    } else if (defaultMode === "L") {
      dispatch(setColorMode("light"));
      localStorage.setItem("customer-color-mode", "light");
    } else {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const initial: "light" | "dark" = mediaQuery.matches ? "dark" : "light";
      dispatch(setColorMode(initial));
      localStorage.setItem("customer-color-mode", initial);

      const handler = (e: MediaQueryListEvent) => {
        const newMode: "light" | "dark" = e.matches ? "dark" : "light";
        dispatch(setColorMode(newMode));
        localStorage.setItem("customer-color-mode", newMode);
      };
      mediaQuery.addEventListener("change", handler);
      cleanup = () => mediaQuery?.removeEventListener("change", handler);
    }
  }

  resolve();
  return () => cleanup?.();
}

export default function CustomerThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useAppSelector((state) => state.customerTheme);
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const onCustomer = !isAdminRoute(pathname);

  useEffect(() => {
    if (!onCustomer) return;
    const saved = localStorage.getItem("customer-color-mode") as "light" | "dark" | null;
    if (saved) {
      dispatch(setColorMode(saved));
    } else {
      const cleanup = initColorMode(theme.defaultMode, dispatch);
      return cleanup;
    }
  }, [theme.defaultMode, onCustomer, dispatch]);

  useEffect(() => {
    if (!onCustomer) return;
    applyThemeToDOM(theme, theme.colorMode);
  }, [theme, onCustomer, pathname]);

  return <>{children}</>;
}
