"use client";

import { useEffect, useState } from "react";
import { Loader2, Power, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { CreateBotDialog } from "@/components/automation/CreateBotDialog";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { parseBotConfig, displaySymbol, sideLabel, botName } from "@/components/automation/bot-config";
import { fmtMoney } from "@/components/automation/bot-config";
import { AutoBadge } from "@/components/automation/AutoBadge";
import { currencyLabel } from "@/lib/currency/store";

interface BotRecord {
  id: number;
  symbol: string;
  timeframe: string;
  strategy: string;
  leverage: number;
  capital: number;
  status: string;
  desiredStatus: string;
  lastError: string | null;
  name?: string | null;
  configJson?: string | null;
}

const runningStates = ["RUNNING", "STARTING", "RECOVERING", "ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED", "STOPPING"];

export function AutomationSwitch({ onCreated }: { onCreated?: () => void }) {
  const [bots, setBots] = useState<BotRecord[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmTurnOff, setConfirmTurnOff] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [schedulerActive, setSchedulerActive] = useState<boolean | null>(null);

  async function loadBots() {
    try {
      const res = await fetch("/api/bots", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to load automation");
      setBots(Array.isArray(json.data) ? json.data : []);
      setSchedulerActive(json.schedulerActive ?? null);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load automation");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/bots", { cache: "no-store" });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Failed to load automation");
        if (!cancelled) {
          setBots(Array.isArray(json.data) ? json.data : []);
          setSchedulerActive(json.schedulerActive ?? null);
          setError("");
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load automation");
        }
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const botList = bots ?? [];
  const anyRunning = botList.some((b) => runningStates.includes(b.desiredStatus ?? b.status));
  const serverOffline = schedulerActive === false;

  async function startAll(ids: number[]) {
    for (const id of ids) {
      const res = await fetch(`/api/bots/${id}/start`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || `Failed to start bot ${id}`);
    }
  }

  async function stopAll(ids: number[]) {
    for (const id of ids) {
      const res = await fetch(`/api/bots/${id}/stop`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || `Failed to stop bot ${id}`);
    }
  }

  async function turnOn() {
    setBusy(true);
    setError("");
    try {
      if (botList.length === 0) {
        setSettingsOpen(true);
      } else {
        const stopped = botList
          .filter((b) => !runningStates.includes(b.desiredStatus ?? b.status))
          .map((b) => b.id);
        if (stopped.length > 0) {
          await startAll(stopped);
          toast.success("Automated trading resumed");
        }
        await loadBots();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start automated trading";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    try {
      const running = botList
        .filter((b) => runningStates.includes(b.desiredStatus ?? b.status))
        .map((b) => b.id);
      if (running.length > 0) {
        await stopAll(running);
        toast.success("Automated trading stopped");
      }
      await loadBots();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to stop automated trading";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreated() {
    setSettingsOpen(false);
    await loadBots();
    onCreated?.();
  }

  /**
   * Manual exchange→DB reconciliation. Runs a full recovery sweep server-side:
   * every active position is verified against the exchange and any position the
   * exchange reports as gone is closed in the DB with its true exit. Safe to
   * press repeatedly.
   */
  async function syncFromExchange() {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/bots/sync", { method: "POST", cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Sync failed");
      const s = json.data ?? {};
      const parts: string[] = [];
      if (s.confirmedClosed > 0) parts.push(`${s.confirmedClosed} closed`);
      if (s.keptOpen > 0) parts.push(`${s.keptOpen} open`);
      if (s.failed > 0) parts.push(`${s.failed} failed`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      toast.success(`Synced ${s.positionsChecked ?? 0} position(s) with the exchange${detail}`);
      await loadBots();
      onCreated?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to sync with exchange";
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  const runningCount = botList.filter((b) => runningStates.includes(b.desiredStatus ?? b.status)).length;

  if (bots === null) {
    return (
      <Card className="bg-card">
        <CardContent className="py-6">
          <Skeleton className="h-10 w-2/3 rounded-lg" />
          <Skeleton className="mt-3 h-4 w-1/3 rounded-md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`bg-card border ${anyRunning ? "border-emerald-500/30" : ""}`}>
      <CardContent className="flex w-full flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition ${
              anyRunning ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
            }`}
          >
            <Power size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-foreground">Automated Trading</h2>
              {serverOffline && anyRunning ? (
                <Badge className="bg-amber-500/15 text-amber-400">Server offline</Badge>
              ) : anyRunning ? (
                <Badge className="bg-emerald-500/15 text-emerald-400">Running</Badge>
              ) : (
                <Badge className="bg-zinc-500/15 text-zinc-400">Stopped</Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {serverOffline && anyRunning
                ? "The trading engine is not running on the server. Start the server and keep it open — automation only runs while the server is online."
                : anyRunning
                  ? `${runningCount} bot${runningCount === 1 ? "" : "s"} active — Tradenaya trades for you.`
                  : "Tradenaya trades for you. Turn it on and it runs your strategy automatically."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void syncFromExchange()}
            disabled={syncing || busy}
            title="Reconcile positions with the exchange — any position the exchange reports as closed is reflected here"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync Exchange
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} title="Edit strategy settings">
            <Settings2 size={14} /> Settings
          </Button>
          <Button
            size="lg"
            disabled={busy}
            onClick={anyRunning ? () => setConfirmTurnOff(true) : botList.length === 0 ? () => setSettingsOpen(true) : turnOn}
            className={`min-w-32 flex-1 sm:flex-none font-semibold ${
              anyRunning
                ? "bg-red-600/90 hover:bg-red-600 text-white"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            {busy && <Loader2 className="animate-spin" />}
            {anyRunning ? "Turn Off" : "Turn On"}
          </Button>
        </div>
      </CardContent>

      {error && (
        <div className="border-t border-border px-4 sm:px-6 py-3 text-sm text-red-400">{error}</div>
      )}

      {botList.length > 0 && (
        <div className="border-t border-border px-4 sm:px-6 py-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Active strategies</p>
          <div className="flex flex-wrap gap-2">
            {botList.map((bot) => {
              const live = runningStates.includes(bot.desiredStatus ?? bot.status);
              const cfg = parseBotConfig(bot);
              const sym = displaySymbol(bot, cfg);
              const dir = sideLabel(cfg.side);
              const name = botName(bot, cfg);
              return (
                <div
                  key={bot.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${live ? "border-emerald-500/25 bg-emerald-500/5" : "border-border bg-muted/40"}`}
                >
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-foreground">
                    {name && <span className="max-w-40 truncate text-xs font-medium text-muted-foreground" title={name}>{name}</span>}
                    <span>{sym.replace(/USDT$/, "") || "Auto"}</span>
                    {cfg.autoSelect && <AutoBadge />}
                    {dir && (
                      <span className={`text-[10px] font-bold ${dir === "Long" ? "text-emerald-500/80" : "text-red-500/80"}`}>
                        {dir}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {bot.timeframe} · {bot.leverage}x · {fmtMoney(bot.capital)} {currencyLabel()}
                  </div>
                  {bot.lastError && <div className="mt-1 text-xs text-red-400">{bot.lastError}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CreateBotDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onCreated={handleCreated}
      />

      <ConfirmationDialog
        open={confirmTurnOff}
        onOpenChange={setConfirmTurnOff}
        title="Stop automated trading"
        description="This will stop all running bots and cancel their open orders. You will need to resume manually."
        confirmLabel="Stop automation"
        destructive
        loading={busy}
        onConfirm={turnOff}
      />
    </Card>
  );
}
