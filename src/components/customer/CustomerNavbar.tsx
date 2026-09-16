"use client";

import { Menu, User, LogOut, Plug, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { customerLogout } from "@/store/slices/customerAuthSlice";
import { clearTenant } from "@/store/slices/tenantSlice";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";

interface Props {
  onMenuClick: () => void;
}

export default function CustomerNavbar({ onMenuClick }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const customerAuth = useAppSelector((state) => state.customerAuth);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<null | "logout" | "disconnect">(null);
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
    setConfirming(null);
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/coinswitch/disconnect", { method: "POST" });
    } catch (error) {
      console.error("Disconnect failed", error);
    }

    router.replace("/coinswitch/connect");
    setConfirming(null);
  }

  function requestConfirm(action: "logout" | "disconnect") {
    setConfirming(action);
  }

  return (
    <header
      className="h-14 sm:h-16 border-b flex items-center justify-between px-4 sm:px-5"
      style={{
        background: "linear-gradient(90deg, #0a0907, #070605)",
        color: "#eee5d8",
        borderColor: "rgba(201,154,88,0.12)",
      }}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="cursor-pointer rounded-md p-1 transition"
          style={{ color: "#a89880" }}
          aria-label="Toggle sidebar"
        >
          <Menu size={24} />
        </button>
      </div>

      {!mounted ? (
        <div className="w-32" />
      ) : !customerAuth.isAuthenticated ? (
        <button
          onClick={() => router.push("/signin")}
          className="px-5 py-2 rounded-lg font-medium hover:opacity-90 transition cursor-pointer"
          style={{
            background: "linear-gradient(135deg, #c99a58, #a47209)",
            color: "#070605",
            fontFamily: "var(--font-cinzel), serif",
          }}
        >
          Sign In
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg transition cursor-pointer"
              style={{ color: "#eee5d8" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <div
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #c99a58, #a47209)",
                  color: "#070605",
                }}
              >
                <User size={16} />
              </div>
              <span className="font-medium hidden sm:inline" style={{ fontFamily: "var(--font-cinzel), serif" }}>
                {customerAuth.firstName}
              </span>
              <ChevronDown
                size={16}
                style={{ color: "#a89880", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}
              />
            </button>

            {open && (
              <div
                className="absolute right-0 top-14 w-72 rounded-xl border shadow-2xl z-50 overflow-hidden animate-fade-in"
                style={{
                  background: "linear-gradient(160deg, #14100c, #0a0907)",
                  borderColor: "rgba(201,154,88,0.16)",
                  color: "#eee5d8",
                  boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
                }}
              >
                <div
                  className="p-4 border-b"
                  style={{ borderColor: "rgba(201,154,88,0.12)" }}
                >
                  <div className="font-semibold" style={{ fontFamily: "var(--font-cinzel), serif" }}>
                    {customerAuth.firstName} {customerAuth.lastName}
                  </div>
                  <div className="text-sm truncate" style={{ color: "#a89880" }}>{customerAuth.email}</div>
                  <div
                    className="text-xs mt-1 inline-block px-2 py-0.5 rounded-full"
                    style={{
                      color: "#c99a58",
                      backgroundColor: "rgba(201,154,88,0.12)",
                    }}
                  >
                    {customerAuth.role}
                  </div>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { setOpen(false); router.push('/coinswitch/connect'); }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm transition cursor-pointer"
                    style={{ color: "#eee5d8" }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <User size={16} style={{ color: "#a89880" }} />
                    Spot Profile
                  </button>
                  <button
                    onClick={() => { setConfirming("disconnect"); }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm transition cursor-pointer"
                    style={{ color: "#dfb978" }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <Plug size={16} />
                    Disconnect
                  </button>
                </div>
                <div
                  className="py-1 border-t"
                  style={{ borderColor: "rgba(201,154,88,0.12)" }}
                >
                  <button
                    onClick={() => { setConfirming("logout"); }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm transition cursor-pointer"
                    style={{ color: "#ef4444" }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open) setConfirming(null); }}
        title={confirming === "logout" ? "Log out" : "Disconnect CoinSwitch"}
        description={
          confirming === "logout"
            ? "You'll be signed out and returned to the sign-in screen. Any unsaved changes will be lost."
            : "This removes your saved CoinSwitch credentials and disconnects live trading. You'll be redirected to reconnect."
        }
        confirmLabel={confirming === "logout" ? "Log out" : "Disconnect"}
        destructive
        onConfirm={confirming === "logout" ? handleLogout : handleDisconnect}
      />
    </header>
  );
}
