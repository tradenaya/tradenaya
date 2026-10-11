"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { TRADING_MODE_HEADER, getTradingMode, isAppApiRequest, subscribeTradingMode, type TradingMode } from "./store";

let installed = false;

/**
 * Tag every same-origin /api request with the current trading mode. Installed
 * once, before any screen fetches, so no page or component needs to know
 * about paper trading to show the right account's data.
 */
function installFetchTagging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isAppApiRequest(input)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(TRADING_MODE_HEADER, getTradingMode());
    return original(input, { ...init, headers });
  };
}

installFetchTagging();

export function useTradingMode(): TradingMode {
  return useSyncExternalStore(subscribeTradingMode, getTradingMode, () => "LIVE");
}

export default function TradingModeProvider({ children }: { children: ReactNode }) {
  installFetchTagging();
  return <>{children}</>;
}
