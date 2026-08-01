"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setColorMode } from "@/store/slices/adminThemeSlice";
import { ADMIN_DEFAULTS } from "@/lib/theme-defaults";

export function applyAdminThemeToDOM(
  theme: {
    lightPrimary: string;
    lightSecondary: string;
    lightAccent: string;
    lightSidebar: string;
    lightBackground: string;
    lightSurface: string;
    lightText: string;
    darkPrimary: string;
    darkSecondary: string;
    darkAccent: string;
    darkSidebar: string;
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

  const d = isDark ? (theme ? {
    primary: theme.darkPrimary || ADMIN_DEFAULTS.darkPrimary,
    secondary: theme.darkSecondary || ADMIN_DEFAULTS.darkSecondary,
    accent: theme.darkAccent || ADMIN_DEFAULTS.darkAccent,
    sidebar: theme.darkSidebar || ADMIN_DEFAULTS.darkSidebar,
    background: theme.darkBackground || ADMIN_DEFAULTS.darkBackground,
    surface: theme.darkSurface || ADMIN_DEFAULTS.darkSurface,
    text: theme.darkText || ADMIN_DEFAULTS.darkText,
  } : {
    primary: ADMIN_DEFAULTS.darkPrimary,
    secondary: ADMIN_DEFAULTS.darkSecondary,
    accent: ADMIN_DEFAULTS.darkAccent,
    sidebar: ADMIN_DEFAULTS.darkSidebar,
    background: ADMIN_DEFAULTS.darkBackground,
    surface: ADMIN_DEFAULTS.darkSurface,
    text: ADMIN_DEFAULTS.darkText,
  }) : (theme ? {
    primary: theme.lightPrimary || ADMIN_DEFAULTS.lightPrimary,
    secondary: theme.lightSecondary || ADMIN_DEFAULTS.lightSecondary,
    accent: theme.lightAccent || ADMIN_DEFAULTS.lightAccent,
    sidebar: theme.lightSidebar || ADMIN_DEFAULTS.lightSidebar,
    background: theme.lightBackground || ADMIN_DEFAULTS.lightBackground,
    surface: theme.lightSurface || ADMIN_DEFAULTS.lightSurface,
    text: theme.lightText || ADMIN_DEFAULTS.lightText,
  } : {
    primary: ADMIN_DEFAULTS.lightPrimary,
    secondary: ADMIN_DEFAULTS.lightSecondary,
    accent: ADMIN_DEFAULTS.lightAccent,
    sidebar: ADMIN_DEFAULTS.lightSidebar,
    background: ADMIN_DEFAULTS.lightBackground,
    surface: ADMIN_DEFAULTS.lightSurface,
    text: ADMIN_DEFAULTS.lightText,
  });

  root.style.setProperty("--admin-primary", d.primary);
  root.style.setProperty("--admin-secondary", d.secondary);
  root.style.setProperty("--admin-accent", d.accent);
  root.style.setProperty("--admin-sidebar", d.sidebar);
  root.style.setProperty("--admin-background", d.background);
  root.style.setProperty("--admin-surface", d.surface);
  root.style.setProperty("--admin-foreground", d.text);
}

function applyAdminBaseVars(root: HTMLElement, theme: any, mode: "light" | "dark") {
  const isDark = mode === "dark";
  const d = isDark ? {
    primary: theme.darkPrimary || ADMIN_DEFAULTS.darkPrimary,
    secondary: theme.darkSecondary || ADMIN_DEFAULTS.darkSecondary,
    accent: theme.darkAccent || ADMIN_DEFAULTS.darkAccent,
    sidebar: theme.darkSidebar || ADMIN_DEFAULTS.darkSidebar,
    background: theme.darkBackground || ADMIN_DEFAULTS.darkBackground,
    surface: theme.darkSurface || ADMIN_DEFAULTS.darkSurface,
    text: theme.darkText || ADMIN_DEFAULTS.darkText,
  } : {
    primary: theme.lightPrimary || ADMIN_DEFAULTS.lightPrimary,
    secondary: theme.lightSecondary || ADMIN_DEFAULTS.lightSecondary,
    accent: theme.lightAccent || ADMIN_DEFAULTS.lightAccent,
    sidebar: theme.lightSidebar || ADMIN_DEFAULTS.lightSidebar,
    background: theme.lightBackground || ADMIN_DEFAULTS.lightBackground,
    surface: theme.lightSurface || ADMIN_DEFAULTS.lightSurface,
    text: theme.lightText || ADMIN_DEFAULTS.lightText,
  };

  root.style.setProperty("--primary", d.primary);
  root.style.setProperty("--secondary", d.secondary);
  root.style.setProperty("--accent", d.accent);
  root.style.setProperty("--background", d.background);
  root.style.setProperty("--foreground", d.text);
  root.style.setProperty("--card", d.surface);
  root.style.setProperty("--card-foreground", d.text);
  root.style.setProperty("--popover", d.surface);
  root.style.setProperty("--popover-foreground", d.text);
  root.style.setProperty("--border", d.secondary);
  root.style.setProperty("--input", d.secondary);
  root.style.setProperty("--ring", d.primary);
  root.style.setProperty("--muted", d.surface);
  root.style.setProperty("--muted-foreground", d.text);
  root.style.setProperty("--sidebar", d.sidebar);
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
      localStorage.setItem("admin-color-mode", "dark");
    } else if (defaultMode === "L") {
      dispatch(setColorMode("light"));
      localStorage.setItem("admin-color-mode", "light");
    } else {
      // System mode
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const initial: "light" | "dark" = mediaQuery.matches ? "dark" : "light";
      dispatch(setColorMode(initial));
      localStorage.setItem("admin-color-mode", initial);

      const handler = (e: MediaQueryListEvent) => {
        const newMode: "light" | "dark" = e.matches ? "dark" : "light";
        dispatch(setColorMode(newMode));
        localStorage.setItem("admin-color-mode", newMode);
      };
      mediaQuery.addEventListener("change", handler);
      cleanup = () => mediaQuery?.removeEventListener("change", handler);
    }
  }

  resolve();
  return () => cleanup?.();
}

export default function AdminThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useAppSelector((state) => state.adminTheme);
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const onAdmin = pathname.startsWith("/admin") || pathname === "/admin-signin";

  useEffect(() => {
    // Check localStorage first for a saved preference
    const saved = localStorage.getItem("admin-color-mode") as "light" | "dark" | null;
    if (saved) {
      dispatch(setColorMode(saved));
    } else {
      const cleanup = initColorMode(theme.defaultMode, dispatch);
      return cleanup;
    }
  }, [theme.defaultMode, dispatch]);

  useEffect(() => {
    const root = document.documentElement;
    applyAdminThemeToDOM(theme, theme.colorMode);

    if (onAdmin) {
      applyAdminBaseVars(root, theme, theme.colorMode);
    }
  }, [theme, onAdmin, pathname]);

  return <>{children}</>;
}
