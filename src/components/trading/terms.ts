"use client";

export type OrderSide = "BUY" | "SELL";

export function sideLabel(side: OrderSide | string): string {
  if (side === "BUY") return "Long";
  if (side === "SELL") return "Short";
  return String(side ?? "—");
}

export function sideBadgeClass(side: OrderSide | string): string {
  return side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400";
}

export function positionSideLabel(positionSide: "LONG" | "SHORT" | string): string {
  if (positionSide === "LONG") return "Long";
  if (positionSide === "SHORT") return "Short";
  return String(positionSide ?? "—");
}

export function orderTypeLabel(orderType: string | null | undefined): string {
  if (!orderType) return "—";
  const t = String(orderType).toUpperCase();
  if (t.includes("TAKE_PROFIT")) return "Take Profit";
  if (t.includes("STOP")) return "Stop Loss";
  if (t === "LIMIT") return "Limit";
  if (t === "MARKET") return "Market";
  if (t === "CLOSE_POSITION" || t.includes("CLOSE")) return "Close";
  return orderType;
}

export function orderContextLabel(context: string | null | undefined): string {
  if (!context) return "—";
  const c = String(context).toLowerCase();
  if (c.includes("take_profit") || c.includes("tp")) return "Take Profit";
  if (c.includes("stop_loss") || c.includes("sl")) return "Stop Loss";
  if (c === "entry") return "Entry";
  if (c.includes("close")) return "Close";
  return context;
}
