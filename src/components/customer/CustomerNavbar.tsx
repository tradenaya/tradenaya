"use client";

import { Menu, User, LogOut, Plug, KeyRound, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TradenayaLogo } from "@/components/brand/TradenayaLogo";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { customerLogout } from "@/store/slices/customerAuthSlice";
import { clearTenant } from "@/store/slices/tenantSlice";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { setDisplayCurrency } from "@/lib/currency/store";
import { PaperTradingMenu } from "./PaperTradingMenu";
import { useTradingMode } from "@/lib/trading-mode/TradingModeProvider";

interface Props {
  onMenuClick: () => void;
}

export default function CustomerNavbar({ onMenuClick }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const customerAuth = useAppSelector((state) => state.customerAuth);
  const tenant = useAppSelector((state) => state.tenant);
  const displayCurrency = useDisplayCurrency();
  const tradingMode = useTradingMode();
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

  const [loggingOut, setLoggingOut] = useState(false);

  /**
   * Only clear the local session once the server has cleared the login cookie.
   * If the request fails (e.g. no network) the cookie is still valid, so
   * clearing local state would leave a half-logged-out screen — stay signed
   * in and say why instead.
   */
  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const res = await fetch("/api/auth/signout", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setLoggingOut(false);
      toast.error("Couldn't log you out", {
        description: navigator.onLine
          ? "The server didn't respond. You're still signed in — please try again."
          : "You're offline. You're still signed in — reconnect to the internet and try again.",
      });
      return;
    }

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
    <>
    <header
      className="h-16 border-b flex items-center justify-between px-5"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-4">
        <button onClick={onMenuClick} className="cursor-pointer">
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-2.5">
          <TradenayaLogo className="h-auto w-8 shrink-0" />
          <h1 className="text-lg sm:text-xl brand-heading">{tenant.tenantName || "Tradenaya"}</h1>
          {tradingMode === "PAPER" && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-black" style={{ backgroundColor: "#d97706" }}>PAPER</span>
          )}
        </div>
      </div>

      {!mounted ? (
        <div className="w-32" />
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
              <span className="font-medium">{customerAuth.firstName || "Account"}</span>
              <ChevronDown size={16} style={{ color: "var(--muted-foreground)" }} />
            </button>

            {open && (
              <div
                className="absolute right-0 top-14 w-64 rounded-xl border shadow-xl z-50"
                style={{ backgroundColor: "var(--card, var(--background))", borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="font-semibold">
                    {[customerAuth.firstName, customerAuth.lastName].filter(Boolean).join(" ") || "Your account"}
                  </div>
                  <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>{customerAuth.email}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--primary)" }}>{customerAuth.role}</div>
                </div>
                <PaperTradingMenu />
                <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">Currency</span>
                    <div
                      role="radiogroup"
                      aria-label="Display currency"
                      className="inline-flex rounded-lg border p-0.5"
                      style={{ borderColor: "var(--border)" }}
                    >
                      {(["USDT", "INR"] as const).map((code) => {
                        const active = displayCurrency.currency === code;
                        return (
                          <button
                            key={code}
                            role="radio"
                            aria-checked={active}
                            onClick={() => setDisplayCurrency(code)}
                            className="px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer"
                            style={
                              active
                                ? { backgroundColor: "var(--primary)", color: "var(--primary-foreground, #fff)" }
                                : { color: "var(--muted-foreground)" }
                            }
                          >
                            {code === "INR" ? "₹ INR" : "$ USDT"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {displayCurrency.currency === "USDT"
                      ? "Prices, PnL and logs shown in USDT."
                      : displayCurrency.inrRate != null
                        ? `Live rate ₹${displayCurrency.inrRate.toFixed(2)} / USDT${displayCurrency.rateStale ? " (last known)" : ""}. Orders still settle in USDT.`
                        : "Fetching live rate… showing USDT until it loads."}
                  </p>
                </div>
                <button
                  onClick={() => { setOpen(false); router.push("/coinswitch/connect"); }}
                  className="w-full flex items-center gap-2 px-4 py-3 transition cursor-pointer"
                  style={{ color: "var(--foreground)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted, rgba(0,0,0,0.05))"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <KeyRound size={18} />
                  Secret Keys
                </button>
                <button
                  onClick={handleDisconnect}
                  className="w-full flex items-center gap-2 px-4 py-3 text-yellow-300 transition cursor-pointer"
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(249,115,22,0.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <Plug size={18} />
                  Disconnect
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-3 text-red-600 transition cursor-pointer"
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <LogOut size={18} />
                  {loggingOut ? "Logging out…" : "Logout"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
    </>
  );
}
