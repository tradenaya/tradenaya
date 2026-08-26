"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const markets = [
  { symbol: "BTC/USDT", price: "95000", change: "+2.45%", volume: "1.2B" },
  { symbol: "ETH/USDT", price: "3400", change: "-1.20%", volume: "520M" },
  { symbol: "SOL/USDT", price: "180", change: "+3.10%", volume: "300M" },
];

export default function FuturesPage() {
  const [search, setSearch] = useState("");

  const filteredMarkets = markets.filter((market) =>
    market.symbol.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-6">
      <h1 className="text-3xl font-bold">Futures Market</h1>

      <div className="relative mt-6 mb-4 max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search symbol…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b">
          <CardTitle>Contracts</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {filteredMarkets.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No contracts match &quot;{search}&quot;.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">24h Change</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMarkets.map((market) => {
                    const up = market.change.startsWith("+");
                    return (
                      <TableRow
                        key={market.symbol}
                        className="cursor-pointer"
                        onClick={() => {}}
                      >
                        <TableCell>
                          <Link
                            href={`/trade/${market.symbol.replace("/", "-")}`}
                            className="font-semibold text-foreground hover:text-primary"
                          >
                            {market.symbol}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">${market.price}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={up ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                            {market.change}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{market.volume}</TableCell>
                      </TableRow>
                    );
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
