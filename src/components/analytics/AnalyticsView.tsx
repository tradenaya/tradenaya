"use client";

import { useState } from "react";
import { AccountSummaryCards } from "./AccountSummaryCards";
import { ActivityCard } from "./ActivityCard";
import { formatShortDate } from "./format";
import { ActiveOrdersCard } from "./ActiveOrdersCard";
import { BacktestsCard } from "./BacktestsCard";
import { BotPerformanceTable } from "./BotPerformanceTable";
import { BotStatusCards } from "./BotStatusCards";
import { EquityCurveCard } from "./EquityCurveCard";
import { ExitReasonCard } from "./ExitReasonCard";
import { FilterBar } from "./FilterBar";
import { OpenPositionsCard } from "./OpenPositionsCard";
import { PnlChartCard } from "./PnlChartCard";
import { RecentTradesTable } from "./RecentTradesTable";
import { StrategyPerformanceCard } from "./StrategyPerformanceCard";
import { SymbolPerformanceCard } from "./SymbolPerformanceCard";
import { TradeStatsCard } from "./TradeStatsCard";
import { DEFAULT_FILTERS, type AnalyticsFilterState } from "./api";
import { cn } from "@/lib/utils";

interface Props {
  title?: string;
  description?: string;
}

const MOBILE_TABS = [
  { id: "summary", label: "Summary" },
  { id: "charts", label: "Charts" },
  { id: "open", label: "Open Positions" },
  { id: "performance", label: "Performance" },
  { id: "trades", label: "Trades" },
  { id: "backtests", label: "Backtests" },
  { id: "activity", label: "Activity" },
] as const;

type MobileTabId = (typeof MOBILE_TABS)[number]["id"];

function ActiveFilters({ filters }: { filters: AnalyticsFilterState }) {
  const parts: { label: string; value: string }[] = [];
  if (filters.botId != null) parts.push({ label: "Bot", value: `#${filters.botId}` });
  if (filters.symbol) parts.push({ label: "Symbol", value: filters.symbol });
  if (filters.side) parts.push({ label: "Side", value: filters.side === "BUY" ? "Long" : "Short" });
  if (filters.startTime) parts.push({ label: "From", value: formatShortDate(filters.startTime) });
  if (filters.endTime) parts.push({ label: "To", value: formatShortDate(filters.endTime) });

  const cleared = !filters.botId && !filters.symbol && !filters.side && !filters.startTime && !filters.endTime;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">Showing:</span>
      {cleared ? (
        <span className="text-xs text-muted-foreground">all bots, all symbols, all time</span>
      ) : (
        parts.map((p) => (
          <span
            key={p.label}
            className="inline-flex items-baseline gap-1 rounded-md border border-border px-2 py-0.5 text-xs"
          >
            <span className="text-muted-foreground">{p.label}:</span>
            <span className="text-foreground">{p.value}</span>
          </span>
        ))
      )}
    </div>
  );
}

export function AnalyticsView({ title = "Analytics", description }: Props) {
  const [filters, setFilters] = useState<AnalyticsFilterState>(DEFAULT_FILTERS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<MobileTabId>("summary");

  const tabCls = (id: MobileTabId) =>
    cn(
      "mobile-tab",
      tab === id ? "active" : "",
    );

  const sectionCls = (id: MobileTabId) =>
    cn(
      tab === id ? "block" : "hidden",
      "lg:block",
    );

  return (
    <div className="space-y-4 px-3 sm:px-6 py-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        showGranularity
      />

      <ActiveFilters filters={filters} />

      {/* Mobile only: tabbed navigation to avoid endless scrolling */}
      <div className="mobile-tabs lg:hidden">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tabCls(t.id)}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div key={refreshKey} className="space-y-4">
        <section className={sectionCls("summary")}>
          <AccountSummaryCards filters={filters} />
          <BotStatusCards filters={filters} />
        </section>

        <section className={sectionCls("charts")}>
          <div className="grid gap-4 lg:grid-cols-2">
            <EquityCurveCard filters={filters} />
            <PnlChartCard filters={filters} />
          </div>
        </section>

        <section className={sectionCls("open")}>
          <div className="grid gap-4 lg:grid-cols-2">
            <OpenPositionsCard filters={filters} />
            <ActiveOrdersCard filters={filters} />
          </div>
        </section>

        <section className={sectionCls("performance")}>
          <BotPerformanceTable filters={filters} />
          <div className="grid gap-4 lg:grid-cols-2">
            <StrategyPerformanceCard filters={filters} />
            <SymbolPerformanceCard filters={filters} />
          </div>
        </section>

        <section className={sectionCls("trades")}>
          <div className="grid gap-4 lg:grid-cols-2">
            <TradeStatsCard filters={filters} />
            <ExitReasonCard filters={filters} />
          </div>
          <RecentTradesTable filters={filters} />
        </section>

        <section className={sectionCls("backtests")}>
          <BacktestsCard filters={filters} />
        </section>

        <section className={sectionCls("activity")}>
          <ActivityCard filters={filters} />
        </section>
      </div>
    </div>
  );
}