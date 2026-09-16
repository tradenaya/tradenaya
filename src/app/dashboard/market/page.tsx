"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Search, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice, formatSignedPercent } from "@/components/analytics/format";

interface TickerEntry {
  last_price?: unknown;
  price_24h_pcnt?: unknown;
  quote_asset_volume_24h?: unknown;
  funding_rate?: unknown;
}

interface Coin {
  symbol: string;
  lastPrice: number | null;
  change24h: number | null;
  volume24h: number | null;
  fundingRate: number | null;
}

const COINS_PER_PAGE = 50;

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function MarketPage() {
  const router = useRouter();
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchMarket(): Promise<Coin[]> {
    const res = await fetch("/api/coinswitch/futures/ticker", { cache: "no-store" });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Failed to fetch market");

    return Object.entries((json.data ?? {}) as Record<string, TickerEntry>).map(([symbol, v]) => ({
      symbol: String(symbol).toUpperCase(),
      lastPrice: toNumber(v?.last_price),
      change24h: toNumber(v?.price_24h_pcnt),
      volume24h: toNumber(v?.quote_asset_volume_24h),
      fundingRate: toNumber(v?.funding_rate),
    }));
  }

  useEffect(() => {
    async function load() {
      try {
        setCoins(await fetchMarket());
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load market data");
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  // Persist search across every API refresh: derive the visible list from the
  // latest `coins` + the live `search` query instead of resetting on each poll.
  const filtered = useMemo(() => {
    if (!coins) return [];
    const q = search.trim().toUpperCase();
    if (!q) {
      return [...coins].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
    }
    return coins.filter((c) => c.symbol.includes(q));
  }, [coins, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / COINS_PER_PAGE));
  const start = (page - 1) * COINS_PER_PAGE;
  const currentCoins = filtered.slice(start, start + COINS_PER_PAGE);

  return (
    <div className="space-y-4 px-3 sm:px-6 py-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Futures Market</h1>
        <p className="text-sm text-muted-foreground">Live perpetual contracts across all symbols.</p>
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Contracts</CardTitle>
              <CardDescription>{filtered.length} symbols</CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 pl-9"
                placeholder="Search coin e.g BTCUSDT"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {error && <p className="text-sm text-red-400">{error}</p>}

          {loading ? (
            <Skeleton className="h-96 w-full rounded-lg" />
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {search ? `No contracts match "${search}".` : "No market data available right now."}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="min-w-[540px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">24h</TableHead>
                      <TableHead className="text-right">Volume 24h</TableHead>
                      <TableHead className="text-right">Funding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentCoins.map((coin) => {
                      const up = (coin.change24h ?? 0) >= 0;
                      return (
                        <TableRow
                          key={coin.symbol}
                          className="group cursor-pointer transition-colors hover:bg-accent/60"
                          onClick={() => router.push(`/trade/${coin.symbol}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-xs font-bold text-foreground">
                                {coin.symbol.slice(0, 1)}
                              </div>
                              <div className="font-medium text-foreground">{coin.symbol.replace(/USDT$/, "")}</div>
                              <span className="hidden text-xs text-muted-foreground sm:inline">
                                {coin.symbol}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatPrice(coin.lastPrice)}</TableCell>
                          <TableCell className="text-right">
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                up ? "text-emerald-400" : "text-red-400"
                              }`}
                            >
                              {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                              {formatSignedPercent(coin.change24h)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {compactNumber(coin.volume24h ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {coin.fundingRate != null ? `${(coin.fundingRate * 100).toFixed(4)}%` : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Page {page} of {totalPages} · {filtered.length} symbols
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <button
        className="fixed bottom-6 right-6 hidden sm:inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-300 opacity-60 transition-opacity hover:opacity-100"
        onClick={() => router.push("/dashboard")}
        title="Back to dashboard"
      >
        <ArrowUpRight size={14} /> Dashboard
      </button>
    </div>
  );
}
