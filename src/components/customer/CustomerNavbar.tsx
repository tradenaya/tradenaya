"use client";

import { Menu, User, LogOut, Plug, Coins, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { customerLogout } from "@/store/slices/customerAuthSlice";
import { clearTenant } from "@/store/slices/tenantSlice";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useDisplayCurrency, useSetDisplayCurrency } from "@/lib/currency/CurrencyProvider";

interface Props {
  onMenuClick: () => void;
}

export default function CustomerNavbar({ onMenuClick }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const customerAuth = useAppSelector((state) => state.customerAuth);
  const displayCurrencyState = useDisplayCurrency();
  const setDisplayCurrency = useSetDisplayCurrency();
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirming, setConfirming] = useState<null | "logout" | "disconnect">(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  async function handleLogout() {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {}

    dispatch(customerLogout());
    dispatch(clearTenant());
    router.replace("/signin");
    setConfirming(null);
    setProfileOpen(false);
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/coinswitch/disconnect", { method: "POST" });
    } catch (error) {
      console.error("Disconnect failed", error);
    }

    router.replace("/coinswitch/connect");
    setConfirming(null);
    setProfileOpen(false);
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
          <button
            onClick={() => setProfileOpen(true)}
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
          </button>
        </div>
      )}

      {profileOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60"
            onClick={() => setProfileOpen(false)}
          />
          <div
            className="fixed inset-y-0 right-0 z-50 w-80 flex flex-col overflow-y-auto"
            style={{
              background: "linear-gradient(180deg, #14100c 0%, #0a0907 100%)",
              color: "#eee5d8",
              boxShadow: "-8px 0 30px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b shrink-0"
              style={{ borderColor: "rgba(201,154,88,0.12)" }}
            >
              <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-cinzel), serif" }}>
                Profile
              </span>
              <button
                onClick={() => setProfileOpen(false)}
                className="cursor-pointer p-1 rounded-md transition"
                style={{ color: "#a89880" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              className="p-5 border-b shrink-0"
              style={{ borderColor: "rgba(201,154,88,0.12)" }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="h-11 w-11 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: "linear-gradient(135deg, #c99a58, #a47209)",
                    color: "#070605",
                  }}
                >
                  <User size={20} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate" style={{ fontFamily: "var(--font-cinzel), serif" }}>
                    {customerAuth.firstName} {customerAuth.lastName}
                  </div>
                  <div className="text-sm truncate" style={{ color: "#a89880" }}>{customerAuth.email}</div>
                </div>
              </div>
              <div
                className="text-xs inline-block px-2 py-0.5 rounded-full"
                style={{
                  color: "#c99a58",
                  backgroundColor: "rgba(201,154,88,0.12)",
                }}
              >
                {customerAuth.role}
              </div>
            </div>

            <div
              className="py-4 px-5 border-b shrink-0"
              style={{ borderColor: "rgba(201,154,88,0.12)" }}
            >
              <div className="flex items-center gap-2 text-sm mb-3">
                <Coins size={15} style={{ color: "#a89880" }} />
                <span style={{ color: "#eee5d8" }}>Display currency</span>
              </div>
              <div
                className="flex rounded-lg p-0.5 w-fit"
                style={{ backgroundColor: "rgba(201,154,88,0.10)", border: "1px solid rgba(201,154,88,0.16)" }}
              >
                {(["USDT", "INR"] as const).map((code) => {
                  const active = displayCurrencyState.currency === code;
                  return (
                    <button
                      key={code}
                      onClick={() => setDisplayCurrency(code)}
                      className="px-4 py-1.5 rounded-md text-xs font-medium transition cursor-pointer"
                      style={
                        active
                          ? { background: "linear-gradient(135deg, #c99a58, #a47209)", color: "#070605" }
                          : { color: "#a89880" }
                      }
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
              {displayCurrencyState.currency === "INR" && (
                <div className="mt-2 text-[11px] tabular-nums" style={{ color: "#a89880" }}>
                  {displayCurrencyState.inrRate != null
                    ? `Live rate ₹${displayCurrencyState.inrRate.toFixed(2)} / USDT${displayCurrencyState.rateStale ? " (last known)" : ""}`
                    : "Fetching live rate…"}
                </div>
              )}
            </div>

            <div className="flex-1 py-2 shrink-0">
              <button
                onClick={() => { setProfileOpen(false); router.push('/coinswitch/connect'); }}
                className="w-full flex items-center gap-2.5 px-5 py-3 text-sm transition cursor-pointer"
                style={{ color: "#eee5d8" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <User size={16} style={{ color: "#a89880" }} />
                Spot Profile
              </button>
              <button
                onClick={() => { setProfileOpen(false); setConfirming("disconnect"); }}
                className="w-full flex items-center gap-2.5 px-5 py-3 text-sm transition cursor-pointer"
                style={{ color: "#dfb978" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <Plug size={16} />
                Disconnect
              </button>
            </div>

            <div
              className="py-2 border-t shrink-0"
              style={{ borderColor: "rgba(201,154,88,0.12)" }}
            >
              <button
                onClick={() => { setProfileOpen(false); setConfirming("logout"); }}
                className="w-full flex items-center gap-2.5 px-5 py-3 text-sm transition cursor-pointer"
                style={{ color: "#ef4444" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </div>
        </>
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
