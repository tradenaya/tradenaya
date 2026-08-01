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

  const primary = "var(--admin-primary)";
  const surface = "var(--admin-surface)";
  const fg = "var(--admin-foreground)";
  const secondary = "var(--admin-secondary)";

  return (
    <header className="h-16 flex items-center justify-between px-6" style={{ backgroundColor: surface, borderBottom: `1px solid ${secondary}` }}>
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="p-2 rounded-lg transition hover:opacity-80 cursor-pointer"
          style={{ color: primary }}
        >
          <Menu size={24} />
        </button>
        <h1 className="text-xl font-bold" style={{ color: primary }}>{adminAuth.tenantName || "TradiAura"}</h1>
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
            <div className="h-10 w-10 rounded-full text-white flex items-center justify-center" style={{ backgroundColor: primary }}>
              <User size={18} />
            </div>
            <div className="text-left">
              <div className="font-semibold text-sm" style={{ color: fg }}>{adminAuth.firstName}</div>
              <div className="text-xs" style={{ color: secondary }}>{adminAuth.role}</div>
            </div>
          </button>

          {open && (
            <div className="absolute right-0 top-14 w-72 rounded-2xl border shadow-2xl overflow-hidden z-50" style={{ backgroundColor: surface, borderColor: secondary }}>
              <div className="p-5 text-white" style={{ backgroundColor: primary }}>
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-white/20 flex items-center justify-center">
                    <User size={28} />
                  </div>
                  <div>
                    <div className="font-bold text-lg">{adminAuth.firstName} {adminAuth.lastName}</div>
                    <div className="text-sm opacity-90">{adminAuth.role}</div>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3 text-sm" style={{ color: secondary }}>
                  <Mail size={16} /> {adminAuth.email}
                </div>
                <div className="flex items-center gap-3 text-sm" style={{ color: secondary }}>
                  <Shield size={16} /> {adminAuth.role}
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${secondary}` }}>
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
