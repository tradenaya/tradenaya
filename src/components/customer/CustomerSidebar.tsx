"use client";

import Link from "next/link";
import { LayoutDashboard, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  tenantName?: string;
}

export default function CustomerSidebar({ open, onClose, tenantName }: Props) {
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden ${open ? "block" : "hidden"}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 left-0 z-50 h-screen w-72 border-r transform transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)" }}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b" style={{ borderColor: "var(--border)" }}>
          <h1 className="text-xl font-bold">{tenantName || "TradiAura"}</h1>

          <button onClick={onClose} className="cursor-pointer md:hidden" style={{ color: "var(--foreground)" }}>
            <X size={22} />
          </button>
        </div>

        <nav className="p-4 space-y-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 p-3 rounded-lg transition"
            style={{ backgroundColor: "var(--card)", color: "var(--foreground)" }}
            onClick={onClose}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </Link>

          <Link
            href="/dashboard/market"
            className="flex items-center gap-3 p-3 rounded-lg transition"
            style={{ backgroundColor: "var(--card)", color: "var(--foreground)" }}
            onClick={onClose}
          >
            <LayoutDashboard size={18} />
            Market
          </Link>

          <Link
            href="/dashboard/positions"
            className="flex items-center gap-3 p-3 rounded-lg transition"
            style={{ backgroundColor: "var(--card)", color: "var(--foreground)" }}
            onClick={onClose}
          >
            <LayoutDashboard size={18} />
            Positions
          </Link>

        </nav>
      </div>
    </>
  );
}
