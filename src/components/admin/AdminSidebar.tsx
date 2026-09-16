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
  const active = pathname === "/admin/dashboard";

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 left-0 z-50 h-screen w-72 flex flex-col transform transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{
          background: "linear-gradient(180deg, #0a0907 0%, #070605 100%)",
          color: "#eee5d8",
        }}
      >
        <div
          className="h-16 flex items-center justify-between px-5 shrink-0"
          style={{ borderBottom: "1px solid rgba(201,154,88,0.12)" }}
        >
          <h1
            className="text-lg font-bold"
            style={{
              fontFamily: "var(--font-cinzel), serif",
              background: "linear-gradient(100deg, #f4e6cd, #c99a58)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {tenantName || "Tradenaya"}
          </h1>
          <button onClick={onClose} className="md:hidden cursor-pointer" style={{ color: "#a89880" }}>
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <Link
            href="/admin/dashboard"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
            style={{
              backgroundColor: active ? "rgba(201,154,88,0.15)" : "transparent",
              color: active ? "#c99a58" : "#a89880",
              fontFamily: "var(--font-cinzel), serif",
            }}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </Link>
        </nav>

        <div className="p-3 shrink-0" style={{ borderTop: "1px solid rgba(201,154,88,0.12)" }}>
          <div
            className="px-3 py-2 text-xs"
            style={{
              fontFamily: "var(--font-cinzel), serif",
              color: "rgba(201,154,88,0.4)",
            }}
          >
            Tradenaya Admin
          </div>
        </div>
      </div>
    </>
  );
}