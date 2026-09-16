"use client";

import { useEffect, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import {
  getCurrencyState,
  getSnapshotCurrency,
  subscribeCurrency,
  setDisplayCurrency,
  setInrRate,
  type CurrencyState,
  type DisplayCurrency,
} from "./store";

/**
 * How often the client refreshes the live USDT→INR rate while INR display is
 * active. The server caches the exchange quote for its own TTL, so polling here
 * is cheap even if many clients are online.
 */
const RATE_REFRESH_MS = 60_000;

async function fetchInrRate(): Promise<number | null> {
  try {
    const res = await fetch("/api/currency/rate", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { inrRate?: unknown; data?: { inrRate?: unknown } };
    const value = Number(json?.inrRate ?? json?.data?.inrRate ?? NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * React subscription to the display-currency store. Any component calling this
 * re-renders when the currency or the live rate changes.
 */
export function useDisplayCurrency(): CurrencyState {
  return useSyncExternalStore(subscribeCurrency, getSnapshotCurrency, getSnapshotCurrency);
}

export function useSetDisplayCurrency(): (currency: DisplayCurrency) => void {
  return setDisplayCurrency;
}

export default function CurrencyProvider({ children }: { children: ReactNode }) {
  const state = useDisplayCurrency();

  // Keep the exchange USD/INR-like rate fresh while INR display is on.
  useEffect(() => {
    if (state.currency !== "INR") return;

    let cancelled = false;
    const load = async () => {
      const rate = await fetchInrRate();
      if (!cancelled && rate != null) setInrRate(rate);
    };
    void load();
    const interval = setInterval(load, RATE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state.currency]);

  // Warm the rate in the background as soon as the app loads (even in USDT
  // mode) so toggling to INR is instant instead of showing USDT for a second.
  useEffect(() => {
    if (getCurrencyState().inrRate != null) return;
    void fetchInrRate().then((rate) => {
      if (rate != null) setInrRate(rate);
    });
  }, []);

  return <>{children}</>;
}