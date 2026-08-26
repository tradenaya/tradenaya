"use client"

import { useMemo } from "react"
import { CalendarDays, RefreshCw } from "lucide-react"
import { apiGet } from "./api"
import { useAsyncData } from "./use-data"
import type { AnalyticsFilterState } from "./api"
import type { BotSummary, SymbolPerformance } from "@/automation/analytics/types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const labelClass = "text-xs font-medium text-muted-foreground"

interface FilterBarProps {
  filters: AnalyticsFilterState
  onChange: (filters: AnalyticsFilterState) => void
  onRefresh: () => void
  showGranularity?: boolean
}

export function FilterBar({ filters, onChange, onRefresh, showGranularity = false }: FilterBarProps) {
  const { data: bots } = useAsyncData<BotSummary[]>(() => apiGet("/api/analytics/bots"), [])
  const { data: symbols } = useAsyncData<SymbolPerformance[]>(() => apiGet("/api/analytics/symbols"), [])

  const botOptions = useMemo(() => bots ?? [], [bots])
  const symbolOptions = useMemo(() => symbols ?? [], [symbols])

  const update = (patch: Partial<AnalyticsFilterState>) => onChange({ ...filters, ...patch })

  const toEpoch = (value: string, endOfDay: boolean) => {
    if (!value) return null
    const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
    return date.getTime()
  }

  const fromEpoch = (ms: number | null) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10))

  const dateClass =
    "h-8 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-1">
        <label className={labelClass}>Bot</label>
        <Select
          value={filters.botId != null ? String(filters.botId) : "all"}
          onValueChange={(v) => update({ botId: v === "all" ? null : Number(v) })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bots</SelectItem>
            {botOptions.map((bot) => (
              <SelectItem key={bot.id} value={String(bot.id)}>
                {bot.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Symbol</label>
        <Select
          value={filters.symbol ?? "all"}
          onValueChange={(v) => update({ symbol: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All symbols</SelectItem>
            {symbolOptions.map((s) => (
              <SelectItem key={s.symbol} value={s.symbol}>
                {s.symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Side</label>
        <Select
          value={filters.side ?? "all"}
          onValueChange={(v) => update({ side: v === "all" ? null : (v as "BUY" | "SELL") })}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="BUY">Long</SelectItem>
            <SelectItem value="SELL">Short</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>From</label>
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="date"
            className={cn(dateClass, "pl-8")}
            value={fromEpoch(filters.startTime)}
            onChange={(e) => update({ startTime: toEpoch(e.target.value, false) })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>To</label>
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="date"
            className={cn(dateClass, "pl-8")}
            value={fromEpoch(filters.endTime)}
            onChange={(e) => update({ endTime: toEpoch(e.target.value, true) })}
          />
        </div>
      </div>

      {showGranularity && (
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Granularity</label>
          <Select
            value={filters.granularity}
            onValueChange={(v) => update({ granularity: v as AnalyticsFilterState["granularity"] })}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <Button onClick={onRefresh} size="sm" className="h-8 gap-2">
        <RefreshCw size={14} />
        Refresh
      </Button>
    </div>
  )
}
