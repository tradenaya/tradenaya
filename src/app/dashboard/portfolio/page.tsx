"use client";

import { useEffect, useState } from "react";
import { Wallet, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

  async function loadPortfolio() {
    try {
      setError("");
      const res = await fetch("/api/coinswitch/portfolio", { cache: "no-store" });
      const json = (await res.json()) as PortfolioResponse & { success?: boolean; message?: string };
      if (json.success === false) throw new Error(json.message || "Failed to load portfolio");
      setHoldings(json.data?.data ?? []);
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
    <div className="space-y-4 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Spot Portfolio</h1>
          <p className="text-sm text-muted-foreground">Your spot balances across all assets.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadPortfolio} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Invested</TableHead>
                    <TableHead className="text-right">Current Value</TableHead>
                    <TableHead className="text-right">P/L</TableHead>
                    <TableHead className="text-right">P/L %</TableHead>
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
                        <TableCell className="text-right">
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
    </div>
  );
}
