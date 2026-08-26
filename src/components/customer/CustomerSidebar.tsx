"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  CandlestickChart,
  History,
  LayoutDashboard,
  LineChart,
  Layers,
  Wallet,
  X,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  tenantName?: string;
}

interface NavLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  match: "exact" | "prefix";
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: "exact" },
      { href: "/dashboard/market", label: "Market", icon: LineChart, match: "exact" },
    ],
  },
  {
    label: "Trading",
    links: [
      { href: "/trade/BTCUSDT", label: "Futures Trade", icon: CandlestickChart, match: "prefix" },
      { href: "/dashboard/positions", label: "Positions", icon: Layers, match: "exact" },
      { href: "/dashboard/position-history", label: "Positions History", icon: Layers, match: "exact" },
      { href: "/dashboard/orders", label: "Order History", icon: History, match: "exact" },
    ],
  },
  {
    label: "Automation",
    links: [
      { href: "/dashboard/bots", label: "Automation", icon: Bot, match: "exact" },
      { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, match: "exact" },
    ],
  },
  {
    label: "Account",
    links: [
      { href: "/dashboard/portfolio", label: "Spot Portfolio", icon: Wallet, match: "exact" },
    ],
  },
];

function isActive(pathname: string, link: NavLink): boolean {
  if (link.match === "exact") return pathname === link.href;
  return pathname.startsWith(link.href) || pathname === "/trade";
}

export default function CustomerSidebar({ open, onClose, tenantName }: Props) {
  const pathname = usePathname();

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 ${open ? "block" : "hidden"}`}
        onClick={onClose}
      />

      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-72 flex flex-col border-r transform transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)" }}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-3">
            <span
              className="h-9 w-9 rounded-lg flex items-center justify-center font-bold text-lg"
              style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              T
            </span>
            <span className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
              {tenantName || "TradeNaya"}
            </span>
          </Link>

          <button onClick={onClose} className="cursor-pointer" style={{ color: "var(--foreground)" }} aria-label="Close sidebar">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p
                className="px-3 mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {group.label}
              </p>
              <div className="space-y-1">
                {group.links.map((link) => {
                  const active = isActive(pathname, link);
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={onClose}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
                      style={
                        active
                          ? {
                              backgroundColor: "color-mix(in lab, var(--primary) 14%, transparent)",
                              color: "var(--primary)",
                            }
                          : { color: "var(--muted-foreground)" }
                      }
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon size={18} />
                      {link.label}
                      {active && (
                        <span
                          className="ml-auto h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: "var(--primary)" }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t shrink-0" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            TradeNaya · Automated crypto futures
          </p>
        </div>
      </aside>
    </>
  );
}
