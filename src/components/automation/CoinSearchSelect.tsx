"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatPrice, formatSignedPercent } from "@/components/analytics/format";

interface CoinOption {
  symbol: string;
  lastPrice: number | null;
  change24h: number | null;
  volume24h: number | null;
  status?: string;
}

interface TickerEntry {
  last_price?: unknown;
  price_24h_pcnt?: unknown;
  quote_asset_volume_24h?: unknown;
}

interface InstrumentEntry {
  status?: string;
}

interface CoinSearchSelectProps {
  value: string;
  onChange: (symbol: string) => void;
  disabled?: boolean;
}

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function CoinSearchSelect({ value, onChange, disabled }: CoinSearchSelectProps) {
  const [coins, setCoins] = useState<CoinOption[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setHighlighted(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coinswitch/futures/ticker", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.message || "Failed to load coins");
        const list = Object.entries((json.data ?? {}) as Record<string, TickerEntry>).map(([symbol, v]) => ({
          symbol: String(symbol).toUpperCase(),
          lastPrice: Number(v?.last_price) || null,
          change24h: Number(v?.price_24h_pcnt) || null,
          volume24h: Number(v?.quote_asset_volume_24h) || null,
        }));
        setCoins(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load coins");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coinswitch/futures/instrument-info", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) return;
        const statusMap = new Map<string, string>();
        for (const [symbol, v] of Object.entries((json.data ?? {}) as Record<string, InstrumentEntry>)) {
          if (v?.status) statusMap.set(String(symbol).toUpperCase(), String(v.status).toUpperCase());
        }
        setCoins((prev) =>
          (prev ?? []).map((coin) => ({ ...coin, status: statusMap.get(coin.symbol) ?? coin.status })),
        );
      })
      .catch(() => {
        // Instrument status is auxiliary; keep ticker data if it fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      return;
    }
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const matches = useMemo(() => {
    if (!coins) return [];
    const q = debouncedQuery.trim().toUpperCase();
    if (!q) {
      return [...coins].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 8);
    }
    const starts: CoinOption[] = [];
    const contains: CoinOption[] = [];
    for (const coin of coins) {
      if (coin.symbol.startsWith(q)) starts.push(coin);
      else if (coin.symbol.includes(q)) contains.push(coin);
    }
    const rank = (list: CoinOption[]) =>
      list.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 8);
    return [...rank(starts), ...rank(contains)].slice(0, 8);
  }, [coins, debouncedQuery]);

  function select(symbol: string) {
    onChange(symbol);
    setQuery(symbol);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches.length > 0) {
        const target = matches[Math.min(highlighted, matches.length - 1)];
        select(target.symbol);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          id="auto-symbol"
          className="pl-9 pr-8"
          placeholder="Search coin e.g BTCUSDT"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear symbol"
            onClick={() => {
              setQuery("");
              onChange("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
          {loadError && <div className="px-2 py-1.5 text-xs text-red-400">{loadError}</div>}
          {matches.map((coin, index) => {
            const selected = coin.symbol.toUpperCase() === value.toUpperCase();
            return (
              <button
                key={coin.symbol}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(coin.symbol)}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  index === highlighted ? "bg-white/10 text-foreground" : "text-foreground"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{coin.symbol}</span>
                  {coin.status && coin.status !== "TRADING" && (
                    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                      Market closed
                    </span>
                  )}
                  {selected && (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                      Selected
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {coin.volume24h != null && <span>{compactNumber(coin.volume24h)}</span>}
                  {coin.lastPrice != null && <span>{formatPrice(coin.lastPrice)}</span>}
                  {coin.change24h != null && (
                    <span
                      className={
                        coin.change24h >= 0 ? "text-emerald-400" : "text-red-400"
                      }
                    >
                      {formatSignedPercent(coin.change24h)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && !matches.length && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover p-3 text-sm text-muted-foreground shadow-xl">
          {coins === null && !loadError ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading coins…
            </span>
          ) : (
            "No contracts match your search."
          )}
        </div>
      )}
    </div>
  );
}
