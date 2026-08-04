"use client";

import { Menu, User, LogOut, Plug, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { customerLogout } from "@/store/slices/customerAuthSlice";
import { clearTenant } from "@/store/slices/tenantSlice";

interface Props {
  onMenuClick: () => void;
}

export default function CustomerNavbar({ onMenuClick }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const customerAuth = useAppSelector((state) => state.customerAuth);
  const tenant = useAppSelector((state) => state.tenant);
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
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {}

    dispatch(customerLogout());
    dispatch(clearTenant());
    router.replace("/signin");
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/coinswitch/disconnect", { method: "POST" });
    } catch (error) {
      console.error("Disconnect failed", error);
    }

    router.replace("/coinswitch/connect");
  }

  return (
    <header
      className="h-16 border-b flex items-center justify-between px-5"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-4">
        <button onClick={onMenuClick} className="cursor-pointer">
          <Menu size={24} />
        </button>
        <h1 className="text-lg font-semibold">{tenant.tenantName || "TradeNaya"}</h1>
      </div>

      {!mounted ? (
        <div className="w-32" />
      ) : !customerAuth.isAuthenticated ? (
        <button
          onClick={() => router.push("/signin")}
          className="px-5 py-2 rounded-lg font-medium hover:opacity-90 transition cursor-pointer"
          style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground, #fff)" }}
        >
          Sign In
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg transition cursor-pointer"
              style={{ color: "var(--foreground)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted, rgba(0,0,0,0.05))"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground, #fff)" }}
              >
                <User size={18} />
              </div>
              <span className="font-medium">{customerAuth.firstName}</span>
              <ChevronDown size={16} style={{ color: "var(--muted-foreground)" }} />
            </button>

            {open && (
              <div
                className="absolute right-0 top-14 w-72 rounded-xl border shadow-xl z-50"
                style={{ backgroundColor: "var(--card, var(--background))", borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="font-semibold">
                    {customerAuth.firstName} {customerAuth.lastName}
                  </div>
                  <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>{customerAuth.email}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--primary)" }}>{customerAuth.role}</div>
                </div>
                <button
                  onClick={() => { setOpen(false); router.push('/coinswitch/connect'); }}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--muted)] transition cursor-pointer"
                >
                  <User size={18} />
                  Spot Profile
                </button>
                <button
                  onClick={handleDisconnect}
                  className="w-full flex items-center gap-2 px-4 py-3 text-yellow-300 transition cursor-pointer hover:bg-[var(--muted)]"
                >
                  <Plug size={18} />
                  Disconnect
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-3 text-red-600 transition cursor-pointer hover:bg-[var(--muted)]"
                >
                  <LogOut size={18} />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
