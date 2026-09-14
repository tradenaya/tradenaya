import type { TradePlan } from "@/automation/planner/types";
import type { CoinSwitchClient } from "./client";
import type { ExecutionStore } from "./store";

export type ExecutionState =
  | "PENDING_ENTRY"
  | "MONITORING_ENTRY"
  | "ENTRY_FILLED"
  | "PARTIALLY_FILLED"
  | "PROTECTED"
  | "UNPROTECTED"
  | "CANCELLED"
  | "FAILED"
  | "CLOSED";

export type ProtectiveStatus = "NONE" | "SL_ONLY" | "TP_ONLY" | "PLACED" | "FAILED";

export type ProtectiveKind = "sl" | "tp";

export const ACTIVE_EXECUTION_STATES: ExecutionState[] = [
  "PENDING_ENTRY",
  "MONITORING_ENTRY",
  "ENTRY_FILLED",
  "PARTIALLY_FILLED",
  "UNPROTECTED",
];

export const TERMINAL_EXECUTION_STATES: ExecutionState[] = ["CANCELLED", "FAILED", "CLOSED"];

export interface OrderExecutorInput {
  userId: number;
  botId: number;
  plan: TradePlan;
  quantity: number;
  leverage: number;
  /** Allocated capital in USDT — lets the executor raise a risk-capped quantity up to the exchange minimum when affordable. */
  allocatedCapital?: number;
}

export interface OrderExecutorOptions {
  statusPollIntervalMs?: number;
  statusPollAttempts?: number;
  requestTimeoutMs?: number;
  emergencyRetries?: number;
  client?: CoinSwitchClient;
  store?: ExecutionStore;
  botState?: BotStateService;
}

export interface OrderRef {
  orderId: string | null;
  clientOrderId: string | null;
  status: string | null;
}

export interface ExecutionRecord {
  id: number;
  botId: number;
  userId: number;
  symbol: string;
  side: "BUY" | "SELL";
  state: ExecutionState;
  executionKey: string;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  quantity: number | null;
  filledQuantity: number | null;
  /** Quantity still resting on the exchange (quantity minus filled). Persisted so partial fills survive restarts. */
  remainingQuantity: number | null;
  /** Actual average fill price reported by the exchange (persisted, survives restarts). */
  avgEntryPrice: number | null;
  leverage: number | null;
  expiresAt: number | null;
  positionId: string | null;
  entry: OrderRef;
  stopLossOrder: OrderRef;
  takeProfitOrder: OrderRef;
  protectiveStatus: ProtectiveStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderExecutorResult {
  success: boolean;
  executionId: number | null;
  state: ExecutionState;
  entryOrderId: string | null;
  slOrderId: string | null;
  tpOrderId: string | null;
  filledQuantity: number | null;
  /** Quantity still resting on the exchange (order quantity minus filled), or null when not computable. */
  remainingQuantity?: number | null;
  protectiveStatus: ProtectiveStatus;
  requiresEmergencyProtection: boolean;
  message: string;
}

export interface ExecutionNotification {
  type:
    | "ENTRY_SUBMITTED"
    | "ENTRY_FILLED"
    | "ENTRY_CANCELLED"
    | "ENTRY_FAILED"
    | "PROTECTED"
    | "UNPROTECTED"
    | "POSITION_OPEN"
    | "POSITION_CLOSED"
    | "POSITION_TAKE_PROFIT"
    | "POSITION_STOP_LOSS"
    | "POSITION_MANUAL_CLOSE"
    | "POSITION_LIQUIDATED"
    | "POSITION_UNPROTECTED"
    | "POSITION_TRAILING";
  botId: number;
  userId: number;
  symbol: string;
  executionId: number;
  message: string;
}

export interface BotStateService {
  updateBotStatus(id: number, status: string, currentTrade?: string | null): Promise<void>;
  updateBotHeartbeat(id: number, lastAnalysisAt?: string | null, lastExecutionAt?: string | null): Promise<void>;
}

export class OrderExecutorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "OrderExecutorError";
  }
}
