"use client";

import { useEffect, useState } from "react";

interface InstrumentInfo {
  min_base_quantity: string;
  base_quantity_step_size: string;
  quantity_precision: number;
  price_precision: number;
  min_leverage: string;
  max_leverage: string;
}

type OrderType = "MARKET" | "LIMIT";
type Side = "BUY" | "SELL";

type Phase =
  | { status: "idle" }
  | { status: "submitting"; step: string }
  | { status: "polling"; orderId: string; currentStatus: string }
  | { status: "done"; summary: string }
  | { status: "error"; message: string };

function roundToStep(value: number, step: number, precision: number): number {
  if (step <= 0) return Number(value.toFixed(precision));
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(precision));
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
  const [available, setAvailable] = useState<number | null>(null);

  const [leverage, setLeverage] = useState<number>(1);
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

  useEffect(() => {
    fetch(`/api/coinswitch/futures/instrument-info`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setInstrument(json.data[symbol] ?? null);
      })
      .catch(() => {});

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
      .catch(() => {});

    fetch(`/api/coinswitch/futures/leverage?symbol=${symbol}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setLeverage(Number(json.data.leverage));
      })
      .catch(() => {});
  }, [symbol]);

  useEffect(() => {
    if (!available || !markPrice || !instrument) {
      setQuantity(0);
      return;
    }

    const notional = available * (pct / 100) * leverage;
    const rawQty = notional / markPrice;

    const step = Number(instrument.base_quantity_step_size);
    const precision = instrument.quantity_precision > 0 ? instrument.quantity_precision : 0;

    setQuantity(roundToStep(rawQty, step, precision));
  }, [available, markPrice, leverage, pct, instrument]);

  const effectiveQuantity = useManualQuantity ? Number(manualQuantity) : quantity;

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

  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await fetch(`/api/coinswitch/futures/order-status?order_id=${orderId}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message ?? "status check failed");

    lastStatus = json.data.status;
    setPhase({ status: "polling", orderId, currentStatus: lastStatus });

    if (TERMINAL.includes(lastStatus)) return lastStatus;
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Order is still open (e.g. a LIMIT order far from market) — not a failure,
  // just still working. Caller can decide whether to keep it open or cancel.
  return lastStatus;
}

  async function submitOrder() {
    if (!effectiveQuantity || effectiveQuantity <= 0) {
      setPhase({
        status: "error",
        message: useManualQuantity
          ? "Enter a valid manual quantity"
          : "Quantity is 0 — check wallet balance / % allocation, or use manual quantity",
      });
      return;
    }
    if (instrument && effectiveQuantity < Number(instrument.min_base_quantity)) {
      setPhase({
        status: "error",
        message: `Quantity ${effectiveQuantity} is below minimum ${instrument.min_base_quantity}`,
      });
      return;
    }
    if (orderType === "LIMIT" && (!limitPrice || Number(limitPrice) <= 0)) {
      setPhase({ status: "error", message: "Enter a valid limit price" });
      return;
    }
    if (slEnabled && !slPrice) {
      setPhase({ status: "error", message: "Enter a stop-loss trigger price" });
      return;
    }
    if (tpEnabled && !tpPrice) {
      setPhase({ status: "error", message: "Enter a take-profit trigger price" });
      return;
    }

try {
  // Per CoinSwitch support: the "subaccount association" for a symbol is
  // only created once you call the Leverage endpoint for it. We call this
  // every time, right before placing an order, so a first-time symbol
  // never hits "subaccount association not found" again.
  setPhase({ status: "submitting", step: "Setting leverage…" });

  const leverageRes = await fetch("/api/coinswitch/futures/leverage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, leverage }),
  });
  const leverageJson = await leverageRes.json();

  if (!leverageJson.success) {
    throw new Error(
      `Failed to set leverage before placing order: ${leverageJson.message ?? "unknown error"}`
    );
  }

  setPhase({ status: "submitting", step: "Placing entry order…" });

  const entryPayload: Record<string, any> = {
    symbol,
    side,
    order_type: orderType,
    quantity: effectiveQuantity,
  };
  if (orderType === "LIMIT") entryPayload.price = Number(limitPrice);

  const entry = await placeOrder(entryPayload);
      const finalStatus = await pollUntilTerminal(entry.order_id);

if (finalStatus === "RAISED") {
  setPhase({
    status: "done",
    summary: `Order placed and still open (RAISED) — order_id ${entry.order_id}. It hasn't filled yet since the price hasn't been reached. SL/TP will be set once it fills.`,
  });
  return;
}

if (finalStatus !== "EXECUTED" && finalStatus !== "PARTIALLY_EXECUTED") {
  setPhase({
    status: "done",
    summary: `Entry order ${finalStatus.toLowerCase().replace("_", " ")} — no SL/TP placed`,
  });
  return;
}

      const closingSide: Side = side === "BUY" ? "SELL" : "BUY";
      const placedExtras: string[] = [];

      if (slEnabled) {
        setPhase({ status: "submitting", step: "Placing stop-loss…" });
        await placeOrder({
          symbol,
          side: closingSide,
          order_type: "STOP_MARKET",
          quantity: 0,
          trigger_price: Number(slPrice),
          reduce_only: true,
        });
        placedExtras.push(`SL @ ${slPrice}`);
      }

      if (tpEnabled) {
        setPhase({ status: "submitting", step: "Placing take-profit…" });
        await placeOrder({
          symbol,
          side: closingSide,
          order_type: "TAKE_PROFIT_MARKET",
          quantity: 0,
          trigger_price: Number(tpPrice),
          reduce_only: true,
        });
        placedExtras.push(`TP @ ${tpPrice}`);
      }

      setPhase({
        status: "done",
        summary: `Entry ${finalStatus.toLowerCase().replace("_", " ")}${
          placedExtras.length ? " — " + placedExtras.join(", ") + " set" : ""
        }`,
      });
    } catch (err: any) {
      setPhase({ status: "error", message: err.message });
    }
  }

  const busy = phase.status === "submitting" || phase.status === "polling";

  return (
    <div className="bg-zinc-900 rounded-xl p-5">
      <h2 className="text-xl font-bold mb-5">Place Order</h2>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSide("BUY")}
          className={`flex-1 py-2 rounded font-semibold ${side === "BUY" ? "bg-green-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
        >
          Buy / Long
        </button>
        <button
          onClick={() => setSide("SELL")}
          className={`flex-1 py-2 rounded font-semibold ${side === "SELL" ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
        >
          Sell / Short
        </button>
      </div>

      <div className="flex gap-2 mb-4 text-sm">
        <button
          onClick={() => setOrderType("MARKET")}
          className={`flex-1 py-1.5 rounded ${orderType === "MARKET" ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-500"}`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType("LIMIT")}
          className={`flex-1 py-1.5 rounded ${orderType === "LIMIT" ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-500"}`}
        >
          Limit
        </button>
      </div>

      {orderType === "LIMIT" && (
        <>
          <label className="text-xs text-zinc-500">Limit Price (USDT)</label>
          <input
            type="number"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            className="w-full mt-1 mb-3 bg-zinc-800 text-white rounded px-3 py-2 outline-none"
          />
        </>
      )}

      <label className="text-xs text-zinc-500">
        Leverage {instrument && `(max ${instrument.max_leverage}x)`}
      </label>
      <div className="flex items-center gap-2 mt-1 mb-1">
        <input
          type="range"
          min={instrument ? Number(instrument.min_leverage) : 1}
          max={instrument ? Number(instrument.max_leverage) : 25}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          onMouseUp={(e) => updateLeverage(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => updateLeverage(Number((e.target as HTMLInputElement).value))}
          className="flex-1"
        />
        <span className="text-white font-semibold w-12 text-right">{leverage}x</span>
      </div>
      {leverageSaving && <p className="text-xs text-zinc-500 mb-2">Updating leverage…</p>}
      {leverageError && (
        <p className="text-xs text-red-400 mb-2">
          {leverageError} — leverage can't change with an open position/order on this symbol.
        </p>
      )}

      <div className="border-t border-zinc-800 pt-3 mt-3 mb-2">
        <label className="flex items-center gap-2 text-sm text-zinc-300 mb-2">
          <input
            type="checkbox"
            checked={useManualQuantity}
            onChange={(e) => setUseManualQuantity(e.target.checked)}
          />
          Enter quantity manually (wallet balance unavailable)
        </label>

        {useManualQuantity && (
          <input
            type="number"
            value={manualQuantity}
            onChange={(e) => setManualQuantity(e.target.value)}
            placeholder={instrument ? `min ${instrument.min_base_quantity}` : "0.00"}
            className="w-full mb-3 bg-zinc-800 text-white rounded px-3 py-2 outline-none text-sm"
          />
        )}
      </div>

      <div className={useManualQuantity ? "opacity-40 pointer-events-none" : ""}>
        <label className="text-xs text-zinc-500 mt-2 block">
          Position Size — {pct}% of available balance
          {available !== null && (
            <span className="text-zinc-600"> (${available.toFixed(2)} available)</span>
          )}
        </label>
        <div className="flex gap-2 mt-1 mb-2">
          {[10, 25, 50, 75, 100].map((p) => (
            <button
              key={p}
              onClick={() => setPct(p)}
              className={`flex-1 py-1 rounded text-xs ${pct === p ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-500"}`}
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
          className="w-full mb-3"
        />
      </div>

      <div className="bg-zinc-800 rounded p-3 mb-4 text-sm">
        <div className="flex justify-between text-zinc-400">
          <span>Quantity</span>
          <span className="text-white font-semibold">
            {effectiveQuantity || "—"} {symbol.replace("USDT", "")}
          </span>
        </div>
        {instrument && (
          <div className="text-zinc-600 text-xs mt-1">
            min {instrument.min_base_quantity}, step {instrument.base_quantity_step_size}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-3 mb-2">
        <label className="flex items-center gap-2 text-sm text-zinc-300 mb-2">
          <input type="checkbox" checked={slEnabled} onChange={(e) => setSlEnabled(e.target.checked)} />
          Stop Loss
        </label>
        {slEnabled && (
          <input
            type="number"
            value={slPrice}
            onChange={(e) => setSlPrice(e.target.value)}
            placeholder="Trigger price (USDT)"
            className="w-full mb-3 bg-zinc-800 text-white rounded px-3 py-2 outline-none text-sm"
          />
        )}

        <label className="flex items-center gap-2 text-sm text-zinc-300 mb-2">
          <input type="checkbox" checked={tpEnabled} onChange={(e) => setTpEnabled(e.target.checked)} />
          Take Profit
        </label>
        {tpEnabled && (
          <input
            type="number"
            value={tpPrice}
            onChange={(e) => setTpPrice(e.target.value)}
            placeholder="Trigger price (USDT)"
            className="w-full mb-3 bg-zinc-800 text-white rounded px-3 py-2 outline-none text-sm"
          />
        )}
      </div>

      <button
        onClick={submitOrder}
        disabled={busy}
        className={`w-full py-3 rounded font-bold text-white disabled:opacity-50 ${side === "BUY" ? "bg-green-600" : "bg-red-600"}`}
      >
        {busy ? "Placing…" : `${side === "BUY" ? "Buy" : "Sell"} ${symbol.replace("USDT", "")}`}
      </button>

      <div className="mt-4 text-sm">
        {phase.status === "submitting" && <p className="text-yellow-400">{phase.step}</p>}
        {phase.status === "polling" && (
          <p className="text-yellow-400">Status: {phase.currentStatus} — checking again…</p>
        )}
        {phase.status === "done" && <p className="text-emerald-400">{phase.summary}</p>}
        {phase.status === "error" && <p className="text-red-400">{phase.message}</p>}
      </div>
    </div>
  );
}