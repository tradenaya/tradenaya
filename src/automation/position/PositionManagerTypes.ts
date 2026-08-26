import type { ExecutionRecord } from "@/automation/executor/types";
import type { ExchangeOrder, ExchangePosition } from "@/automation/executor/client";

export type PositionState =
  | "WAITING_ENTRY"
  | "ENTRY_PENDING"
  | "ENTRY_EXECUTED"
  | "PROTECTED"
  | "TRAILING"
  | "CLOSING"
  | "CLOSED"
  | "ERROR"
  | "UNPROTECTED";

export type ExitReason = "TAKE_PROFIT" | "STOP_LOSS" | "MANUAL_CLOSE" | "ENTRY_CANCELLED" | "EXPIRED" | "ERROR";

export type PositionSide = "BUY" | "SELL";

export const ACTIVE_POSITION_STATES: PositionState[] = [
  "WAITING_ENTRY",
  "ENTRY_PENDING",
  "ENTRY_EXECUTED",
  "PROTECTED",
  "TRAILING",
  "UNPROTECTED",
  "CLOSING",
];

export const TERMINAL_POSITION_STATES: PositionState[] = ["CLOSED", "ERROR"];

export interface PositionRecord {
  id: number;
  executionId: number;
  botId: number;
  userId: number;
  symbol: string;
  side: PositionSide;
  state: PositionState;
  quantity: number | null;
  filledQuantity: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number | null;
  positionId: string | null;
  entryOrderId: string | null;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  stopLossTriggered: boolean;
  takeProfitTriggered: boolean;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  fees: number | null;
  trailingEnabled: boolean;
  trailingActivated: boolean;
  trailingDistancePct: number | null;
  trailingActivationPct: number | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface PositionSnapshot {
  position: PositionRecord;
  currentPrice: number | null;
  exchangePosition: ExchangePosition | null;
  openOrders: ExchangeOrder[];
  /** True when the exchange positions read failed — callers must NOT treat a missing position as "position gone". */
  positionsReadFailed: boolean;
  /** True when the open orders read failed — callers must NOT treat empty orders as "protection missing". */
  openOrdersReadFailed: boolean;
}

export interface PositionManagerConfig {
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  maxPnlSyncMisses?: number;
  trailing?: TrailingStopConfig;
  emergencyRetries?: number;
}

export interface TrailingStopConfig {
  enabled: boolean;
  distancePct: number;
  activationPct: number;
  minDistancePct?: number;
  maxDistancePct?: number;
  stepSizePct?: number;
}

export interface PnLBreakdown {
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  fees: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  leverage: number | null;
  quantity: number | null;
}

export interface ProtectionValidationResult {
  valid: boolean;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
  issues: string[];
}

export interface CloseDetectionResult {
  shouldClose: boolean;
  reason: ExitReason;
  exitPrice: number | null;
  detail: string;
}

export interface PositionManagerDependencies {
  client: CoinSwitchClientLike;
  botState: BotStateServiceLike;
  recovery: PositionRecoveryLike;
  stateManager: PositionStateManagerLike;
  tpm: TPMonitorLike;
  slm: SLMonitorLike;
  trailing: TrailingStopManagerLike;
  protection: ProtectionValidatorLike;
  pnl: PositionPnLCalculatorLike;
  store: PositionStoreLike;
}

export interface CoinSwitchClientLike {
  getPositions(userId: number, symbol?: string): Promise<ExchangePosition[]>;
  getOpenOrders(userId: number, symbol?: string): Promise<ExchangeOrder[]>;
  getCurrentPrice(userId: number, symbol: string): Promise<number | null>;
  getOrderStatus(userId: number, orderId: string): Promise<ExchangeOrder>;
  cancelOrder(userId: number, orderId: string): Promise<boolean>;
  placeOrder(userId: number, params: any): Promise<ExchangeOrder>;
}

export interface BotStateServiceLike {
  updateBotStatus(id: number, status: string, currentTrade?: string | null): Promise<void>;
  updateBotHeartbeat(id: number, lastAnalysisAt?: string | null, lastExecutionAt?: string | null): Promise<void>;
}

export interface PositionRecoveryLike {
  recoverAllActive(): Promise<void>;
  emergencyProtect(executionId: number): Promise<boolean>;
}

export interface PositionStateManagerLike {
  transition(positionId: number, expected: PositionState, next: PositionState, errorMessage?: string | null): Promise<boolean>;
  markError(positionId: number, message: string): Promise<void>;
}

export interface TPMonitorLike {
  check(snapshot: PositionSnapshot): Promise<CloseDetectionResult>;
}

export interface SLMonitorLike {
  check(snapshot: PositionSnapshot): Promise<CloseDetectionResult>;
}

export interface TrailingStopManagerLike {
  update(snapshot: PositionSnapshot): Promise<{ moved: boolean; newStopLoss: number | null }>;
}

export interface ProtectionValidatorLike {
  validate(snapshot: PositionSnapshot): Promise<ProtectionValidationResult>;
}

export interface PositionPnLCalculatorLike {
  compute(snapshot: PositionSnapshot): Promise<PnLBreakdown>;
  computeRealized(snapshot: PositionSnapshot, exitPrice: number, reason: ExitReason): Promise<PnLBreakdown>;
}

export interface PositionStoreLike {
  ensureTable(): Promise<void>;
  createPosition(execution: ExecutionRecord, config: PositionManagerConfig): Promise<number>;
  getPositionByExecutionId(executionId: number): Promise<PositionRecord | null>;
  getActivePositions(): Promise<PositionRecord[]>;
  getPosition(id: number): Promise<PositionRecord | null>;
  updateState(id: number, state: PositionState, errorMessage?: string | null): Promise<void>;
  updatePrices(id: number, currentPrice: number | null, unrealizedPnl: number | null): Promise<void>;
  updateEntry(id: number, entryPrice: number | null, filledQuantity: number | null, positionId: string | null, entryOrderId: string | null): Promise<void>;
  updateProtection(id: number, stopLossOrderId: string | null, takeProfitOrderId: string | null): Promise<void>;
  updateTrailing(id: number, stopLoss: number | null, highestPrice: number | null, lowestPrice: number | null): Promise<void>;
  markClose(id: number, exitPrice: number, reason: ExitReason, realizedPnl: number, fees: number): Promise<void>;
  recordCloseSummary(input: CloseSummaryInput): Promise<void>;
  saveEvent(input: PositionEventInput): Promise<void>;
}

export interface CloseSummaryInput {
  position: PositionRecord;
  exitPrice: number | null;
  reason: ExitReason;
  realizedPnl: number | null;
  fees: number | null;
  entryPrice: number | null;
}

export interface PositionEventInput {
  userId: number;
  botId: number;
  executionId: number;
  positionId: number | null;
  type: string;
  message: string;
}

export class PositionManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PositionManagerError";
  }
}
