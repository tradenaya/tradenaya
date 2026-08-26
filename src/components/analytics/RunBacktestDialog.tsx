"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BacktestConfig } from "@/automation/backtest/types"
import { apiSend } from "./api"

const inputClass = "h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

const defaultFrom = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
const defaultTo = new Date().toISOString().slice(0, 10)

export function RunBacktestDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [symbol, setSymbol] = useState("BTCUSDT")
  const [timeframe, setTimeframe] = useState("1h")
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [capital, setCapital] = useState("1000")
  const [leverage, setLeverage] = useState("5")
  const [risk, setRisk] = useState("1.5")
  const [dailyLoss, setDailyLoss] = useState("5")
  const [trailing, setTrailing] = useState(true)
  const [trailingDist, setTrailingDist] = useState("1")
  const [feeBps, setFeeBps] = useState("5")
  const [slippageBps, setSlippageBps] = useState("0")
  const [policy, setPolicy] = useState("CONSERVATIVE")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    const startTime = new Date(`${from}T00:00:00.000Z`).getTime()
    const endTime = new Date(`${to}T23:59:59.999Z`).getTime()
    if (!(startTime > 0) || !(endTime > startTime)) {
      setError("Backtest end must be after start.")
      return
    }
    const config: BacktestConfig = {
      symbol,
      timeframe,
      startTime,
      endTime,
      initialCapital: Number(capital),
      capitalMode: "fixed",
      leverage: Number(leverage),
      maxRiskPerTrade: Number(risk),
      dailyLossLimit: Number(dailyLoss),
      enableTrailingStop: trailing,
      trailingDistancePercent: trailing ? Number(trailingDist) : 0,
      feeRateBps: Number(feeBps),
      slippageBps: Number(slippageBps),
      executionPolicy: policy as BacktestConfig["executionPolicy"],
      description: description || undefined,
    }

    try {
      setSubmitting(true)
      await apiSend("/api/analytics/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      onCreated()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run backtest")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run Backtest</DialogTitle>
          <DialogDescription>Simulate the automation pipeline on historical data.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Symbol">
            <Input className={inputClass} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="BTCUSDT" />
          </Field>
          <Field label="Timeframe">
            <select className={inputClass} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </Field>
          <Field label="From">
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Initial Capital (USDT)">
            <Input className={inputClass} type="number" min="1" value={capital} onChange={(e) => setCapital(e.target.value)} />
          </Field>
          <Field label="Leverage">
            <Input className={inputClass} type="number" min="1" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
          </Field>
          <Field label="Max Risk per Trade (%)">
            <Input className={inputClass} type="number" step="0.1" min="0.1" value={risk} onChange={(e) => setRisk(e.target.value)} />
          </Field>
          <Field label="Daily Loss Limit (%)">
            <Input className={inputClass} type="number" step="0.1" min="0" value={dailyLoss} onChange={(e) => setDailyLoss(e.target.value)} />
          </Field>
          <Field label="Fee (bps)">
            <Input className={inputClass} type="number" min="0" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} />
          </Field>
          <Field label="Slippage (bps)">
            <Input className={inputClass} type="number" min="0" value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} />
          </Field>
          <Field label="Execution Policy">
            <select className={inputClass} value={policy} onChange={(e) => setPolicy(e.target.value)}>
              <option value="CONSERVATIVE">Conservative</option>
              <option value="STOP_FIRST">Stop first</option>
              <option value="TARGET_FIRST">Target first</option>
            </select>
          </Field>
          <Field label="Trailing stop">
            <select
              className={inputClass}
              value={trailing ? "on" : "off"}
              onChange={(e) => setTrailing(e.target.value === "on")}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </Field>
          {trailing && (
            <Field label="Trailing distance (%)">
              <Input className={inputClass} type="number" step="0.1" min="0.1" value={trailingDist} onChange={(e) => setTrailingDist(e.target.value)} />
            </Field>
          )}
          <div className="col-span-2">
            <Field label="Description (optional)">
              <Input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. trend-following test on BTC" />
            </Field>
          </div>
        </div>

        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Running…" : "Run Backtest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
