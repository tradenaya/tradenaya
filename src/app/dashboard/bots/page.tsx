"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CandlestickChart, Check, Eye, Loader2, MoreVertical, Pause, Play, Plus, Power, Square, Pencil, Trash, X } from "lucide-react";
import { toast } from "sonner";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AutomationSwitch } from "@/components/automation/AutomationSwitch";
import { AutoBadge } from "@/components/automation/AutoBadge";
import { CreateBotDialog } from "@/components/automation/CreateBotDialog";
import { BehindTheScenes } from "@/components/automation/BehindTheScenes";
import { BotDetailsDialog } from "@/components/automation/BotDetailsDialog";
import { EditBotDialog } from "@/components/automation/EditBotDialog";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { parseBotConfig, statusMeta, type BotView } from "@/components/automation/bot-config";
import { type OpenPositionAnalytics } from "@/automation/analytics/types";
import { fmtMoney, displaySymbol, sideLabel, botName } from "@/components/automation/bot-config";
import { formatDate } from "@/components/analytics/format";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { currencyLabel } from "@/lib/currency/store";

const RUNNING_STATES = ["RUNNING", "STARTING", "RECOVERING", "ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED", "STOPPING"];

const MOBILE_TABS = [
  { id: "live", label: "Live" },
  { id: "bots", label: "Bots" },
  { id: "activity", label: "Activity" },
] as const;

type MobileTabId = (typeof MOBILE_TABS)[number]["id"];

const STEP_ORDER = ["ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED"];
const STEP_LABEL: Record<string, string> = {
  ANALYZING: "Analyze",
  TRADE_PLANNED: "Plan",
  ORDER_PENDING: "Order",
  POSITION_OPEN: "In position",
  POSITION_MANAGED: "Managing",
};

function stateLabel(status: string): string {
  switch (status) {
    case "STARTING":
      return "Starting up…";
    case "RUNNING":
      return "Watching the market…";
    case "ANALYZING":
      return "Analyzing market…";
    case "TRADE_PLANNED":
      return "Trade plan ready";
    case "ORDER_PENDING":
      return "Placing order…";
    case "POSITION_OPEN":
      return "Position opened — monitoring entry…";
    case "POSITION_MANAGED":
      return "Managing position — SL / TP / trailing active…";
    case "RECOVERING":
      return "Recovering…";
    case "PAUSED":
      return "Paused";
    case "STOPPING":
      return "Stopping…";
    case "STOPPED":
      return "Stopped";
    case "ERROR":
      return "Failed — check error";
    default:
      return status;
  }
}

interface BotPosition {
  botId: number;
  position: OpenPositionAnalytics | null;
}

function distancePct(current: number, target: number): string {
  if (!current || current <= 0) return "—";
  return `${(((target - current) / current) * 100).toFixed(2)}%`;
}

function positionPnlPct(side: "BUY" | "SELL", entry: number | null, current: number | null): string {
  if (!entry || entry <= 0 || current == null) return "—";
  const dir = side === "BUY" ? 1 : -1;
  return `${((dir * (current - entry)) / entry * 100).toFixed(2)}%`;
}

function isLive(bot: BotView): boolean {
  const status = bot.desiredStatus || bot.status;
  return RUNNING_STATES.includes(status) && status !== "STOPPED" && status !== "PAUSED";
}

/** Compact horizontal progress track — shown inline with the bot's status, not as a separate section. */
function PhaseTrack({ status }: { status: string }) {
  const idx = STEP_ORDER.findIndex((s) => s === status);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {STEP_ORDER.map((step, i) => {
        const active = status === step;
        const done = idx > i;
        return (
          <div key={step} className="flex items-center gap-1">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
                active
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
                  : done
                    ? "border-border bg-muted/40 text-muted-foreground"
                    : "border-border text-muted-foreground/50",
              )}
            >
              {STEP_LABEL[step]}
            </span>
            {i < STEP_ORDER.length - 1 && <span className={cn("h-px w-2 shrink-0", done ? "bg-emerald-400/40" : "bg-border")} />}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value, tone, strong }: { label: string; value: ReactNode; tone?: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-foreground tabular-nums", tone, strong && "text-base font-semibold")}>{value}</span>
    </div>
  );
}

/** One card per live bot: identity, phase, and position metrics together — no duplicate status blocks elsewhere. */
function LiveBotCard({
  bot,
  position,
  onDetails,
  onViewChart,
}: {
  bot: BotView;
  position: OpenPositionAnalytics | null;
  onDetails: (bot: BotView) => void;
  onViewChart: (bot: BotView) => void;
}) {
  const cfg = parseBotConfig(bot);
  const inPhase = STEP_ORDER.includes(bot.status);
  const entry = position?.entryPrice ?? position?.plannedEntryPrice ?? null;
  const current = position?.currentPrice ?? null;
  const sl = position?.stopLoss ?? null;
  const tp = position?.takeProfit ?? null;
  const sym = displaySymbol(bot, cfg);
  const dir = sideLabel(cfg.side);
  const name = botName(bot, cfg);

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="gap-2.5 border-b pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {name && <span className="w-full text-xs font-semibold uppercase tracking-wider text-muted-foreground">{name}</span>}
            <span className="text-xl font-bold text-foreground">
              {sym.replace(/USDT$/, "") || "Auto-select"}
            </span>
            {cfg.autoSelect && <AutoBadge />}
            {dir ? (
              <Badge className={dir === "Long" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                {dir}
              </Badge>
            ) : position ? (
              <Badge className={position.side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                {position.side === "BUY" ? "Long" : "Short"}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {cfg.timeframe} · {cfg.strategy} · {cfg.leverage}x
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => onViewChart(bot)}
            >
              <CandlestickChart size={13} /> View Chart
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => onDetails(bot)}>
              <Eye size={13} /> Details
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{stateLabel(bot.status)}</span>
          {inPhase && <PhaseTrack status={bot.status} />}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {position ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Entry" value={entry != null ? fmtMoney(entry) : "—"} />
            <Metric label="Current" value={current != null ? fmtMoney(current) : "—"} />
            <Metric label="Stop loss" value={sl != null ? `${fmtMoney(sl)} · ${distancePct(current ?? 0, sl)}` : "—"} tone="text-red-400" />
            <Metric label="Take profit" value={tp != null ? `${fmtMoney(tp)} · ${distancePct(current ?? 0, tp)}` : "—"} tone="text-emerald-400" />
            <Metric
              label="Unrealized PnL"
              value={
                position.unrealizedPnl != null
                  ? `${position.unrealizedPnl >= 0 ? "+" : ""}${fmtMoney(position.unrealizedPnl)} (${positionPnlPct(position.side, entry, current)})`
                  : "—"
              }
              tone={position.unrealizedPnl != null ? (position.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400") : undefined}
              strong
            />
            <Metric label="Opened" value={formatDate(position.openTime, { hour12: false, second: "2-digit" })} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No open position yet — waiting for the next entry signal.</p>
        )}
      </CardContent>
    </Card>
  );
}

function LiveOverview({
  bots,
  positions,
  onDetails,
  onViewChart,
}: {
  bots: BotView[];
  positions: BotPosition[];
  onDetails: (bot: BotView) => void;
  onViewChart: (bot: BotView) => void;
}) {
  const running = useMemo(() => bots.filter(isLive), [bots]);

  if (running.length === 0) {
    return (
      <Card className="border border-border bg-card">
        <CardContent className="flex items-center justify-between gap-3 py-6">
          <div>
            <p className="font-semibold text-foreground">No strategies running</p>
            <p className="text-sm text-muted-foreground">Resume a bot below to start automating this market.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("grid gap-3", running.length > 1 && "lg:grid-cols-2")}>
      {running.map((bot) => (
        <LiveBotCard
          key={bot.id}
          bot={bot}
          position={positions.find((p) => p.botId === bot.id)?.position ?? null}
          onDetails={onDetails}
          onViewChart={onViewChart}
        />
      ))}
    </div>
  );
}

export default function AutomationPage() {
  const router = useRouter();
  useDisplayCurrency();
  const [bots, setBots] = useState<BotView[]>([]);
  const [positions, setPositions] = useState<BotPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [schedulerActive, setSchedulerActive] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [detailBot, setDetailBot] = useState<BotView | null>(null);
  const [confirmStop, setConfirmStop] = useState<BotView | null>(null);
  const [editBot, setEditBot] = useState<BotView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BotView | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDeleteMany, setConfirmDeleteMany] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTabId>("live");

  async function loadBots() {
    try {
      const res = await fetch("/api/bots", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to load bots");
      const list = Array.isArray(json.data) ? json.data : [];
      setBots(list);
      setSchedulerActive(json.schedulerActive ?? null);
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : "Failed to load bots");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = setTimeout(loadBots, 0);
    const interval = setInterval(loadBots, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const running = bots.filter(isLive);
    if (running.length === 0) return;
    let cancelled = false;

    Promise.all(
      running.map((b) =>
        fetch(`/api/analytics/positions?botId=${b.id}`, { cache: "no-store" })
          .then((r) => r.json())
          .then(
            (json): BotPosition => ({
              botId: b.id,
              position: json.success && Array.isArray(json.data) && json.data[0] ? json.data[0] : null,
            }),
          )
          .catch(() => ({ botId: b.id, position: null })),
      ),
    ).then((results) => {
      if (!cancelled) setPositions(results);
    });
    return () => {
      cancelled = true;
    };
  }, [bots]);

  async function act(id: number, action: "start" | "pause" | "stop") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/bots/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || `Failed to ${action} bot`);
      toast.success(json.message || `Bot ${action === "start" ? "resumed" : action === "pause" ? "paused" : "stopped"}`);
      await loadBots();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} bot`);
    } finally {
      setBusyId(null);
    }
  }

  async function stopBot(bot: BotView) {
    setConfirmStop(null);
    await act(bot.id, "stop");
  }

  async function deleteBot(bot: BotView) {
    setConfirmDelete(null);
    setBusyId(bot.id);
    try {
      const res = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to delete bot");
      toast.success(`${bot.symbol} deleted`);
      await loadBots();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete bot");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteManyBots() {
    setConfirmDeleteMany(false);
    const ids = Array.from(selectedIds);
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      setBusyId(id);
      try {
        const res = await fetch(`/api/bots/${id}`, { method: "DELETE" });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to delete bot");
        deleted++;
      } catch (err: unknown) {
        failed++;
        toast.error(`${bots.find((b) => b.id === id)?.symbol ?? `Bot #${id}`}: ${err instanceof Error ? err.message : "Failed to delete bot"}`);
      }
    }
    if (deleted > 0) {
      toast.success(`${deleted} bot${deleted === 1 ? "" : "s"} deleted${failed > 0 ? `, ${failed} failed` : ""}`);
    } else if (failed > 0) {
      toast.error(`No bots could be deleted (${failed} failed)`);
    }
    setBusyId(null);
    setSelectedIds(new Set());
    setSelecting(false);
    await loadBots();
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Running bots surface first — the ones needing attention shouldn't be buried in the list.
  const sortedBots = useMemo(() => [...bots].sort((a, b) => Number(isLive(b)) - Number(isLive(a))), [bots]);

  return (
    <div className="space-y-6 px-3 sm:px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Automation</h1>
          <p className="text-sm text-muted-foreground">Your automated trading strategies — live status, logs and controls.</p>
        </div>
        {bots.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Power size={12} className={schedulerActive === false ? "text-amber-400" : "text-emerald-400"} />
            {schedulerActive === false ? "Server offline" : "Scheduler active"}
          </div>
        )}
      </div>

      {/* Settings + Turn On / Turn Off — create a new bot and start it without leaving this screen */}
      <AutomationSwitch onCreated={loadBots} />

      {/* Mobile tabs to avoid endless scrolling */}
      <div className="mobile-tabs lg:hidden">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn("mobile-tab", mobileTab === t.id && "active")}
            onClick={() => setMobileTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Live status — full width, this is the one thing that matters most right now */}
      <section className={cn(mobileTab === "live" ? "block" : "hidden", "lg:block")}>
        {loading && bots.length === 0 ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : (
          <LiveOverview bots={bots} positions={positions} onDetails={setDetailBot} onViewChart={(bot) => router.push(`/trade/${displaySymbol(bot, parseBotConfig(bot))}`)} />
        )}
      </section>

      {/* Bots and Recent activity side by side, locked to the same height with independent scrollers */}
      <div className="grid gap-6 lg:h-[34rem] lg:grid-cols-[320px_minmax(0,1fr)] lg:items-stretch">
        <section className={cn("flex min-h-0 flex-col", mobileTab === "bots" ? "block" : "hidden", "lg:block")}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Bots</h2>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1.5 px-2 text-xs"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={12} /> New bot
              </Button>
              {bots.length > 0 && (
                <Button
                  size="sm"
                  variant={selecting ? "default" : "outline"}
                  className="h-6 gap-1.5 px-2 text-xs"
                  onClick={() => {
                    setSelecting((prev) => {
                      const next = !prev;
                      if (!next) setSelectedIds(new Set());
                      return next;
                    });
                  }}
                >
                  {selecting ? <X size={12} /> : <Check size={12} />}
                  {selecting ? "Done" : "Select…"}
                </Button>
              )}
            </div>
          </div>
          {loading && bots.length === 0 ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : bots.length === 0 ? (
            <Card className="border border-border bg-card">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">No bots configured yet.</CardContent>
            </Card>
          ) : (
            <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
              {sortedBots.map((bot) => {
                const cfg = parseBotConfig(bot);
                const live = isLive(bot);
                const offline = schedulerActive === false && live;
                const st = statusMeta(bot.status);
                const busy = busyId === bot.id;
                return (
                  <div key={bot.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-2.5">
                    {selecting && (
                      <button
                        type="button"
                        disabled={live}
                        title={live ? "Stop the bot before deleting" : undefined}
                        onClick={() => toggleSelected(bot.id)}
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                          selectedIds.has(bot.id)
                            ? "border-red-500/60 bg-red-500/25 text-red-300"
                            : "border-border text-transparent hover:border-red-500/50 hover:text-red-500/40",
                          live && "cursor-not-allowed opacity-30",
                        )}
                      >
                        <Check size={13} />
                      </button>
                    )}
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold",
                        live && !offline ? "bg-emerald-400/15 text-emerald-400" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {displaySymbol(bot, cfg).slice(0, 1) || bot.symbol.slice(0, 1)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold text-foreground">
                        <span className="truncate">{displaySymbol(bot, cfg).replace(/USDT$/, "") || "Auto"}</span>
                        {botName(bot, cfg) && (
                          <span className="shrink-0 truncate text-[11px] font-medium text-muted-foreground" title={botName(bot, cfg)!}>
                            {botName(bot, cfg)}
                          </span>
                        )}
                        {cfg.autoSelect && <AutoBadge />}
                        {sideLabel(cfg.side) && (
                          <span className={cn("shrink-0 text-[10px] font-bold", sideLabel(cfg.side) === "Long" ? "text-emerald-500/80" : "text-red-500/80")}>
                            {sideLabel(cfg.side)}
                          </span>
                        )}
                        {offline && <span className="shrink-0 text-[10px] font-normal text-amber-400">offline</span>}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {cfg.timeframe} · {cfg.leverage}x · {fmtMoney(cfg.capital)} {currencyLabel()}
                      </div>
                      {bot.lastError && !live && (
                        <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-red-400">{bot.lastError}</div>
                      )}
                    </div>

                    <div className="ml-auto flex min-w-0 shrink flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                      <Badge className={cn("shrink-0 text-[10px]", live && !offline ? "bg-emerald-500/15 text-emerald-400" : st.className)}>
                        {live && !offline ? "Running" : st.label}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground sm:h-7 sm:w-7"
                            disabled={busy}
                            title="Bot actions"
                          >
                            {busy ? <Loader2 className="animate-spin" size={13} /> : <MoreVertical size={13} />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem onClick={() => setDetailBot(bot)}>
                            <Eye size={14} />
                            Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditBot(bot)}>
                            <Pencil size={14} />
                            Edit
                          </DropdownMenuItem>
                          {live && !offline ? (
                            <>
                              <DropdownMenuItem onClick={() => act(bot.id, "pause")}>
                                <Pause size={14} />
                                Pause
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setConfirmStop(bot)}>
                                <Square className="text-red-500" size={14} />
                                Stop
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem onClick={() => act(bot.id, "start")}>
                              <Play className="text-emerald-500" size={14} />
                              Resume
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={busy || live}
                            title={live ? "Stop the bot before deleting" : "Delete"}
                            onClick={() => setConfirmDelete(bot)}
                          >
                            <Trash size={14} />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {selecting && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} of {bots.length} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 gap-1.5 px-2.5 text-xs bg-red-500/90 hover:bg-red-500"
                  disabled={selectedIds.size === 0}
                  onClick={() => setConfirmDeleteMany(true)}
                >
                  {busyId != null ? <Loader2 className="animate-spin" size={13} /> : <Trash size={13} />}
                  Delete selected
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className={cn("flex min-h-0 flex-col", mobileTab === "activity" ? "block" : "hidden", "lg:block")}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent activity</h2>
          <div className="min-h-0 flex-1">
            <BehindTheScenes />
          </div>
        </section>
      </div>

      {detailBot && (
        <BotDetailsDialog
          bot={detailBot}
          position={positions.find((p) => p.botId === detailBot.id)?.position ?? null}
          open={Boolean(detailBot)}
          onOpenChange={(open: boolean) => {
            if (!open) setDetailBot(null);
          }}
        />
      )}

      {editBot && (
        <EditBotDialog
          bot={editBot}
          open={Boolean(editBot)}
          onOpenChange={(open: boolean) => {
            if (!open) setEditBot(null);
          }}
          onSaved={loadBots}
        />
      )}

      {confirmDelete && (
        <ConfirmationDialog
          open={Boolean(confirmDelete)}
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null);
          }}
          title="Delete bot"
          description={`Permanently delete ${confirmDelete.symbol}? This also stops the bot and cancels its open orders. This can't be undone.`}
          confirmLabel="Delete bot"
          destructive
          onConfirm={() => deleteBot(confirmDelete)}
        />
      )}

      {confirmDeleteMany && (
        <ConfirmationDialog
          open={Boolean(confirmDeleteMany)}
          onOpenChange={(open) => {
            if (!open) setConfirmDeleteMany(false);
          }}
          title={`Delete ${selectedIds.size} bot${selectedIds.size === 1 ? "" : "s"}?`}
          description="The selected bots will be permanently deleted. Any that are still running or have open positions must be resolved first and won't be deleted. This can't be undone."
          confirmLabel="Delete selected"
          destructive
          onConfirm={() => deleteManyBots()}
        />
      )}

      <CreateBotDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={loadBots}
      />

      {confirmStop && (
        <ConfirmationDialog
          open={Boolean(confirmStop)}
          onOpenChange={(open) => {
            if (!open) setConfirmStop(null);
          }}
          title="Stop automation"
          description={`This will stop ${confirmStop.symbol} and cancel its open orders. You can resume from the Bots section.`}
          confirmLabel="Stop bot"
          destructive
          onConfirm={() => stopBot(confirmStop)}
        />
      )}
    </div>
  );
}