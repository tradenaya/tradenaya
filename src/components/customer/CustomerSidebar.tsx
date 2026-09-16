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
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-72 flex flex-col border-r transform transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{
          background: "linear-gradient(180deg, #0a0907 0%, #070605 100%)",
          color: "#eee5d8",
          borderColor: "rgba(201,154,88,0.12)",
        }}
      >
        <div
          className="h-16 flex items-center justify-between px-5 border-b shrink-0"
          style={{ borderColor: "rgba(201,154,88,0.12)" }}
        >
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-3">
            <span
              className="h-9 w-9 rounded-lg flex items-center justify-center font-bold text-lg"
              style={{
                background: "linear-gradient(135deg, #c99a58, #a47209)",
                color: "#070605",
              }}
            >
              T
            </span>
            <span
              className="text-xl font-bold"
              style={{
                fontFamily: "var(--font-cinzel), serif",
                background: "linear-gradient(100deg, #f4e6cd, #c99a58)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {tenantName || "Tradenaya"}
            </span>
          </Link>

          <button
            onClick={onClose}
            className="cursor-pointer"
            style={{ color: "rgba(201,154,88,0.5)" }}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p
                className="px-3 mb-2 text-[0.65rem] font-semibold uppercase"
                style={{
                  fontFamily: "var(--font-cinzel), serif",
                  letterSpacing: "0.14em",
                  color: "rgba(201,154,88,0.45)",
                }}
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
                              background: "rgba(201,154,88,0.12)",
                              color: "#c99a58",
                            }
                          : { color: "#a89880" }
                      }
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon size={18} />
                      <span style={{ fontFamily: "var(--font-cinzel), serif" }}>
                        {link.label}
                      </span>
                      {active && (
                        <span
                          className="ml-auto h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: "#c99a58" }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          className="p-4 border-t shrink-0"
          style={{ borderColor: "rgba(201,154,88,0.12)" }}
        >
          <p
            className="text-xs"
            style={{
              fontFamily: "var(--font-cinzel), serif",
              color: "rgba(201,154,88,0.34)",
            }}
          >
            Tradenaya · Automated crypto futures
          </p>
        </div>
      </aside>
    </>
  );
}
