"use client";

import { useEffect, useState } from "react";
import { Wallet, RefreshCw, ArrowLeftRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConvertInrToUsdtDialog } from "@/components/coinswitch/convert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CoinHolding {
  currency: string;
  name: string;
  main_balance: number;
  invested_value: number;
  current_value: number;
}

interface PortfolioResponse {
  data?: { data?: CoinHolding[] };
}

// Fiat quote-currency cash held in the account wallet (e.g. the INR you
// deposited). It is not an asset and must not be counted as a holding, or the
// portfolio value gets inflated by the very cash used to buy the coins.
const FIAT_CURRENCIES = new Set(["INR", "INR."]);

// CoinSwitch reports the rupee cash you deposited as a row next to the coins.
// That cash is not an asset — counting it inflates invested/current/P&L by the
// very money used to buy the coins. Match on code (case-insensitive) or name.
function isFiatCash(c: CoinHolding): boolean {
  const code = String(c.currency ?? "").trim().toUpperCase().replace(/\.$/, "");
  const name = String(c.name ?? "").toLowerCase();
  return FIAT_CURRENCIES.has(code) || name.includes("indian rupee");
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnl(value: number): string {
  return `${value > 0 ? "+" : ""}${money(value)}`;
}

function pnlClass(value: number): string {
  return value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-muted-foreground";
}

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<CoinHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);

  async function loadPortfolio() {
    try {
      setError("");
      const res = await fetch("/api/coinswitch/portfolio", { cache: "no-store" });
      const json = (await res.json()) as PortfolioResponse & { success?: boolean; message?: string };
      if (json.success === false) throw new Error(json.message || "Failed to load portfolio");
      const all = json.data?.data ?? [];
      setHoldings(all.filter((c) => !isFiatCash(c)));
    } catch (err: any) {
      setError(err.message || "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPortfolio();
  }, []);

  const totalInvested = holdings.reduce((sum, c) => sum + Number(c.invested_value || 0), 0);
  const totalCurrent = holdings.reduce((sum, c) => sum + Number(c.current_value || 0), 0);
  const totalPnl = totalCurrent - totalInvested;
  const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return (
    <div className="space-y-4 px-3 sm:px-6 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Spot Portfolio</h1>
          <p className="text-sm text-muted-foreground">Your spot balances across all assets.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConvertOpen(true)}
            className="w-full border-amber-500/40 text-amber-300 hover:text-amber-200 sm:w-auto"
          >
            <ArrowLeftRight size={14} /> Convert INR to USDT
          </Button>
          <Button variant="outline" size="sm" onClick={loadPortfolio} disabled={loading} className="w-full sm:w-auto">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="bg-card">
          <CardContent className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Total Invested</p>
            <p className="text-xl font-semibold">{money(totalInvested)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Current Value</p>
            <p className="text-xl font-semibold">{money(totalCurrent)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Total P/L</p>
            <p className={`text-xl font-semibold ${pnlClass(totalPnl)}`}>{pnl(totalPnl)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">P/L %</p>
            <p className={`text-xl font-semibold ${pnlClass(totalPnl)}`}>
              {totalInvested > 0 ? `${totalPnl > 0 ? "+" : ""}${pnlPercent.toFixed(2)}%` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Holdings
          </CardTitle>
          <CardDescription>{holdings.length} assets</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {loading ? (
            <Skeleton className="h-72 w-full rounded-lg" />
          ) : holdings.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Wallet className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No holdings found. Connect your CoinSwitch account to view your spot portfolio.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Invested</TableHead>
                    <TableHead className="text-right">Current Value</TableHead>
                    <TableHead className="text-right">P/L</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">P/L %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((coin) => {
                    const coinPnl = Number(coin.current_value || 0) - Number(coin.invested_value || 0);
                    const coinPct = Number(coin.invested_value || 0) > 0 ? (coinPnl / Number(coin.invested_value)) * 100 : 0;
                    return (
                      <TableRow key={coin.currency}>
                        <TableCell>
                          <div className="font-medium text-foreground">{coin.name}</div>
                          <div className="text-xs text-muted-foreground">{coin.currency}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{coin.main_balance}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(coin.invested_value)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(coin.current_value)}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${pnlClass(coinPnl)}`}>
                          {pnl(coinPnl)}
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell">
                          <Badge className={coinPnl > 0 ? "bg-emerald-500/15 text-emerald-400" : coinPnl < 0 ? "bg-red-500/15 text-red-400" : "bg-zinc-500/15 text-zinc-400"}>
                            {coinPnl > 0 ? "+" : ""}
                            {coinPct.toFixed(2)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConvertInrToUsdtDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        onConverted={() => void loadPortfolio()}
      />
    </div>
  );
}
