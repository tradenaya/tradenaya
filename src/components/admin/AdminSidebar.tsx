"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  tenantName?: string;
}

export default function AdminSidebar({ open, onClose, tenantName }: Props) {
  const pathname = usePathname();
  const sidebarBg = "var(--admin-sidebar)";
  const fg = "var(--admin-foreground)";
  const primary = "var(--admin-primary)";
  const surface = "var(--admin-surface)";
  const active = pathname === "/admin/dashboard";

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition ${open ? "block" : "hidden"}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 left-0 z-50 h-screen w-72 flex flex-col transform transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ backgroundColor: sidebarBg, color: fg }}
      >
        <div
          className="h-16 flex items-center justify-between px-5 shrink-0"
          style={{ borderBottom: `1px solid ${surface}` }}
        >
          <h1 className="text-lg font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
            {tenantName || "TradeNaya"}
          </h1>
          <button onClick={onClose} className="md:hidden cursor-pointer" style={{ color: fg }}>
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <Link
            href="/admin/dashboard"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
            style={{
              backgroundColor: active ? primary : "transparent",
              color: active ? "#fff" : fg,
              opacity: active ? 1 : 0.7,
            }}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </Link>
        </nav>

        <div className="p-3 shrink-0" style={{ borderTop: `1px solid ${surface}` }}>
          <div className="px-3 py-2 text-xs" style={{ color: fg, opacity: 0.4 }}>
            TradeNaya Admin
          </div>
        </div>
      </div>
    </>
  );
}
