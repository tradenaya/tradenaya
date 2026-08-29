import { AutomationEngine } from "@/automation/engine/automation-engine";
import type { CoinSwitchClient, ExchangeOrder, ExchangePosition } from "@/automation/executor/client";
import type { TradePlan } from "@/automation/planner/types";
import { OrderExecutorService } from "@/automation/executor/order-executor";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";
import type { OpenOrderSnapshot, OpenPositionSnapshot, RiskDecision, RiskManagerInput } from "@/automation/risk/types";
import type { AutomationConfig } from "@/automation/types";
import type { BotLifecycleService, BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { ExecutionRecord } from "@/automation/executor/types";
import type { PositionManagerConfig } from "@/automation/position/PositionManagerTypes";
import { SchedulerStore } from "./SchedulerStore";
import { SchedulerStateManager, stateFromExecutionState, stateFromPositionState } from "./SchedulerStateManager";
import { SchedulerEventBus } from "./SchedulerEventBus";
import { liveActivityHub } from "./LiveActivityHub";
import { backoffMs, intervalMsFromTimeframe } from "./SchedulerTime";
import type { CycleResult, SchedulerConfig, SchedulerState } from "./SchedulerTypes";
import { clientOrderId } from "@/automation/executor/order-id";
import { dispatchTelegram } from "@/lib/telegram-dispatch";
import { telegramAnalysis, telegramCoinSwitchError } from "@/lib/telegram";

const PERMANENT_ERROR_MARKERS = ["subaccount association not found"];

function normalizeErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      // not JSON — fall through to raw string
    }
  }
  return trimmed;
}

/** True when the error is account-level and retrying can never succeed. */
export function isPermanentOrderError(message: string): boolean {
  const normalized = normalizeErrorMessage(message).toLowerCase();
  return PERMANENT_ERROR_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

/** Recognise an exchange "insufficient balance / margin" rejection. */
export function isInsufficientBalanceError(message: string): boolean {
  const normalized = normalizeErrorMessage(message).toLowerCase();
  return (
    normalized.includes("insufficient") &&
    (normalized.includes("balance") || normalized.includes("margin") || normalized.includes("fund"))
  );
}

/** Rewrite cryptic exchange rejections into a clear, actionable message. */
export function clarifyOrderError(message: string): string {
  const normalized = normalizeErrorMessage(message);
  if (isInsufficientBalanceError(normalized)) {
    return (
      `The exchange rejected the order for insufficient available balance. Your USDT may be locked in open ` +
      `orders/positions or the required margin exceeds your free balance. Check your futures wallet (Available vs ` +
      `Blocked/In Positions) — free up margin or reduce capital allocation / leverage. (Exchange: ${normalized})`
    );
  }
  return normalized;
}

export interface AnalysisCycleDependencies {
  store: SchedulerStore;
  stateManager: SchedulerStateManager;
  events: SchedulerEventBus;
  lifecycle: BotLifecycleService;
  client: CoinSwitchClient;
  engine: (userId: number) => AutomationEngine;
  riskManager: DefaultRiskManager;
  executor: OrderExecutorService;
  config: Required<SchedulerConfig>;
  refreshLease?: (botId: number) => Promise<boolean>;
}

export class AnalysisCycleRunner {
  constructor(private readonly deps: AnalysisCycleDependencies) {}

  async runCycle(botId: number): Promise<CycleResult> {
    const bot = await this.deps.store.getBot(botId);
    if (!bot) return this.skipped("Bot not found");

    const desired = bot.desiredStatus ?? "RUNNING";
    if (desired !== "RUNNING") {
      await this.toDesiredTerminal(bot);
      return this.skipped(`Bot desired status is ${desired}`);
    }

    const activeTrade = await this.deps.store.hasActiveTradeForBot(botId);
    if (activeTrade) {
      await this.handoff(bot);
      return { executed: false, state: "POSITION_OPEN", action: "POSITION_HANDOFF", message: "Active trade detected; handed off to Position Manager" };
    }

    await this.deps.stateManager.transition(bot.id, this.asState(bot.status), "ANALYZING");
    await this.deps.lifecycle.updateBotHeartbeat(bot.id, new Date().toISOString(), null);
    await this.deps.lifecycle.updateHeartbeatAt(bot.id);
    await this.deps.events.emit({ type: "ANALYSIS_STARTED", botId: bot.id, userId: bot.userId, message: `Analysis cycle started for ${bot.symbol}` });
    liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "lifecycle", message: `Analysis cycle started for ${bot.symbol}` });

    let config: AutomationConfig;
    try {
      config = this.loadConfig(bot);
    } catch (error) {
      return this.handleCycleError(bot, error);
    }

    let engineResult;
    try {
      engineResult = await this.deps.engine(bot.userId).run(config, (step) => {
        liveActivityHub.publish({
          botId: bot.id,
          userId: bot.userId,
          symbol: bot.symbol,
          phase: step.phase,
          message: step.message,
          detail: step.detail,
        });
      });
    } catch (error) {
      return this.handleCycleError(bot, error);
    }

    await this.deps.refreshLease?.(bot.id);

    if (engineResult.signal === "WAIT" || !engineResult.plan) {
      const message = engineResult.analysis?.summary ?? `No valid opportunity for ${bot.symbol}`;
      await this.completeAnalysis(bot, "WAIT", message);
      liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "lifecycle", message });
      return { executed: true, state: "RUNNING", action: "ANALYZED", message };
    }

    const plan = engineResult.plan;
    await this.deps.stateManager.transition(bot.id, "ANALYZING", "TRADE_PLANNED");
    const entry = plan.limitPrice ?? plan.entryPrice ?? engineResult.analysis?.price;
    const priceText = entry != null && Number.isFinite(entry) ? `@ ${entry}` : "";
    const confidenceText = plan.confidence != null ? `, confidence ${Math.round(plan.confidence * 100)}%` : "";
    await this.deps.events.emit({ type: "TRADE_PLANNED", botId: bot.id, userId: bot.userId, message: `${plan.side ?? plan.action} ${bot.symbol} ${priceText}${confidenceText}`, data: { side: plan.side ?? plan.action, limitPrice: plan.limitPrice, confidence: plan.confidence, analysis: engineResult.analysis } });
    liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "plan", message: `${plan.side ?? plan.action} ${bot.symbol} ${priceText}${confidenceText}`, detail: { side: plan.side ?? plan.action, limitPrice: plan.limitPrice, confidence: plan.confidence } });

    const risk = await this.evaluateRisk(bot, config, plan);
    if (!risk.decision.approved || risk.decision.positionSize <= 0) {
      await this.deps.events.emit({ type: "RISK_REJECTED", botId: bot.id, userId: bot.userId, message: risk.decision.reason });
      liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "risk", message: `Risk check rejected: ${risk.decision.reason}` });
      await this.completeAnalysis(bot, "RISK_REJECTED", risk.decision.reason);
      return { executed: true, state: "RUNNING", action: "ANALYZED", message: `Risk rejected: ${risk.decision.reason}` };
    }
    liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "risk", message: `Risk check passed — position size ${risk.decision.positionSize}.` });

    const freshBeforeOrder = await this.deps.store.getBot(bot.id);
    if ((freshBeforeOrder?.desiredStatus ?? "RUNNING") !== "RUNNING") {
      await this.deps.stateManager.transition(bot.id, "TRADE_PLANNED", "STOPPED", JSON.stringify(plan));
      await this.deps.events.emit({ type: "BOT_STOPPED", botId: bot.id, userId: bot.userId, message: "Bot was stopped before order placement; no trade created" });
      return { executed: false, state: "STOPPED", action: "SKIPPED", message: "Bot stopped before order placement" };
    }

    await this.deps.stateManager.transition(bot.id, "TRADE_PLANNED", "ORDER_PENDING");
    await this.deps.refreshLease?.(bot.id);

    let executionResult;
    try {
      executionResult = await this.deps.executor.execute({
        userId: bot.userId,
        botId: bot.id,
        plan,
        quantity: risk.decision.positionSize,
        leverage: config.leverage,
        allocatedCapital: risk.allocatedCapital,
      });
    } catch (error) {
      return this.handleCycleError(bot, error);
    }

    await this.deps.lifecycle.updateBotHeartbeat(bot.id, null, new Date().toISOString());
    await this.deps.lifecycle.updateHeartbeatAt(bot.id);

    switch (executionResult.state) {
      case "ENTRY_FILLED":
      case "PARTIALLY_FILLED":
        await this.deps.lifecycle.setRetryCount(bot.id, 0);
        await this.handoff(bot);
        await this.deps.events.emit({ type: "POSITION_OPENED", botId: bot.id, userId: bot.userId, message: `Position opened for ${bot.symbol}`, data: { executionId: executionResult.executionId, filledQuantity: executionResult.filledQuantity } });
        liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "execution", message: `Entry filled — position opened for ${bot.symbol} (${executionResult.filledQuantity}).` });
        return { executed: true, state: "POSITION_OPEN", action: "TRADE_EXECUTED", message: "Entry filled; responsibility transferred to Position Manager" };
      case "UNPROTECTED":
        await this.deps.lifecycle.setRetryCount(bot.id, 0);
        await this.handoff(bot);
        return { executed: true, state: "POSITION_OPEN", action: "TRADE_EXECUTED", message: "Entry filled but unprotected; Position Manager will attempt emergency protection" };
      case "CANCELLED":
        await this.completeAnalysis(bot, "CANCELLED", executionResult.message);
        return { executed: true, state: "RUNNING", action: "ANALYZED", message: executionResult.message };
      case "FAILED":
        return this.handleCycleError(bot, new Error(executionResult.message || "Execution failed"));
      default:
        await this.completeAnalysis(bot, "CANCELLED", executionResult.message);
        return { executed: true, state: "RUNNING", action: "ANALYZED", message: executionResult.message };
    }
  }

  async handoff(bot: BotRuntimeState): Promise<void> {
    const [execution, position] = await Promise.all([
      this.deps.store.getActiveExecutionForBot(bot.id),
      this.deps.store.getActivePositionForBot(bot.id),
    ]);

    let state: SchedulerState = "POSITION_OPEN";
    if (position) {
      state = stateFromPositionState(position.state);
      await this.ensureTrailingConfig(bot, position.id);
    } else if (execution) {
      await this.ensurePositionRow(bot, execution);
      state = stateFromExecutionState(execution.state);
    }

    await this.deps.stateManager.transition(bot.id, this.asState(bot.status), state);
    await this.deps.lifecycle.scheduleNextRun(bot.id, null);
    await this.deps.lifecycle.updateHeartbeatAt(bot.id);
  }

  async resume(bot: BotRuntimeState): Promise<void> {
    const desired = bot.desiredStatus ?? "RUNNING";
    if (desired === "RUNNING") {
      await this.deps.stateManager.transition(bot.id, this.asState(bot.status), "RUNNING");
      await this.deps.lifecycle.scheduleNextRun(bot.id, new Date());
      await this.deps.lifecycle.setRetryCount(bot.id, 0);
    } else {
      await this.deps.stateManager.transition(bot.id, this.asState(bot.status), desired === "PAUSED" ? "PAUSED" : "STOPPED");
    }
  }

  async reconcileEntryExecution(bot: BotRuntimeState, execution: ExecutionRecord): Promise<boolean> {
    if (execution.state !== "PENDING_ENTRY") return true;
    if (execution.entry.orderId || execution.entry.clientOrderId) {
      await this.deps.store.executions.updateState(execution.id, "MONITORING_ENTRY");
      return true;
    }

    const orphan = await this.findOrphanOrder(bot, execution);
    if (orphan) {
      await this.deps.store.executions.updateEntryRef(execution.id, { orderId: orphan.orderId, clientOrderId: orphan.clientOrderId, status: orphan.status });
      await this.deps.store.executions.updateState(execution.id, "MONITORING_ENTRY");
      return true;
    }

    await this.deps.store.executions.updateState(execution.id, "CANCELLED", "Recovered: entry order was never submitted");
    return false;
  }

  async handleCycleError(bot: BotRuntimeState, error: unknown): Promise<CycleResult> {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = clarifyOrderError(rawMessage);

    if (isPermanentOrderError(message)) {
      await this.deps.lifecycle.setRetryCount(bot.id, 0);
      await this.deps.lifecycle.setRuntimeError(bot.id, message);
      await this.deps.stateManager.transition(bot.id, this.asState(bot.status), "ERROR");
      await this.deps.events.emit({
        type: "BOT_ERROR",
        botId: bot.id,
        userId: bot.userId,
        message: `Bot marked ERROR — account-level error that retries cannot fix: ${message}. Fix the CoinSwitch subaccount association for ${bot.symbol} or pick a different market.`,
      });
      void dispatchTelegram(`bot:${bot.id}:error:permanent`, "BOT_ERROR", telegramCoinSwitchError({
        endpoint: "futures/order",
        symbol: bot.symbol,
        error: message,
        kind: "permanent",
      }));
      liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "lifecycle", message: `Bot marked ERROR — ${message}` });
      return { executed: false, state: "ERROR", action: "ERROR", message };
    }

    const retryCount = (bot.retryCount ?? 0) + 1;
    await this.deps.lifecycle.setRetryCount(bot.id, retryCount);
    await this.deps.lifecycle.setRuntimeError(bot.id, message);

    const maxFailures = this.deps.config.maxConsecutiveFailures;
    if (retryCount > maxFailures) {
      await this.deps.stateManager.transition(bot.id, this.asState(bot.status), "ERROR");
      await this.deps.events.emit({ type: "BOT_ERROR", botId: bot.id, userId: bot.userId, message: `Bot marked ERROR after ${maxFailures} consecutive failures: ${message}` });
      void dispatchTelegram(`bot:${bot.id}:error:consecutive`, "BOT_ERROR", telegramCoinSwitchError({
        endpoint: "futures",
        symbol: bot.symbol,
        error: `Bot marked ERROR after ${maxFailures} consecutive failures: ${message}`,
        kind: "api",
      }));
      return { executed: false, state: "ERROR", action: "ERROR", message };
    }

    const delay = backoffMs(retryCount, this.deps.config.backoffBaseMs, this.deps.config.backoffMaxMs);
    await this.deps.stateManager.transition(bot.id, this.asState(bot.status), "RUNNING");
    await this.deps.lifecycle.scheduleNextRun(bot.id, new Date(Date.now() + delay));
    await this.deps.events.emit({ type: "CYCLE_RETRY", botId: bot.id, userId: bot.userId, message: `Cycle failed, scheduling retry #${retryCount} in ${delay}ms: ${message}` });
    return { executed: false, state: "RUNNING", action: "ERROR", message };
  }

  private async completeAnalysis(bot: BotRuntimeState, status: "WAIT" | "RISK_REJECTED" | "CANCELLED", message: string): Promise<void> {
    const config = this.tryLoadConfig(bot);
    const interval = config ? intervalMsFromTimeframe(config.timeframe, this.deps.config.analysisIntervalMinutes * 60_000) : this.deps.config.analysisIntervalMinutes * 60_000;
    await this.deps.lifecycle.updateBotHeartbeat(bot.id, new Date().toISOString(), null);
    await this.deps.lifecycle.updateHeartbeatAt(bot.id);
    await this.deps.stateManager.transition(bot.id, this.asState(bot.status), "RUNNING");
    await this.deps.lifecycle.setRetryCount(bot.id, 0);
    await this.deps.lifecycle.scheduleNextRun(bot.id, new Date(Date.now() + interval));
    await this.deps.events.emit({ type: "ANALYSIS_COMPLETED", botId: bot.id, userId: bot.userId, message, data: { status } });

    // Only notify for meaningful terminal outcomes. A plain "no opportunity"
    // (WAIT) is routine and would spam every analysis cycle — skip it.
    if (status !== "WAIT") {
      const statusLabel =
        status === "RISK_REJECTED" ? "Analysis completed (risk rejected)" : "Analysis completed (cancelled)";
      void dispatchTelegram(`bot:${bot.id}:analysis:${status}`, "ANALYSIS_COMPLETED", telegramAnalysis({
        symbol: bot.symbol,
        status: statusLabel,
        detail: message,
      }));
    }
  }

  private async evaluateRisk(bot: BotRuntimeState, config: AutomationConfig, plan: TradePlan): Promise<{ decision: RiskDecision; allocatedCapital: number }> {
    const [walletBalance, exchangePositions, openOrders, daily] = await Promise.all([
      this.deps.client.getWalletBalance(bot.userId).catch(() => null),
      this.deps.client.getPositions(bot.userId).catch(() => []),
      this.deps.client.getOpenOrders(bot.userId).catch(() => []),
      this.deps.store.getDailyStats(bot.userId),
    ]);

    const runningBots = await this.deps.lifecycle.countActiveBotsForUser(bot.userId);
    const isPercent = config.capitalMode === "percent";
    const fixedCapital = Number(config.capital) || 0;
    // percent mode MUST size against the live wallet; it must never silently
    // fall back to a stale fixed capital (the root cause of "uses last amount").
    const balance = isPercent ? (walletBalance ?? 0) : (walletBalance ?? fixedCapital);
    const allocatedCapital =
      config.capitalMode === "percent"
        ? balance * ((Number(config.walletPercent) || 0) / 100)
        : fixedCapital;

    const input: RiskManagerInput = {
      config: {
        maxRiskPerTradePct: config.maxRiskPerTrade,
        maxCapitalAllocationPct: 100,
        minWalletBalance: 0,
        maxLeverage: 100,
        maxSimultaneousPositions: 5,
        maxSimultaneousBots: 5,
        dailyLossLimitPct: config.dailyLossLimit,
        dailyTradeLimit: 20,
        maxDrawdownPct: 15,
        minRiskRewardRatio: config.minRiskRewardRatio ?? 2,
      },
      wallet: { balance, equity: balance },
      capital: {
        mode: config.capitalMode,
        amount: config.capitalMode === "fixed" ? config.capital : undefined,
        percent: config.capitalMode === "percent" ? config.walletPercent : undefined,
        leverage: config.leverage,
      },
      plan: { ...plan, symbol: plan.symbol ?? config.symbol },
      openPositions: exchangePositions.map(this.toOpenPosition),
      openOrders: openOrders.map(this.toOpenOrder),
      daily: { date: new Date().toISOString().slice(0, 10), realizedPnl: daily.realizedPnl, tradeCount: daily.tradeCount },
      runningBots,
    };

    return {
      decision: this.deps.riskManager.evaluate(input),
      allocatedCapital,
    };
  }

  private toOpenPosition(position: ExchangePosition): OpenPositionSnapshot {
    return {
      symbol: position.symbol,
      positionId: position.positionId ?? undefined,
      side: String(position.side ?? "").toUpperCase() === "SELL" ? "SHORT" : "LONG",
      size: position.quantity,
      margin: undefined,
      value: undefined,
      unrealizedPnl: position.unrealizedPnl ?? undefined,
    };
  }

  private toOpenOrder(order: ExchangeOrder): OpenOrderSnapshot {
    const raw = order?.raw ?? {};
    return {
      orderId: order?.orderId ?? undefined,
      symbol: raw.symbol ?? "",
      side: String(raw.side ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
      type: raw.order_type ?? raw.type ?? "",
      quantity: Number(raw.quantity ?? raw.size ?? 0),
      reduceOnly: raw.reduce_only === true || raw.reduce_only === 1 || raw.reduceOnly === true,
    };
  }

  private async findOrphanOrder(bot: BotRuntimeState, execution: ExecutionRecord): Promise<{ orderId: string | null; clientOrderId: string | null; status: string | null } | null> {
    const expectedClientId = clientOrderId(`exec_${execution.id}`);
    try {
      const orders = await this.deps.client.getOpenOrders(bot.userId, execution.symbol);
      const match = orders.find((order) => order.clientOrderId === expectedClientId || order.raw?.client_order_id === expectedClientId);
      return match ? { orderId: match.orderId, clientOrderId: match.clientOrderId, status: match.status } : null;
    } catch {
      return null;
    }
  }

  private async ensurePositionRow(bot: BotRuntimeState, execution: ExecutionRecord): Promise<void> {
    const existing = await this.deps.store.positions.getPositionByExecutionId(execution.id);
    if (existing) {
      await this.ensureTrailingConfig(bot, existing.id);
      return;
    }
    const config = this.tryLoadConfig(bot);
    await this.deps.store.positions.createPosition(execution, config ? this.buildPositionConfig(config) : {});
  }

  private async ensureTrailingConfig(bot: BotRuntimeState, positionId: number): Promise<void> {
    const config = this.tryLoadConfig(bot);
    if (!config) return;
    const trailing = config.enableTrailingStop;
    await this.deps.store.positions.updateTrailingConfig(
      positionId,
      trailing,
      trailing ? config.trailingDistancePercent ?? 1 : null,
      trailing ? 0 : null,
    );
  }

  private buildPositionConfig(config: AutomationConfig): PositionManagerConfig {
    if (config.enableTrailingStop) {
      return { trailing: { enabled: true, distancePct: config.trailingDistancePercent ?? 1, activationPct: 0 } };
    }
    return {};
  }

  private loadConfig(bot: BotRuntimeState): AutomationConfig {
    if (!bot.configJson) {
      throw new Error(`Bot ${bot.id} has no saved configuration`);
    }
    const config = JSON.parse(bot.configJson) as AutomationConfig;
    if (!config.symbol || !config.timeframe || !config.leverage || !config.capital || !config.maxRiskPerTrade || config.dailyLossLimit == null) {
      throw new Error(`Bot ${bot.id} configuration is incomplete`);
    }
    return config;
  }

  private tryLoadConfig(bot: BotRuntimeState): AutomationConfig | null {
    try {
      return this.loadConfig(bot);
    } catch {
      return null;
    }
  }

  private asState(status: BotRuntimeState["status"]): SchedulerState {
    return status as SchedulerState;
  }

  private async toDesiredTerminal(bot: BotRuntimeState): Promise<void> {
    const desired = bot.desiredStatus ?? "RUNNING";
    await this.deps.stateManager.transition(bot.id, this.asState(bot.status), desired === "PAUSED" ? "PAUSED" : "STOPPED");
  }

  private skipped(message: string): CycleResult {
    return { executed: false, state: "STOPPED", action: "SKIPPED", message };
  }
}
