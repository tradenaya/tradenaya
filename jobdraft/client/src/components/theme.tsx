"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { cx } from "./ui";

export type Theme = "light" | "dark";
const STORAGE_KEY = "jobdraft-theme";
const EVENT = "jobdraft-theme-change";

/** Runs in <head> before first paint, so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const getTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

/** Current theme; null during server render (the real value is only known in the browser). */
export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, getTheme, () => null);
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // private mode: the choice just isn't remembered
  }
  window.dispatchEvent(new Event(EVENT));
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={cx("flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100", className)}
    >
      {theme === null ? <span className="size-5" /> : dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}

/** Toasts below the sticky header, in the current theme. */
export function ThemedToaster() {
  const theme = useTheme();
  return (
    <Toaster
      theme={theme ?? "light"}
      position="top-center"
      offset={{ top: 72 }}
      mobileOffset={{ top: 64, left: 16, right: 16 }}
      richColors
      closeButton
      toastOptions={{ duration: 4000 }}
    />
  );
}
