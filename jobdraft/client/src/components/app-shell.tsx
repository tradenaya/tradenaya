"use client";

import { History, LayoutDashboard, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "./auth";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme";
import { cx } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/history", label: "History", Icon: History },
  { href: "/setup", label: "Setup", Icon: SlidersHorizontal },
  { href: "/account", label: "Account", Icon: UserRound },
];

const ADMIN_NAV = { href: "/admin", label: "Admin", Icon: ShieldCheck };

/** Shown on every page while an admin uses JobDraft as another user. */
function ActingBanner() {
  const { user, actor } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!actor || !user) return null;
  async function back() {
    setBusy(true);
    await api("/api/admin/impersonate/stop", { method: "POST" }).catch(() => undefined);
    window.location.assign("/admin");
  }
  return (
    <div role="status" className="bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-300" data-testid="acting-banner">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-[15px] sm:px-6 lg:px-8">
        <p className="min-w-0">
          You&apos;re using JobDraft as <strong>{user.name}</strong> <span className="break-all">({user.email})</span>. Everything you do here is done for them.
        </p>
        <button type="button" onClick={() => void back()} disabled={busy} className="min-h-11 rounded-xl px-3 font-semibold underline underline-offset-2 hover:bg-amber-100">
          Return to admin
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const { user, actor } = useAuth();
  // Admins see an Admin tab (not while acting as a user).
  const nav = user?.isAdmin && !actor ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="pt-safe sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <ActingBanner />
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
          <Link href="/dashboard" className="flex min-h-11 items-center" aria-label="JobDraft — dashboard">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            {/* Desktop / tablet nav */}
            <nav aria-label="Main" className="hidden md:block">
              <ul className="flex items-center gap-1">
                {nav.map(({ href, label, Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active(href) ? "page" : undefined}
                      className={cx(
                        "flex min-h-11 items-center gap-2 rounded-xl px-3 font-medium",
                        active(href) ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100",
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-10 md:pt-8 lg:px-8">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav aria-label="Main" data-testid="bottom-nav" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white md:hidden">
        <ul className={cx("grid", nav.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
          {nav.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold", active(href) ? "text-brand-700" : "text-slate-600")}
              >
                <Icon className={cx("size-6", active(href) && "stroke-[2.5]")} aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
