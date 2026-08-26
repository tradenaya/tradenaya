"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface InstrumentInfo {
  min_base_quantity: string;
  max_base_quantity?: string;
  base_quantity_step_size: string;
  quantity_precision: number;
  price_precision: number;
  min_leverage: string;
  max_leverage: string;
  taker_fee_rate?: string;
  maker_fee_rate?: string;
}

type OrderType = "MARKET" | "LIMIT";
type Side = "BUY" | "SELL";

type Phase =
  | { status: "idle" }
  | { status: "submitting"; step: string }
  | { status: "polling"; orderId: string; currentStatus: string }
  | { status: "done"; summary: string }
  | { status: "error"; message: string };

function floorToStep(value: number, step: number, precision: number): number {
  if (!Number.isFinite(step) || step <= 0) return Number(value.toFixed(precision));
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(precision));
}

function roundToPrice(value: number, precision: number): number {
  if (!Number.isFinite(precision) || precision < 0) return value;
  return Number(value.toFixed(precision));
}

function toNum(value: string): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function PlaceOrderPanel({
  symbol,
  markPrice,
}: {
  symbol: string;
  markPrice: number | null;
}) {
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [limitPrice, setLimitPrice] = useState("");

  const [instrument, setInstrument] = useState<InstrumentInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [available, setAvailable] = useState<number | null>(null);

  const [leverage, setLeverage] = useState<number>(1);
  const [savedLeverage, setSavedLeverage] = useState<number>(1);
  const [leverageSaving, setLeverageSaving] = useState(false);
  const [leverageError, setLeverageError] = useState<string | null>(null);

  const [pct, setPct] = useState(25);
  const [quantity, setQuantity] = useState(0);

  const [useManualQuantity, setUseManualQuantity] = useState(false);
  const [manualQuantity, setManualQuantity] = useState("");

  const [slEnabled, setSlEnabled] = useState(false);
  const [tpEnabled, setTpEnabled] = useState(false);
  const [slPrice, setSlPrice] = useState("");
  const [tpPrice, setTpPrice] = useState("");

  const [phase, setPhase] = useState<Phase>({ status: "idle" });

  const refreshBalance = useCallback(() => {
    fetch(`/api/coinswitch/futures/wallet-balance`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const usdt = json.data.base_asset_balances?.find(
            (b: any) => b.base_asset === "USDT"
          );
          setAvailable(usdt ? Number(usdt.balances.total_available_balance) : 0);
        }
      })
      .catch(() => {
        setAvailable(null);
      });
  }, []);

  useEffect(() => {
    setLoadError(null);
    let cancelled = false;

    fetch(`/api/coinswitch/futures/instrument-info`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setInstrument(json.data[symbol] ?? null);
        } else {
          setLoadError(json.message ?? "Failed to load instrument info");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load instrument info");
      });

    refreshBalance();

    fetch(`/api/coinswitch/futures/leverage?symbol=${symbol}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          const saved = Number(json.data.leverage);
          if (Number.isFinite(saved) && saved > 0) {
            setLeverage(saved);
            setSavedLeverage(saved);
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [symbol, refreshBalance]);

  useEffect(() => {
    if (!available || !markPrice || !instrument) {
      setQuantity(0);
      return;
    }

    const notional = available * (pct / 100) * leverage;
    const rawQty = notional / markPrice;

    const step = Number(instrument.base_quantity_step_size);
    const precision = instrument.quantity_precision > 0 ? instrument.quantity_precision : 0;

    setQuantity(floorToStep(rawQty, step, precision));
  }, [available, markPrice, leverage, pct, instrument]);

  const effectiveQuantity = useMemo(() => {
    if (!useManualQuantity) return quantity;
    const step = instrument ? Number(instrument.base_quantity_step_size) : NaN;
    const precision = instrument && instrument.quantity_precision > 0 ? instrument.quantity_precision : 0;
    const parsed = toNum(manualQuantity);
    if (parsed == null || !Number.isFinite(step) || step <= 0) return parsed ?? 0;
    return floorToStep(parsed, step, precision);
  }, [useManualQuantity, manualQuantity, instrument, quantity]);

  const stepSize = instrument ? Number(instrument.base_quantity_step_size) : null;
  const pricePrecision = instrument && instrument.price_precision > 0 ? instrument.price_precision : null;

  const entryPrice = orderType === "LIMIT" ? toNum(limitPrice) ?? (pricePrecision != null ? roundToPrice(toNum(limitPrice) ?? 0, pricePrecision) : null) : markPrice;
  const priceForMargin = entryPrice ?? markPrice ?? 0;

  const notional = effectiveQuantity > 0 && priceForMargin > 0 ? effectiveQuantity * priceForMargin : null;
  const marginNeeded = notional != null && leverage > 0 ? notional / leverage : null;
  const takerFeeRate = instrument ? Number(instrument.taker_fee_rate ?? instrument.maker_fee_rate ?? 0) : null;
  const estFee = notional != null && takerFeeRate != null && takerFeeRate > 0 ? notional * takerFeeRate : null;

  const maxQty = instrument && toNum(instrument.max_base_quantity ?? "") != null ? toNum(instrument.max_base_quantity!) : null;
  const minQty = instrument ? Number(instrument.min_base_quantity) : null;

  const validationErrors: string[] = [];
  if (effectiveQuantity <= 0) {
    validationErrors.push(useManualQuantity ? "Enter a valid manual quantity." : "Quantity is 0 — check wallet balance / % allocation.");
  } else {
    if (minQty != null && Number.isFinite(minQty) && effectiveQuantity < minQty) {
      validationErrors.push(`Quantity ${effectiveQuantity} is below the minimum ${minQty}.`);
    }
    if (maxQty != null && Number.isFinite(maxQty) && effectiveQuantity > maxQty) {
      validationErrors.push(`Quantity ${effectiveQuantity} exceeds the maximum ${maxQty}.`);
    }
    if (marginNeeded != null && available != null && available >= 0 && marginNeeded > available) {
      validationErrors.push(
        `Margin needed ${marginNeeded.toFixed(2)} USDT exceeds available balance ${available.toFixed(2)} USDT.`,
      );
    }
  }
  if (orderType === "LIMIT") {
    const limit = toNum(limitPrice);
    if (limit == null || limit <= 0) {
      validationErrors.push("Enter a valid limit price.");
    }
  }
  if (slEnabled) {
    const sl = toNum(slPrice);
    if (sl == null || sl <= 0) {
      validationErrors.push("Enter a valid stop-loss trigger price.");
    } else if (markPrice) {
      if (side === "BUY" && sl >= markPrice) validationErrors.push("Stop-loss must be below the current price for a long.");
      if (side === "SELL" && sl <= markPrice) validationErrors.push("Stop-loss must be above the current price for a short.");
    }
  }
  if (tpEnabled) {
    const tp = toNum(tpPrice);
    if (tp == null || tp <= 0) {
      validationErrors.push("Enter a valid take-profit trigger price.");
    } else if (markPrice) {
      if (side === "BUY" && tp <= markPrice) validationErrors.push("Take-profit must be above the current price for a long.");
      if (side === "SELL" && tp >= markPrice) validationErrors.push("Take-profit must be below the current price for a short.");
    }
  }
  if (slEnabled && tpEnabled) {
    const sl = toNum(slPrice);
    const tp = toNum(tpPrice);
    if (sl != null && tp != null && ((side === "BUY" && tp <= sl) || (side === "SELL" && tp >= sl))) {
      validationErrors.push("Take-profit must be on the opposite side of the stop-loss.");
    }
  }

  const busy = phase.status === "submitting" || phase.status === "polling";

  async function updateLeverage(newLeverage: number) {
    setLeverageSaving(true);
    setLeverageError(null);
    try {
      const res = await fetch("/api/coinswitch/futures/leverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, leverage: newLeverage }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "failed to update leverage");
      setLeverage(newLeverage);
      setSavedLeverage(newLeverage);
    } catch (err: any) {
      setLeverageError(err.message);
    } finally {
      setLeverageSaving(false);
    }
  }

  async function placeOrder(payload: Record<string, any>) {
    const res = await fetch("/api/coinswitch/futures/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message ?? "order failed");
    return json.data;
  }

  async function pollUntilTerminal(orderId: string) {
    const TERMINAL = ["EXECUTED", "PARTIALLY_EXECUTED", "CANCELLED"];
    let lastStatus = "RAISED";

    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const res = await fetch(`/api/coinswitch/futures/order-status?order_id=${orderId}`);
        const json = await res.json();
        if (json.success) {
          lastStatus = json.data.status ?? lastStatus;
          setPhase({ status: "polling", orderId, currentStatus: lastStatus });
          if (TERMINAL.includes(lastStatus)) return lastStatus;
        }
      } catch {
        // transient network failure — keep the last known status and retry
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    return lastStatus;
  }

  async function submitOrder() {
    if (validationErrors.length > 0) {
      setPhase({ status: "error", message: validationErrors[0] });
      return;
    }

    try {
      setPhase({ status: "submitting", step: "Placing entry order…" });

      // Only touch leverage when it actually changed — the exchange refuses
      // leverage changes while a position/open order exists on the symbol.
      if (leverage !== savedLeverage) {
        setPhase({ status: "submitting", step: "Setting leverage…" });
        const leverageRes = await fetch("/api/coinswitch/futures/leverage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, leverage }),
        });
        const leverageJson = await leverageRes.json();
        if (!leverageJson.success) {
          setPhase({
            status: "error",
            message: `Failed to update leverage to ${leverage}x: ${leverageJson.message ?? "unknown error"}. It cannot change while a position or open order exists on ${symbol}.`,
          });
          return;
        }
        setSavedLeverage(leverage);
      }

      const entryPayload: Record<string, any> = {
        symbol,
        side,
        order_type: orderType,
        quantity: effectiveQuantity,
        order_context: "entry",
      };
      if (orderType === "LIMIT") {
        entryPayload.price = pricePrecision != null ? roundToPrice(toNum(limitPrice)!, pricePrecision) : Number(limitPrice);
      }

      const entry = await placeOrder(entryPayload);
      const finalStatus = await pollUntilTerminal(entry.order_id);

      if (finalStatus === "RAISED") {
        refreshBalance();
        setPhase({
          status: "done",
          summary: `Order placed and still open (RAISED) — order_id ${entry.order_id}. It hasn't filled yet since the price hasn't been reached. SL/TP will be set once it fills.`,
        });
        return;
      }

      if (finalStatus !== "EXECUTED" && finalStatus !== "PARTIALLY_EXECUTED") {
        refreshBalance();
        setPhase({
          status: "done",
          summary: `Entry order ${finalStatus.toLowerCase().replace("_", " ")} — no SL/TP placed`,
        });
        return;
      }

      const closingSide: Side = side === "BUY" ? "SELL" : "BUY";
      const placedExtras: string[] = [];
      let slPlaced = false;
      let tpPlaced = false;

      if (slEnabled) {
        setPhase({ status: "submitting", step: "Placing stop-loss…" });
        try {
          await placeOrder({
            symbol,
            side: closingSide,
            order_type: "STOP_MARKET",
            quantity: 0,
            trigger_price: pricePrecision != null ? roundToPrice(toNum(slPrice)!, pricePrecision) : Number(slPrice),
            reduce_only: true,
            order_context: "stop_loss",
          });
          slPlaced = true;
          placedExtras.push(`SL @ ${slPrice}`);
        } catch (err: any) {
          placedExtras.push(`SL FAILED: ${err.message}`);
        }
      }

      if (tpEnabled) {
        setPhase({ status: "submitting", step: "Placing take-profit…" });
        try {
          await placeOrder({
            symbol,
            side: closingSide,
            order_type: "TAKE_PROFIT_MARKET",
            quantity: 0,
            trigger_price: pricePrecision != null ? roundToPrice(toNum(tpPrice)!, pricePrecision) : Number(tpPrice),
            reduce_only: true,
            order_context: "take_profit",
          });
          tpPlaced = true;
          placedExtras.push(`TP @ ${tpPrice}`);
        } catch (err: any) {
          placedExtras.push(`TP FAILED: ${err.message}`);
        }
      }

      refreshBalance();

      if ((slEnabled && !slPlaced) || (tpEnabled && !tpPlaced)) {
        setPhase({
          status: "error",
          message: `Entry ${finalStatus.toLowerCase().replace("_", " ")}. ${placedExtras.join("; ")}. Fix any failed order and set it manually.`,
        });
        return;
      }

      setPhase({
        status: "done",
        summary: `Entry ${finalStatus.toLowerCase().replace("_", " ")}${
          placedExtras.length ? " — " + placedExtras.join(", ") + " set" : ""
        }`,
      });
    } catch (err: any) {
      refreshBalance();
      setPhase({ status: "error", message: err.message });
    }
  }

  const sideTabCls = (active: boolean, color: "emerald" | "red") =>
    cn(
      "flex-1 py-2 rounded-lg font-semibold transition-colors",
      active
        ? color === "emerald"
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-red-500/15 text-red-400"
        : "bg-muted text-muted-foreground hover:bg-muted/80"
    );

  const typeTabCls = (active: boolean) =>
    cn(
      "flex-1 py-1.5 rounded text-sm font-medium transition-colors",
      active ? "bg-card text-foreground shadow-sm" : "bg-muted text-muted-foreground"
    );

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle className="text-xl font-bold">Place Order</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="flex gap-2">
          <button onClick={() => setSide("BUY")} className={sideTabCls(side === "BUY", "emerald")}>
            Buy / Long
          </button>
          <button onClick={() => setSide("SELL")} className={sideTabCls(side === "SELL", "red")}>
            Sell / Short
          </button>
        </div>

        <div className="flex gap-2 text-sm">
          <button onClick={() => setOrderType("MARKET")} className={typeTabCls(orderType === "MARKET")}>
            Market
          </button>
          <button onClick={() => setOrderType("LIMIT")} className={typeTabCls(orderType === "LIMIT")}>
            Limit
          </button>
        </div>

        {orderType === "LIMIT" && (
          <div className="space-y-1.5">
            <Label htmlFor="order-limit">Limit Price (USDT)</Label>
            <Input
              id="order-limit"
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={pricePrecision != null ? `0.${"0".repeat(Math.min(pricePrecision, 8))}` : "0.00"}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="order-leverage">
            Leverage {instrument && `(max ${instrument.max_leverage}x)`}
          </Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={instrument ? Number(instrument.min_leverage) : 1}
              max={instrument ? Number(instrument.max_leverage) : 25}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              onMouseUp={(e) => updateLeverage(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => updateLeverage(Number((e.target as HTMLInputElement).value))}
              className="flex-1 accent-emerald-500"
            />
            <span className="w-12 text-right font-semibold text-foreground">{leverage}x</span>
          </div>
          {leverageSaving && <p className="text-xs text-muted-foreground">Updating leverage…</p>}
          {leverageError && (
            <p className="text-xs text-red-400">
              {leverageError} — leverage can&apos;t change with an open position/order on this symbol.
            </p>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={useManualQuantity}
              onChange={(e) => setUseManualQuantity(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Enter quantity manually
          </label>

          {useManualQuantity && (
            <Input
              type="number"
              value={manualQuantity}
              onChange={(e) => setManualQuantity(e.target.value)}
              placeholder={instrument ? `min ${instrument.min_base_quantity}` : "0.00"}
            />
          )}
          {useManualQuantity && stepSize != null && (
            <p className="text-xs text-muted-foreground">
              Will be rounded down to the step size {stepSize}
            </p>
          )}
        </div>

        <div className={cn("space-y-2", useManualQuantity && "pointer-events-none opacity-40")}>
          <Label>
            Position Size — {pct}% of available balance
            {available !== null && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({available.toFixed(2)} USDT available)
              </span>
            )}
          </Label>
          <div className="flex gap-2">
            {[10, 25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => setPct(p)}
                className={cn(
                  "flex-1 rounded py-1 text-xs transition-colors",
                  pct === p
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {p}%
              </button>
            ))}
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </div>

        <div className="rounded-lg bg-muted p-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Quantity</span>
            <span className="font-semibold text-foreground">
              {effectiveQuantity || "—"} {symbol.replace("USDT", "")}
            </span>
          </div>
          {notional != null && (
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>Notional</span>
              <span>{notional.toFixed(2)} USDT</span>
            </div>
          )}
          {marginNeeded != null && (
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>Margin needed @ {leverage}x</span>
              <span className={available != null && marginNeeded > available ? "text-red-400" : ""}>
                {marginNeeded.toFixed(2)} USDT
              </span>
            </div>
          )}
          {estFee != null && estFee > 0 && (
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>Est. entry fee ({((takerFeeRate ?? 0) * 100).toFixed(3)}%)</span>
              <span>{estFee.toFixed(4)} USDT</span>
            </div>
          )}
          {instrument && (
            <div className="mt-1 text-xs text-muted-foreground">
              min {instrument.min_base_quantity}, step {instrument.base_quantity_step_size}
              {instrument.max_base_quantity ? `, max ${instrument.max_base_quantity}` : ""}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={slEnabled}
              onChange={(e) => setSlEnabled(e.target.checked)}
              className="h-4 w-4 accent-red-500"
            />
            Stop Loss
          </label>
          {slEnabled && (
            <Input
              type="number"
              value={slPrice}
              onChange={(e) => setSlPrice(e.target.value)}
              placeholder={markPrice ? (side === "BUY" ? `Below ${markPrice.toFixed(pricePrecision ?? 2)}` : `Above ${markPrice.toFixed(pricePrecision ?? 2)}`) : "Trigger price (USDT)"}
            />
          )}

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={tpEnabled}
              onChange={(e) => setTpEnabled(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Take Profit
          </label>
          {tpEnabled && (
            <Input
              type="number"
              value={tpPrice}
              onChange={(e) => setTpPrice(e.target.value)}
              placeholder={markPrice ? (side === "BUY" ? `Above ${markPrice.toFixed(pricePrecision ?? 2)}` : `Below ${markPrice.toFixed(pricePrecision ?? 2)}`) : "Trigger price (USDT)"}
            />
          )}
        </div>

        {loadError && <p className="text-xs text-amber-400">{loadError}</p>}
        {validationErrors.length > 0 && (
          <div className="space-y-1">
            {validationErrors.map((err) => (
              <p key={err} className="text-xs text-red-400">
                {err}
              </p>
            ))}
          </div>
        )}

        <Button
          onClick={submitOrder}
          disabled={busy || (validationErrors.length > 0 && effectiveQuantity <= 0)}
          className={cn(
            "w-full py-3 text-base font-bold",
            side === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
          )}
        >
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Placing…" : `${side === "BUY" ? "Buy" : "Sell"} ${symbol.replace("USDT", "")}`}
        </Button>

        <div className="space-y-1 text-sm">
          {phase.status === "submitting" && <p className="text-amber-400">{phase.step}</p>}
          {phase.status === "polling" && (
            <p className="text-amber-400">Status: {phase.currentStatus} — checking again…</p>
          )}
          {phase.status === "done" && <p className="text-emerald-400">{phase.summary}</p>}
          {phase.status === "error" && <p className="text-red-400">{phase.message}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
