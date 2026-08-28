/**
 * Client-side trade preview calculator.
 *
 * Mirrors the backend position-sizing and risk formulas so the user sees
 * an accurate estimate *before* enabling the bot. All values are estimates
 * because the actual SL/TP are computed at runtime by the strategy pipeline
 * based on live ATR, support/resistance, etc.
 */

/* ------------------------------------------------------------------ */
/*  Inputs                                                            */
/* ------------------------------------------------------------------ */

export interface TradePreviewInput {
  walletBalance: number | null;
  capitalMode: "fixed" | "percent";
  capital: number;
  walletPercent: number | null;
  leverage: number;
  maxRiskPerTradePct: number;
  currentPrice: number | null;
  /** Estimated ATR as a fraction of price (e.g. 0.01 = 1%). */
  estimatedAtrPct?: number;
  /** Minimum stop-distance fraction used by the planner (default 0.008 = 0.8%). */
  minStopDistancePct?: number;
  /** Min risk/reward ratio used by the TP planner (default 2). */
  minRiskRewardRatio?: number;
}

/* ------------------------------------------------------------------ */
/*  Output                                                            */
/* ------------------------------------------------------------------ */

export interface TradePreview {
  /* Capital allocation */
  walletAvailable: number | null;
  allocatedCapital: number;
  positionNotional: number;
  margin: number;

  /* Risk */
  maxRiskPct: number;
  maxRiskUsdt: number;
  slDistancePct: number;
  slPrice: number;
  estimatedLoss: number;
  riskCompatible: boolean;
  riskExceededBy: number;

  /* Reward */
  tpDistancePct: number;
  tpPrice: number;
  estimatedProfit: number;
  riskRewardRatio: number;

  /* Position sizing */
  riskBasedSize: number;
  capitalCappedSize: number;
  bindingConstraint: "risk" | "none";

  /* Status */
  status: "safe" | "warning" | "error";
  message: string;
  /** Human-readable explanation of the capital/risk relationship */
  capitalRiskNote: string;
}

/* ------------------------------------------------------------------ */
/*  Calculator                                                        */
/* ------------------------------------------------------------------ */

export function computeTradePreview(input: TradePreviewInput): TradePreview {
  const {
    walletBalance,
    capitalMode,
    capital,
    walletPercent,
    leverage,
    maxRiskPerTradePct,
    currentPrice,
    estimatedAtrPct = 0.01,
    minStopDistancePct = 0.008,
    minRiskRewardRatio = 2,
  } = input;

  const price = currentPrice ?? 0;
  const lev = Math.max(1, leverage || 1);
  const riskPct = Math.max(0, maxRiskPerTradePct || 0);

  /* ---- Capital allocation ---- */
  let allocatedCapital = 0;
  if (capitalMode === "percent" && walletBalance != null && walletPercent != null) {
    allocatedCapital = walletBalance * (walletPercent / 100);
  } else {
    allocatedCapital = capital;
  }
  allocatedCapital = Math.max(0, allocatedCapital);

  const positionNotional = allocatedCapital * lev;
  const margin = allocatedCapital;

  /* ---- Estimated SL/TP distances (mirrors stop-loss-planner) ---- */
  const atr = Math.max(price * estimatedAtrPct, price * 0.002);
  const slDistance = Math.max(atr * 1.35, price * minStopDistancePct * 1.01);
  const slDistancePct = price > 0 ? (slDistance / price) * 100 : 0;

  /* ---- Estimated TP distance (mirrors take-profit-planner) ---- */
  const tpDistance = Math.max(slDistance * minRiskRewardRatio, atr * 1.8);
  const tpDistancePct = price > 0 ? (tpDistance / price) * 100 : 0;

  /* ---- SL / TP prices (assume BUY for preview) ---- */
  const slPrice = price - slDistance;
  const tpPrice = price + tpDistance;

  /* ---- Risk amounts ---- */
  const maxRiskUsdt = allocatedCapital * (riskPct / 100);

  /* ---- Position sizing (mirrors position-size-calculator) ---- */
  const riskBasedSize = slDistance > 0 ? maxRiskUsdt / slDistance : 0;
  const capitalCappedSize = price > 0 ? positionNotional / price : 0;
  const positionSize = Math.min(riskBasedSize, capitalCappedSize);

  const riskLimited = riskBasedSize <= capitalCappedSize;

  /* ---- Expected outcomes ---- */
  const estimatedLoss = slDistance * positionSize;
  const estimatedProfit = tpDistance * positionSize;
  const riskRewardRatio = estimatedLoss > 0 ? estimatedProfit / estimatedLoss : 0;

  /* ---- Risk compatibility ---- */
  const TOLERANCE = 1.01;
  const riskCompatible = riskPct <= 0 || estimatedLoss <= maxRiskUsdt * TOLERANCE;
  const riskExceededBy = riskCompatible ? 0 : Math.max(0, estimatedLoss - maxRiskUsdt);

  /* ---- Binding constraint ---- */
  const bindingConstraint =
    !riskCompatible ? "risk" as const
    : riskLimited ? "risk" as const
    : "none" as const;

  /* ---- Status & messages ---- */
  let status: "safe" | "warning" | "error" = "safe";
  let message = "";
  let capitalRiskNote = "";

  if (allocatedCapital <= 0 || price <= 0) {
    status = "error";
    message = "Set your capital and select a symbol to see a preview.";
    capitalRiskNote = "";
  } else if (!riskCompatible) {
    status = "error";
    message = `Configuration exceeds maximum risk. The current SL distance would risk ~${fmt(estimatedLoss)} USDT, but your max risk allows only ${fmt(maxRiskUsdt)} USDT.`;
    capitalRiskNote = `${fmtPct(capitalMode, walletPercent, capital)} allocation at ${lev}x leverage creates a ${fmt(positionNotional)} USDT position. At the estimated SL distance of ${fmt(slDistancePct)}%, this would lose ~${fmt(estimatedLoss)} USDT — exceeding your ${riskPct}% max risk limit of ${fmt(maxRiskUsdt)} USDT.`;
  } else if (allocatedCapital > 0 && riskPct > 0 && estimatedLoss > 0) {
    const utilPct = maxRiskUsdt > 0 ? (estimatedLoss / maxRiskUsdt) * 100 : 0;
    if (utilPct > 80) {
      status = "warning";
      message = `High risk utilization (${utilPct.toFixed(0)}% of max risk).`;
    } else {
      status = "safe";
      message = "Configuration is within risk limits.";
    }
    capitalRiskNote = `Your ${fmt(allocatedCapital)} USDT margin at ${lev}x will open a ~${fmt(positionNotional)} USDT position. The estimated loss at SL is ${fmt(estimatedLoss)} USDT, which is within your ${riskPct}% max risk of ${fmt(maxRiskUsdt)} USDT.`;
  }

  return {
    walletAvailable: walletBalance,
    allocatedCapital,
    positionNotional,
    margin,
    maxRiskPct: riskPct,
    maxRiskUsdt,
    slDistancePct,
    slPrice,
    estimatedLoss,
    riskCompatible,
    riskExceededBy,
    tpDistancePct,
    tpPrice,
    estimatedProfit,
    riskRewardRatio,
    riskBasedSize,
    capitalCappedSize,
    bindingConstraint,
    status,
    message,
    capitalRiskNote,
  };
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0.00";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtPct(mode: string, walletPercent: number | null, capital: number): string {
  if (mode === "percent" && walletPercent != null) {
    return `${walletPercent}% of wallet`;
  }
  return `${fmt(capital)} USDT fixed`;
}

export function formatPreviewValue(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}
