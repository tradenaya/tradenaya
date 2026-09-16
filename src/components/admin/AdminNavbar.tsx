"use client";

import { Menu, User, LogOut, Mail, Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { adminLogout } from "@/store/slices/adminAuthSlice";
import { clearTenant } from "@/store/slices/tenantSlice";

interface Props {
  onMenuClick: () => void;
}

export default function AdminNavbar({ onMenuClick }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const adminAuth = useAppSelector((state) => state.adminAuth);
  const [open, setOpen] = useState(false);

  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/admin/signout", { method: "POST" });
    } catch {}

    dispatch(adminLogout());
    dispatch(clearTenant());
    router.replace("/admin-signin");
  }

  return (
    <header
      className="h-14 sm:h-16 flex items-center justify-between px-4 sm:px-6"
      style={{
        background: "linear-gradient(90deg, #0a0907, #070605)",
        borderBottom: "1px solid rgba(201,154,88,0.12)",
      }}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="p-2 rounded-lg transition hover:opacity-80 cursor-pointer"
          style={{ color: "#c99a58" }}
        >
          <Menu size={24} />
        </button>
        <h1
          className="text-lg sm:text-xl font-bold hidden sm:block"
          style={{
            fontFamily: "var(--font-cinzel), serif",
            background: "linear-gradient(100deg, #f4e6cd, #c99a58)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {adminAuth.tenantName || "Tradenaya"}
        </h1>
      </div>

      {!mounted ? (
        <div className="w-32" />
      ) : (
        <div className="flex items-center gap-2">
        <div ref={ref} className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-3 px-3 py-2 rounded-xl transition hover:opacity-80 cursor-pointer"
          >
            <div
              className="h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #c99a58, #a47209)", color: "#070605" }}
            >
              <User size={16} />
            </div>
            <div className="text-left hidden sm:block">
              <div className="font-semibold text-sm" style={{ color: "#eee5d8", fontFamily: "var(--font-cinzel), serif" }}>{adminAuth.firstName}</div>
              <div className="text-xs" style={{ color: "#a89880" }}>{adminAuth.role}</div>
            </div>
          </button>

          {open && (
            <div
              className="absolute right-0 top-14 w-72 rounded-2xl border shadow-2xl overflow-hidden z-50"
              style={{ background: "linear-gradient(160deg, rgba(201,154,88,0.06), #0a0907)", borderColor: "rgba(201,154,88,0.16)" }}
            >
              <div className="p-5" style={{ background: "linear-gradient(135deg, #c99a58, #a47209)", color: "#070605" }}>
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-black/20 flex items-center justify-center">
                    <User size={28} />
                  </div>
                  <div>
                    <div className="font-bold text-lg" style={{ fontFamily: "var(--font-cinzel), serif" }}>{adminAuth.firstName} {adminAuth.lastName}</div>
                    <div className="text-sm opacity-90">{adminAuth.role}</div>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3 text-sm" style={{ color: "#a89880" }}>
                  <Mail size={16} /> {adminAuth.email}
                </div>
                <div className="flex items-center gap-3 text-sm" style={{ color: "#a89880" }}>
                  <Shield size={16} /> {adminAuth.role}
                </div>
              </div>

              <div style={{ borderTop: "1px solid rgba(201,154,88,0.12)" }}>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-5 py-4 text-red-500 transition hover:bg-red-500/10 cursor-pointer"
                >
                  <LogOut size={18} /> Logout
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      )}
    </header>
  );
}