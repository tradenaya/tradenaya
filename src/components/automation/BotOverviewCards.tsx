"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Bot, Cpu, Gauge, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtRelative, isRunning, parseBotConfig, statusMeta, displaySymbol, sideLabel, botName, type BotView } from "./bot-config";

export function BotOverviewCards() {
  const router = useRouter();
  const [bots, setBots] = useState<BotView[] | null>(null);
  const [schedulerActive, setSchedulerActive] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/bots", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.success) {
          setBots(Array.isArray(json.data) ? json.data : []);
          setSchedulerActive(json.schedulerActive ?? null);
        }
      } catch (err: unknown) {
        if (!cancelled) console.error(err instanceof Error ? err.message : "Failed to load bots");
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card className="bg-card">
      <CardHeader className="flex-row items-center justify-between border-b">
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4" /> Active strategies
        </CardTitle>
        <button
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => router.push("/dashboard/bots")}
        >
          Manage automations <ChevronRight size={14} />
        </button>
      </CardHeader>
      <CardContent className="pt-4">
        {bots === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : bots.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <p className="text-sm text-muted-foreground">No strategies running yet.</p>
            <p className="text-xs text-muted-foreground/70">
              Turn on automated trading above — analysis and order placement will show up here.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bots.map((bot) => {
              const config = parseBotConfig(bot);
              const live = isRunning(bot.desiredStatus || bot.status) && schedulerActive !== false;
              const offline = schedulerActive === false && (live || isRunning(bot.status));
              const st = statusMeta(bot.status);
              const lastError = bot.lastError && !live ? bot.lastError : null;
              const sym = displaySymbol(bot, config);
              const dir = sideLabel(config.side);
              const name = botName(bot, config);
              return (
                <button
                  key={bot.id}
                  onClick={() => router.push("/dashboard/bots")}
                  className="group rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:border-foreground/20 hover:bg-background/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold",
                          live && !offline ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {sym.slice(0, 1) || bot.symbol.slice(0, 1)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          {name && <span className="max-w-40 truncate text-xs font-medium text-muted-foreground" title={name}>{name}</span>}
                          <span className="font-semibold text-foreground">{sym.replace(/USDT$/, "") || "Auto"}</span>
                          {config.autoSelect && <span className="text-[10px] font-bold text-emerald-500/80">AUTO</span>}
                          {dir && (
                            <span className={cn("text-[10px] font-bold", dir === "Long" ? "text-emerald-500/80" : "text-red-500/80")}>
                              {dir}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span>{config.timeframe}</span>
                          <span>·</span>
                          <span>{config.strategy}</span>
                        </div>
                      </div>
                    </div>
                    {offline ? (
                      <Badge className="bg-amber-500/15 text-amber-400">Server offline</Badge>
                    ) : (
                      <Badge className={live ? "bg-emerald-500/15 text-emerald-400" : st.className}>
                        {live ? "Running" : st.label}
                      </Badge>
                    )}
                  </div>

                  {lastError && <div className="mt-2 truncate text-[11px] text-red-400">{lastError}</div>}

                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Gauge size={12} /> {config.leverage}x
                    </span>
                    <span className="flex items-center gap-1">
                      <Wallet size={12} /> {fmtMoney(config.capital)} USDT
                    </span>
                    <span className={cn("ml-auto flex items-center gap-1", live && !offline && "text-emerald-400")}>
                      <Cpu size={12} /> {live && !offline ? "Live" : fmtRelative(bot.updatedAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}