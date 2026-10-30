"use client"

import { useState } from "react"
import { toast } from "sonner"
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
import { DatePicker } from "@/components/ui/date-picker"
import type { BacktestConfig } from "@/automation/backtest/types"
import { apiSend } from "./api"
import { ErrorState } from "@/components/ui/error-state"
import { StrategyPicker } from "@/components/automation/StrategyPicker"
import { CoinSearchSelect } from "@/components/automation/CoinSearchSelect"
import { RiskStylePicker, type RiskStyle } from "@/components/automation/RiskStylePicker"
import { DEFAULT_STRATEGY_ID, TREND_BREAKOUT_ID, strategyInfo } from "@/automation/strategy/catalog"

const inputClass = "h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {hint && <p className="-mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>}
      {children}
    </div>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

/**
 * Backtest form. Field names and defaults match "Create bot", so a backtest
 * shows how a bot with those settings would have traded. Fees, slippage and
 * the same-candle fill rule use realistic fixed defaults (not user fields).
 */
export function RunBacktestDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const initial = strategyInfo(DEFAULT_STRATEGY_ID).defaults
  const [strategy, setStrategy] = useState<string>(DEFAULT_STRATEGY_ID)
  const info = strategyInfo(strategy)
  const [symbol, setSymbol] = useState("BTCUSDT")
  const [timeframe, setTimeframe] = useState(initial.timeframe)
  const [from, setFrom] = useState(daysAgo(90))
  const [to, setTo] = useState(today())
  const [capital, setCapital] = useState("100")
  const [leverage, setLeverage] = useState("5")
  const [riskStyle, setRiskStyle] = useState<RiskStyle>("SAFE")
  const [risk, setRisk] = useState(String(initial.maxRiskPerTrade))
  const [dailyLoss, setDailyLoss] = useState(String(initial.dailyLossLimit))
  const [momentumOnly, setMomentumOnly] = useState(initial.momentumEntriesOnly)
  const [trailing, setTrailing] = useState(initial.enableTrailingStop)
  const [trailingDist, setTrailingDist] = useState("1")
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const isBreakout = info.id === TREND_BREAKOUT_ID

  const pickStrategy = (id: string) => {
    // Same recommended settings as "Create bot" applies for this strategy.
    const d = strategyInfo(id).defaults
    setStrategy(id)
    setTimeframe(strategyInfo(id).fixedTimeframe ?? d.timeframe)
    setRisk(String(d.maxRiskPerTrade))
    setDailyLoss(String(d.dailyLossLimit))
    setMomentumOnly(d.momentumEntriesOnly)
    setTrailing(d.enableTrailingStop)
  }

  const submit = async () => {
    setError(null)
    const startTime = new Date(`${from}T00:00:00.000Z`).getTime()
    // "To" = end of that day, but never later than now (no candles exist yet).
    const endTime = Math.min(new Date(`${to}T23:59:59.999Z`).getTime(), Date.now())
    if (!(startTime > 0) || !(endTime > startTime)) {
      setError("The start date must be before the end date (and in the past).")
      return
    }
    const nums = { capital: Number(capital), leverage: Number(leverage), risk: Number(risk), dailyLoss: Number(dailyLoss) }
    if (!(nums.capital > 0)) return setError("Capital per trade must be greater than 0.")
    if (!(nums.leverage >= 1)) return setError("Leverage must be at least 1x.")
    if (riskStyle === "SAFE" && !(nums.risk > 0)) return setError("Max risk / trade must be greater than 0%.")
    if (!(nums.dailyLoss >= 0)) return setError("Daily loss limit must be 0% or more.")

    const config: BacktestConfig = {
      symbol: symbol.trim().toUpperCase(),
      strategy,
      timeframe: info.fixedTimeframe ?? timeframe,
      startTime,
      endTime,
      initialCapital: nums.capital,
      capitalMode: "fixed",
      leverage: nums.leverage,
      riskStyle,
      maxRiskPerTrade: nums.risk > 0 ? nums.risk : 1,
      dailyLossLimit: nums.dailyLoss,
      // Trend Breakout always uses its own candle-channel trailing stop.
      enableTrailingStop: isBreakout ? false : trailing,
      trailingDistancePercent: !isBreakout && trailing ? Number(trailingDist) : 0,
      momentumEntriesOnly: info.supportsMomentumFilter && momentumOnly,
      description: name.trim() || undefined,
    }

    try {
      setSubmitting(true)
      await apiSend("/api/analytics/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      toast.success("Backtest started — it runs in the background. Progress and the result appear in the Backtests list.")
      onCreated()
      onOpenChange(false)
    } catch (e) {
      setError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run Backtest</DialogTitle>
          <DialogDescription>See how a bot with these settings would have traded on past prices.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <StrategyPicker id="backtest-strategy" value={strategy} onChange={pickStrategy} />
            <p className="mt-1 rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              Recommended settings applied: {info.defaults.note} You can still change them below.
            </p>
          </div>

          <div className="col-span-2">
            <Field label="Symbol">
              <CoinSearchSelect value={symbol} onChange={setSymbol} />
            </Field>
          </div>

          <Field label="Timeframe">
            <select className={inputClass} value={info.fixedTimeframe ?? timeframe} onChange={(e) => setTimeframe(e.target.value)} disabled={Boolean(info.fixedTimeframe)}>
              <option value="15m">15m</option>
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </Field>
          <Field label="Leverage">
            <Input className={inputClass} type="number" min="1" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
          </Field>

          <Field label="From">
            <DatePicker
              value={from}
              maxDate={to}
              placeholder="From date"
              onChange={(value) => {
                setFrom(value ?? "")
                if (value && to && value > to) setTo(value)
              }}
            />
          </Field>
          <Field label="To">
            <DatePicker
              value={to}
              minDate={from}
              maxDate={today()}
              placeholder="To date"
              onChange={(value) => {
                setTo(value ?? "")
                if (value && from && from > value) setFrom(value)
              }}
            />
          </Field>

          <div className="col-span-2">
            <Field label="Capital per trade (USDT)" hint="The amount the bot trades with — the backtest starts with this as its wallet.">
              <Input className={inputClass} type="number" min="1" value={capital} onChange={(e) => setCapital(e.target.value)} />
            </Field>
          </div>

          <div className="col-span-2 grid grid-cols-1 md:grid-cols-2">
            <RiskStylePicker value={riskStyle} onChange={setRiskStyle} timeframe={info.fixedTimeframe ?? timeframe} symbol={symbol || null} showMarket={false} />
          </div>

          <Field
            label="Max risk / trade (%)"
            hint={riskStyle === "RISKY" ? "Not used in Risky style — the whole amount is used." : "Most of the amount a stop-loss hit may lose."}
          >
            <Input className={inputClass} type="number" step="0.1" min="0.1" value={risk} onChange={(e) => setRisk(e.target.value)} disabled={riskStyle === "RISKY"} />
          </Field>
          <Field label="Daily loss limit (%)" hint="Stops new trades for the day after this loss.">
            <Input className={inputClass} type="number" step="0.1" min="0" value={dailyLoss} onChange={(e) => setDailyLoss(e.target.value)} />
          </Field>

          {info.supportsMomentumFilter && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={momentumOnly} onChange={(e) => setMomentumOnly(e.target.checked)} />
              Strong-momentum entries only
            </label>
          )}
          {!isBreakout && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={trailing} onChange={(e) => setTrailing(e.target.checked)} />
              Enable trailing stop
            </label>
          )}
          {!isBreakout && trailing && (
            <Field label="Trailing distance (%)">
              <Input className={inputClass} type="number" step="0.1" min="0.1" value={trailingDist} onChange={(e) => setTrailingDist(e.target.value)} />
            </Field>
          )}

          <div className="col-span-2">
            <Field label="Name (optional)">
              <Input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Breakout on BTC, last 3 months" />
            </Field>
          </div>

          <p className="col-span-2 text-[11px] leading-relaxed text-muted-foreground">
            Uses exchange-like trading fees (0.05% per side) and a cautious rule: if one candle touches both the stop-loss and the take-profit, it
            counts as a stop-loss. The backtest runs in the background — long periods can take a few minutes; you can close this window.
          </p>
        </div>

        {error != null && <ErrorState error={error} title="Couldn't start the backtest" />}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Starting…" : "Run Backtest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
