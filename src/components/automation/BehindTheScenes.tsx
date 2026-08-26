"use client";

import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  Bot,
  CheckCircle2,
  Crosshair,
  FlaskConical,
  Loader2,
  Lock,
  Radar,
  ShieldAlert,
  ShoppingCart,
  StopCircle,
  Target,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { parseBotConfig, type BotView } from "./bot-config";

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
}

interface ActivityEntry {
  id: number;
  type: string;
  botId: number | null;
  botName: string | null;
  symbol: string | null;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR";
  timestamp: string;
}

const POLL_MS = 5000;

const STEP_ORDER = ["ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED"] as const;

const STEP_META: Record<string, { label: string; icon: typeof Radar; doneIcon: typeof CheckCircle2 }> = {
  ANALYZING: { label: "Analyze", icon: Radar, doneIcon: CheckCircle2 },
  TRADE_PLANNED: { label: "Plan", icon: Target, doneIcon: CheckCircle2 },
  ORDER_PENDING: { label: "Order", icon: ShoppingCart, doneIcon: CheckCircle2 },
  POSITION_OPEN: { label: "Position", icon: Wallet, doneIcon: CheckCircle2 },
  POSITION_MANAGED: { label: "Manage", icon: Crosshair, doneIcon: CheckCircle2 },
};

const EVENT_META: Record<string, { label: string; icon: typeof ActivityIcon; tone: string }> = {
  BOT_STARTED: { label: "Started", icon: Bot, tone: "text-emerald-400" },
  BOT_STOPPED: { label: "Stopped", icon: StopCircle, tone: "text-zinc-400" },
  BOT_PAUSED: { label: "Paused", icon: StopCircle, tone: "text-zinc-400" },
  BOT_RESUMED: { label: "Resumed", icon: Bot, tone: "text-emerald-400" },
  BOT_CONFIG_UPDATED: { label: "Config updated", icon: Bot, tone: "text-zinc-400" },
  ANALYSIS_STARTED: { label: "Analyzing market", icon: Radar, tone: "text-sky-400" },
  ANALYSIS_COMPLETED: { label: "Analysis done", icon: FlaskConical, tone: "text-zinc-400" },
  TRADE_PLANNED: { label: "Trade planned", icon: Target, tone: "text-amber-400" },
  RISK_REJECTED: { label: "Risk check failed", icon: ShieldAlert, tone: "text-amber-400" },
  ENTRY_ORDER_CREATED: { label: "Order placed", icon: ShoppingCart, tone: "text-sky-400" },
  ENTRY_ORDER_FILLED: { label: "Order filled", icon: CheckCircle2, tone: "text-emerald-400" },
  POSITION_OPENED: { label: "Position opened", icon: Wallet, tone: "text-emerald-400" },
  POSITION_CLOSED: { label: "Position closed", icon: XCircle, tone: "text-zinc-400" },
  BOT_ERROR: { label: "Error", icon: XCircle, tone: "text-red-400" },
  BOT_RECOVERED: { label: "Recovered", icon: CheckCircle2, tone: "text-emerald-400" },
  CYCLE_RETRY: { label: "Retrying", icon: Loader2, tone: "text-amber-400" },
  LOCK_ACQUIRED: { label: "Lock acquired", icon: Lock, tone: "text-zinc-400" },
  LOCK_RELEASED: { label: "Lock released", icon: Lock, tone: "text-zinc-400" },
};

const PHASE_META: Record<string, { label: string; tone: string; icon: typeof ActivityIcon }> = {
  market: { label: "Market", tone: "text-sky-400", icon: Radar },
  indicators: { label: "Indicators", tone: "text-violet-400", icon: ActivityIcon },
  strategy: { label: "Algorithm", tone: "text-emerald-400", icon: FlaskConical },
  plan: { label: "Plan", tone: "text-amber-400", icon: Target },
  risk: { label: "Risk", tone: "text-orange-400", icon: ShieldAlert },
  execution: { label: "Execution", tone: "text-rose-400", icon: ShoppingCart },
  lifecycle: { label: "Lifecycle", tone: "text-zinc-400", icon: Bot },
};

interface LiveStep {
  id: number;
  botId: number;
  symbol: string;
  phase: string;
  message: string;
  at: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(diff)) return "—";
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function stateLabel(status: string): string {
  switch (status) {
    case "STARTING":
      return "Starting up…";
    case "RUNNING":
      return "Watching the market…";
    case "ANALYZING":
      return "Analyzing candles & indicators…";
    case "TRADE_PLANNED":
      return "Entry signal found — preparing trade plan…";
    case "ORDER_PENDING":
      return "Placing order on the exchange…";
    case "POSITION_OPEN":
      return "In position — monitoring entry…";
    case "POSITION_MANAGED":
      return "Managing position — SL / TP / trailing active…";
    case "RECOVERING":
      return "Recovering from an error…";
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

function StepPipeline({ status }: { status: string }) {
  const activeIndex = STEP_ORDER.findIndex((s) => s === status);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {STEP_ORDER.map((step, i) => {
        const meta = STEP_META[step];
        const done = activeIndex > i;
        const active = activeIndex === i;
        const Icon = active ? meta.icon : meta.doneIcon;
        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none",
                active
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : done
                    ? "border-border bg-muted/40 text-muted-foreground"
                    : "border-border text-muted-foreground/60",
              )}
            >
              <Icon size={11} className={active ? "animate-pulse" : ""} />
              {meta.label}
            </div>
            {i < STEP_ORDER.length - 1 && <div className="h-px w-2 shrink-0 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

export function BehindTheScenes() {
  const [bots, setBots] = useState<BotRecord[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [streamUp, setStreamUp] = useState(false);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [botsRes, actRes] = await Promise.all([
          fetch("/api/bots", { cache: "no-store" }),
          fetch("/api/analytics/activity", { cache: "no-store" }),
        ]);
        const botsJson = await botsRes.json();
        const actJson = await actRes.json();
        if (cancelled) return;

        if (botsJson.success) {
          setBots(Array.isArray(botsJson.data) ? botsJson.data : []);
        }
        if (actJson.success) {
          setActivity(Array.isArray(actJson.data?.items) ? actJson.data.items : []);
        }
        setError("");
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load live activity");
      }
    }

    load();
    const interval = setInterval(load, POLL_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 15000);

    const es = new EventSource("/api/bots/live");
    es.onopen = () => setStreamUp(true);
    es.onmessage = (ev) => {
      if (!ev.data || ev.data.startsWith(":")) return;
      try {
        const step = JSON.parse(ev.data) as LiveStep;
        setSteps((prev) => {
          if (prev.some((s) => s.id === step.id)) return prev;
          const next = [...prev, step];
          return next.length > 60 ? next.slice(next.length - 60) : next;
        });
      } catch {
        // ignore malformed frames
      }
    };
    es.onerror = () => setStreamUp(false);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(clock);
      es.close();
    };
  }, []);

  const liveBots = (bots ?? []).filter((b) =>
    ["RUNNING", "STARTING", "RECOVERING", "ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED"].includes(
      b.desiredStatus ?? b.status,
    ),
  );

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Radar className="h-4 w-4" /> Behind the scenes
          <span className="ml-1 flex items-center gap-1 text-xs font-normal text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> live
          </span>
        </CardTitle>
        <CardDescription>Watch every step of the algorithm — data, indicators, strategy decisions — as they happen.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        {error && <div className="rounded-lg bg-red-500/10 p-2 text-xs text-red-400">{error}</div>}

        {/* Compact, single-line-per-bot status — no separate empty section when there's nothing live */}
        {bots === null ? (
          <Skeleton className="h-14 w-full rounded-lg" />
        ) : liveBots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-4 text-center text-sm text-muted-foreground">
            {bots.length === 0
              ? "No automated bots yet — turn on Automated Trading above and watch it work here."
              : "All bots are stopped. Turn on Automated Trading to see live analysis."}
          </p>
        ) : (
          <div className="space-y-2">
            {liveBots.map((bot) => {
              const cfg = parseBotConfig(bot as BotView);
              return (
                <div key={bot.id} className="rounded-lg border border-border bg-background/40 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Bot size={14} className="text-emerald-400" />
                      <span className="text-sm font-semibold text-foreground">{bot.symbol}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {cfg.timeframe} · {bot.leverage}x · {bot.capital} USDT
                      </span>
                    </div>
                    <Badge
                      className={cn(
                        "text-[10px]",
                        bot.status === "ERROR"
                          ? "bg-red-500/15 text-red-400"
                          : ["ANALYZING", "ORDER_PENDING", "TRADE_PLANNED", "POSITION_OPEN", "POSITION_MANAGED"].includes(bot.status)
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-emerald-500/15 text-emerald-400",
                      )}
                    >
                      <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                      {stateLabel(bot.status)}
                    </Badge>
                  </div>
                  <div className="mt-2">
                    <StepPipeline status={bot.status} />
                  </div>
                  {bot.lastError && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
                      <XCircle size={12} /> {bot.lastError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Trace + activity side by side, each independently scrollable — this is what used to run the page long */}
        <div className="grid gap-3 lg:grid-cols-2">
          <LiveSteps steps={steps} streamUp={streamUp} />
          <Feed activity={activity} />
        </div>
      </CardContent>
    </Card>
  );
}

function Feed({ activity }: { activity: ActivityEntry[] }) {
  return (
    <div className="flex h-72 flex-col overflow-hidden rounded-lg border border-border bg-background/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <ActivityIcon size={12} /> Latest activity
        </p>
        <span className="text-[11px] text-muted-foreground">{activity.length}</span>
      </div>

      {activity.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-3 text-center text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto p-2">
          {activity.slice(0, 30).map((item) => {
            const meta = EVENT_META[item.type] ?? { label: item.type, icon: ActivityIcon, tone: "text-zinc-400" };
            const Icon = meta.icon;
            return (
              <li key={item.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                <Icon size={13} className={cn("mt-0.5 shrink-0", meta.tone)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-medium text-foreground">{meta.label}</span>
                    {item.symbol && <span className="text-muted-foreground">{item.symbol}</span>}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(item.timestamp)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LiveSteps({ steps, streamUp }: { steps: LiveStep[]; streamUp: boolean }) {
  return (
    <div className="flex h-72 flex-col overflow-hidden rounded-lg border border-border bg-background/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <ActivityIcon size={12} /> Algorithm live trace
        </p>
        {streamUp ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> streaming
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">connecting…</span>
        )}
      </div>

      {steps.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-3 text-center text-xs text-muted-foreground">
          Waiting for the next analysis cycle — steps will appear here live.
        </p>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto p-2">
          {steps
            .slice()
            .reverse()
            .map((step) => {
              const meta = PHASE_META[step.phase] ?? { label: step.phase, tone: "text-zinc-400", icon: ActivityIcon };
              const Icon = meta.icon;
              return (
                <li key={step.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                  <Icon size={13} className={cn("mt-0.5 shrink-0", meta.tone)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className={cn("font-medium", meta.tone)}>{meta.label}</span>
                      {step.symbol && <span className="text-muted-foreground">{step.symbol}</span>}
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(step.at)}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground">{step.message}</p>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}