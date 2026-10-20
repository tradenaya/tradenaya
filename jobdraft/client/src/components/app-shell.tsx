"use client";

import { FileText, History, LayoutDashboard, SlidersHorizontal, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme";
import { cx } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/history", label: "History", Icon: History },
  { href: "/setup", label: "Setup", Icon: SlidersHorizontal },
  { href: "/account", label: "Account", Icon: UserRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="pt-safe sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
          <Link href="/dashboard" className="flex min-h-11 items-center gap-2 font-bold text-slate-900">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <FileText className="size-5" aria-hidden />
            </span>
            JobDraft
          </Link>
          <div className="flex items-center gap-1">
            {/* Desktop / tablet nav */}
            <nav aria-label="Main" className="hidden md:block">
              <ul className="flex items-center gap-1">
                {NAV.map(({ href, label, Icon }) => (
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
        <ul className="grid grid-cols-4">
          {NAV.map(({ href, label, Icon }) => (
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
