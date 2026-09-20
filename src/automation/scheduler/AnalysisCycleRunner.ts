import { AutomationEngine } from "@/automation/engine/automation-engine";
import type { CoinSwitchClient, ExchangeOrder, ExchangePosition } from "@/automation/executor/client";
import type { TradePlan } from "@/automation/planner/types";
import { OrderExecutorService } from "@/automation/executor/order-executor";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";
import type { OpenOrderSnapshot, OpenPositionSnapshot, RiskDecision, RiskManagerInput } from "@/automation/risk/types";
import type { AutomationConfig } from "@/automation/types";
import type { CoinAutoSelector, RankedOpportunityResult, SelectedOpportunity } from "@/automation/coinauto/coin-auto-selector";
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
import { computeAccountEquity, resolveDrawdownPeak } from "@/automation/risk/account-equity";
import { resolveMinRiskReward } from "@/automation/planner/risk-reward-constants";

const PERMANENT_ERROR_MARKERS = ["subaccount association not found"];

/** Per-scan candidate budget: try up to N ranked candidates before the next 5-min scan. */
// No fixed candidate budget: evaluate the full ranked opportunity list.

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
  /** Server-side coin auto selector (auto-select best coin mode). */
  coinAutoSelector?: CoinAutoSelector;
}

export class AnalysisCycleRunner {
  private readonly inFlight = new Set<number>();

  constructor(private readonly deps: AnalysisCycleDependencies) {}

  async runCycle(botId: number): Promise<CycleResult> {
    // Guard: prevent concurrent cycles for the same bot (in-flight concurrency).
    if (this.inFlight.has(botId)) {
      console.log(`[cycle] runCycle skipped for bot=${botId} — cycle already in progress`);
      return { executed: false, state: "RUNNING", action: "SKIPPED", message: "Cycle already in progress" };
    }
    this.inFlight.add(botId);
    let bot: BotRuntimeState | null = null;
    try {
      bot = await this.deps.store.getBot(botId);
      if (!bot) return this.skipped("Bot not found");

    // Execution continues inside the TRY block; the in-flight marker is
    // cleared in the FINALLY appended at the end of this function so the
    // guard covers the entire cycle.

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
    await this.deps.lifecycle.setRuntimeError(bot.id, null);
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

    // Mandatory debug logs to trace AUTO-selection runtime path
    console.log(`[AUTO DEBUG] botId=${bot.id} selectionMode=${config.autoSelect ? "AUTO" : "FIXED"}`);
    console.log(`[AUTO DEBUG] configuredCoin=${bot.symbol}`);
    // FIX 3 — auto-select bots scan the ranked candidate list for THIS 5-minute
    // cycle. Candidate #1 is evaluated first; if it fails any validation/risk
    // check, candidate #2 is evaluated IMMEDIATELY (no waiting for the next
    // scan). The cycle only ends when a candidate passes all checks and an order
    // is submitted, or every eligible candidate has been rejected.
    if (config.autoSelect && this.deps.coinAutoSelector) {
      console.log(`[AUTO DEBUG] executionPath=auto-select`);
      return this.runAutoSelectScan(bot, config);
    }
    console.log(`[AUTO DEBUG] executionPath=fixed-symbol`);
    return this.runFixedSymbolCycle(bot, config);
    } finally {
      // Clear the in-flight marker for this bot once the cycle has fully
      // completed (or errored) so subsequent ticks can proceed.
      this.inFlight.delete(botId);
    }
  }

  /**
   * Auto-select scan: build a ranked candidate list for this 5-minute scan and
   * try candidates in score order until one trades or all are rejected. Cheap
   * eligibility filtering (ticker volume + fresh snapshot + min-candles) already
   * happened inside the selector; the expensive strategy stack runs only on the
   * returned top-N.
   */
  private async runAutoSelectScan(bot: BotRuntimeState, baseConfig: AutomationConfig): Promise<CycleResult> {
    const selector = this.deps.coinAutoSelector;
    if (!selector) return this.runFixedSymbolCycle(bot, baseConfig);

    const scanId = `${bot.id}-${Date.now()}`;
    console.log(`[AUTO DEBUG] runAutoSelectScan ENTERED scanId=${scanId} botId=${bot.id}`);
    let ranked: RankedOpportunityResult | null = null;
    try {
      // Request a full ranked list — do not impose an artificial count limit.
      ranked = await selector.selectRankedOpportunities(bot.userId, baseConfig, {
        limit: undefined,
      });
    } catch (error) {
      return this.handleCycleError(bot, error);
    }

    const candidates = ranked?.candidates ?? [];
    console.log(
      `[scan] SCAN START — timeframe ${baseConfig.timeframe} | symbols fetched ${ranked?.fetchedCount ?? 0} | ` +
        `eligible (tradable & directional) ${ranked?.eligibleCount ?? 0} | ranking: ${ranked?.rankingCriteria ?? "n/a"}`,
    );
    console.log(`[AUTO SCAN] scanId=${scanId} botId=${bot.id} rankedCandidates=[${(candidates || []).map((c) => c.symbol).join(",")} ]`);
    liveActivityHub.publish({
      botId: bot.id,
      userId: bot.userId,
      symbol: "AUTO",
      phase: "lifecycle",
      message: `Scan started for ${baseConfig.timeframe}: ${candidates.length} ranked candidate(s) available`,
    });

    if (candidates.length === 0) {
      const message = "No suitable trading opportunity currently meets the bot's requirements. Will re-check next cycle.";
      await this.completeAnalysis(bot, "WAIT", message);
      liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "lifecycle", message });
      console.log(
        `[scan] SCAN COMPLETE — candidates evaluated 0 | rejected 0 | rejection reasons: none (no eligible candidates) | next scan in ~${this.deps.config.analysisIntervalMinutes} min`,
      );
      return { executed: true, state: "RUNNING", action: "ANALYZED", message };
    }

    const rejections: string[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const index = i + 1;
      console.log(`[AUTO SCAN] scanId=${scanId} candidate=${index}/${candidates.length} symbol=${candidate.symbol} START`);
      // Persist a lightweight candidate-start event so the UI activity feed and
      // historical queries see the per-candidate evaluation in the same
      // pipeline used by other scheduler events.
      try {
        await this.deps.events.emit({
          type: "AUTO_CANDIDATE",
          botId: bot.id,
          userId: bot.userId,
          message: `scanId=${scanId} candidate=${index}/${candidates.length} START symbol=${candidate.symbol}`,
          data: { scanId, candidateIndex: index, totalCandidates: candidates.length, symbol: candidate.symbol },
        });
      } catch {
        // non-fatal — live trace remains authoritative
      }
      const outcome = await this.tryCandidate(bot, baseConfig, candidate, index, scanId);
      if (outcome.status === "SUCCESS") {
        console.log(`[AUTO SCAN] scanId=${scanId} candidate=${index}/${candidates.length} symbol=${candidate.symbol} ORDER SUBMITTED`);
        // Persist scan-level completion as ORDER_SUBMITTED
        try {
          await this.deps.events.emit({
            type: "AUTO_SCAN_COMPLETE",
            botId: bot.id,
            userId: bot.userId,
            message: `scanId=${scanId} COMPLETE reason=ORDER_SUBMITTED symbol=${candidate.symbol} candidate=${index}/${candidates.length}`,
            data: { scanId, completedReason: "ORDER_SUBMITTED", symbol: candidate.symbol, candidateIndex: index },
          });
        } catch {}
        console.log(`[AUTO SCAN] COMPLETE scanId=${scanId} reason=ORDER_SUBMITTED`);
        return outcome.result;
      }
      console.log(`[AUTO SCAN] scanId=${scanId} candidate=${index}/${candidates.length} symbol=${candidate.symbol} REJECTED reason=${outcome.reason}`);
      try {
        await this.deps.events.emit({
          type: "AUTO_CANDIDATE_RESULT",
          botId: bot.id,
          userId: bot.userId,
          message: `scanId=${scanId} candidate=${index}/${candidates.length} symbol=${candidate.symbol} RESULT=REJECT reason=${outcome.reason}`,
          data: { scanId, candidateIndex: index, totalCandidates: candidates.length, symbol: candidate.symbol, reason: outcome.reason },
        });
      } catch {}
      if (index < candidates.length) console.log(`[AUTO SCAN] CONTINUING TO candidate ${index + 1}/${candidates.length}`);
      rejections.push(`#${index} ${candidate.symbol}: ${outcome.reason}`);
    }

    const grouped = this.groupRejectionReasons(rejections);
    const rejectedSymbols = candidates.map((c) => c.symbol).join(", ");
    const summary = `All ${candidates.length} ranked candidate(s) rejected for this scan (${rejectedSymbols}). ${grouped}`;
    console.log(
      `[scan] SCAN COMPLETE — candidates evaluated ${candidates.length} | rejected ${rejections.length} | ` +
        `${grouped} | next scan in ~${this.deps.config.analysisIntervalMinutes} min`,
    );
    console.log(`[AUTO SCAN] COMPLETE scanId=${scanId} reason=ALL_CANDIDATES_REJECTED`);
    await this.deps.events.emit({
      type: "RISK_REJECTED",
      botId: bot.id,
      userId: bot.userId,
      message: summary,
      data: { status: "RISK_REJECTED", candidatesEvaluated: candidates.length, rejected: rejections.length, rejections },
    });
    liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "lifecycle", message: `Scan complete — ${summary}` });
    await this.completeAnalysis(bot, "RISK_REJECTED", summary);
    // Persist an AUTO scan completion marker for the activity feed/history.
    try {
      await this.deps.events.emit({
        type: "AUTO_SCAN_COMPLETE",
        botId: bot.id,
        userId: bot.userId,
        message: `scanId=${scanId} COMPLETE reason=ALL_CANDIDATES_REJECTED evaluated=${candidates.length} rejected=${rejections.length}`,
        data: { scanId, evaluated: candidates.length, rejected: rejections.length, rejections },
      });
    } catch {}
    return { executed: true, state: "RUNNING", action: "ANALYZED", message: `Risk rejected: ${summary}` };
  }

  /** Fixed-symbol cycle: evaluate the single configured symbol (no coin rotation). */
  private async runFixedSymbolCycle(bot: BotRuntimeState, baseConfig: AutomationConfig): Promise<CycleResult> {
    const cycleSymbol = bot.symbol;
    console.log(`[scan] SCAN START — fixed symbol ${cycleSymbol} | timeframe ${baseConfig.timeframe} | candidates 1`);

    const planned = await this.runEngineAndPlan(bot, baseConfig, cycleSymbol);
    if (planned.status === "ERROR") return planned.result;
    if (planned.status === "NO_PLAN") {
      await this.completeAnalysis(bot, "WAIT", planned.reason);
      liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: cycleSymbol, phase: "lifecycle", message: planned.reason });
      console.log(
        `[scan] SCAN COMPLETE — candidates evaluated 1 | rejected 1 | reason: ${planned.reason} | next scan in ~${this.deps.config.analysisIntervalMinutes} min`,
      );
      return { executed: true, state: "RUNNING", action: "ANALYZED", message: planned.reason };
    }

    const submitted = await this.checkRiskAndSubmit(bot, planned.config, planned.plan, cycleSymbol, 1);
    if (submitted.status === "DONE") return submitted.result;

    await this.deps.events.emit({ type: "RISK_REJECTED", botId: bot.id, userId: bot.userId, message: submitted.reason });
    await this.completeAnalysis(bot, "RISK_REJECTED", submitted.reason);
    console.log(
      `[scan] SCAN COMPLETE — candidates evaluated 1 | rejected 1 | reason: ${submitted.reason} | next scan in ~${this.deps.config.analysisIntervalMinutes} min`,
    );
    return { executed: true, state: "RUNNING", action: "ANALYZED", message: `Risk rejected: ${submitted.reason}` };
  }

  /**
   * Evaluate one ranked candidate end-to-end (engine -> plan -> live risk ->
   * order). Returns SUCCESS when the cycle is fully handled (order submitted or
   * a terminal control-flow exit) or REJECTED with the reason when the candidate
   * failed any pre-submission validation so the caller can try candidate #N+1
   * immediately instead of waiting for the next 5-minute scan.
   */
  private async tryCandidate(
    bot: BotRuntimeState,
    baseConfig: AutomationConfig,
    selected: SelectedOpportunity,
    index: number,
    scanId?: string,
  ): Promise<{ status: "SUCCESS"; result: CycleResult } | { status: "REJECTED"; reason: string }> {
    const config: AutomationConfig = {
      ...baseConfig,
      symbol: selected.symbol,
      leverage: selected.leverage,
    };
    const cycleSymbol = selected.symbol;
    const opp = selected.opportunity;
    const confidenceText = opp?.confidence != null ? `${Math.round(Number(opp.confidence) * 100)}%` : "n/a";
    console.log(
      `[scan] CANDIDATE #${index} — symbol ${cycleSymbol} | strategy direction ${selected.side} | ` +
        `confidence ${confidenceText} | score ${opp?.score ?? "n/a"} | entry ${opp?.price ?? "n/a"}`,
    );
    if (scanId) console.log(`[AUTO SCAN] scanId=${scanId} botId=${bot.id} candidate=${index} symbol=${cycleSymbol} SELECTED_FOR_EVALUATION`);
    liveActivityHub.publish({
      botId: bot.id,
      userId: bot.userId,
      symbol: cycleSymbol,
      phase: "strategy",
      message: `CANDIDATE #${index}: ${selected.side} ${cycleSymbol} (confidence ${confidenceText}, score ${opp?.score ?? "n/a"}) — evaluating…`,
      detail: { side: selected.side, leverage: selected.leverage, score: opp?.score, confidence: opp?.confidence },
    });
    // Keep the DB / display symbol in sync with the candidate currently analyzed.
    void this.persistAutoSelection(bot.id, selected);

    const planned = await this.runEngineAndPlan(bot, config, cycleSymbol);
    if (planned.status === "ERROR") return { status: "SUCCESS", result: planned.result };
    if (planned.status === "NO_PLAN") {
      this.rejectCandidate(bot, cycleSymbol, index, planned.reason, "strategy/planner");
      return { status: "REJECTED", reason: planned.reason };
    }

    const submitted = await this.checkRiskAndSubmit(bot, planned.config, planned.plan, cycleSymbol, index, scanId);
    if (submitted.status === "DONE") return { status: "SUCCESS", result: submitted.result };
    return { status: "REJECTED", reason: submitted.reason };
  }

  /** Run the strategy engine + planner for one symbol; emit the TRADE_PLANNED event. */
  private async runEngineAndPlan(
    bot: BotRuntimeState,
    config: AutomationConfig,
    cycleSymbol: string,
  ): Promise<
    | { status: "PLAN"; config: AutomationConfig; plan: TradePlan }
    | { status: "NO_PLAN"; reason: string }
    | { status: "ERROR"; result: CycleResult }
  > {
    let engineResult;
    try {
      engineResult = await this.deps.engine(bot.userId).run(config, (step) => {
        liveActivityHub.publish({
          botId: bot.id,
          userId: bot.userId,
          symbol: cycleSymbol,
          phase: step.phase,
          message: step.message,
          detail: step.detail,
        });
      });
    } catch (error) {
      return { status: "ERROR", result: await this.handleCycleError(bot, error) };
    }

    await this.deps.refreshLease?.(bot.id);

    if (engineResult.signal === "WAIT" || !engineResult.plan) {
      return { status: "NO_PLAN", reason: engineResult.analysis?.summary ?? `No valid opportunity for ${cycleSymbol}` };
    }

    const plan = engineResult.plan;
    await this.deps.stateManager.transition(bot.id, "ANALYZING", "TRADE_PLANNED");
    const entry = plan.limitPrice ?? plan.entryPrice ?? engineResult.analysis?.price;
    const priceText = entry != null && Number.isFinite(entry) ? `@ ${entry}` : "";
    const confidenceText = plan.confidence != null ? `, confidence ${Math.round(plan.confidence * 100)}%` : "";
    await this.deps.events.emit({ type: "TRADE_PLANNED", botId: bot.id, userId: bot.userId, message: `${plan.side ?? plan.action} ${cycleSymbol} ${priceText}${confidenceText}`, data: { side: plan.side ?? plan.action, limitPrice: plan.limitPrice, confidence: plan.confidence, analysis: engineResult.analysis } });
    liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: cycleSymbol, phase: "plan", message: `${plan.side ?? plan.action} ${cycleSymbol} ${priceText}${confidenceText}`, detail: { side: plan.side ?? plan.action, limitPrice: plan.limitPrice, confidence: plan.confidence } });

    return { status: "PLAN", config, plan };
  }

  /**
   * Live account risk gate for one planned candidate, then order submission.
   * On risk rejection publishes the failure and returns CONTINUE so the scan
   * loop can immediately evaluate the next ranked candidate.
   */
  private async checkRiskAndSubmit(
    bot: BotRuntimeState,
    config: AutomationConfig,
    plan: TradePlan,
    cycleSymbol: string,
    index: number,
    scanId?: string,
  ): Promise<{ status: "CONTINUE"; reason: string } | { status: "DONE"; result: CycleResult }> {
    const risk = await this.evaluateRisk(bot, config, plan);
    const riskSnapshotTs = new Date().toISOString();
    // Log detailed risk snapshot metadata for traceability across candidates
    if (scanId) console.log(`[AUTO SCAN] scanId=${scanId} botId=${bot.id} userId=${bot.userId} candidate=${index} symbol=${cycleSymbol} riskSnapshotTs=${riskSnapshotTs} decision_approved=${risk.decision.approved} positionSize=${risk.decision.positionSize}`);
    this.logCandidateDetails(cycleSymbol, plan, risk.decision);

    if (!risk.decision.approved || risk.decision.positionSize <= 0) {
      this.rejectCandidate(bot, cycleSymbol, index, risk.decision.reason, "risk");
      return { status: "CONTINUE", reason: risk.decision.reason };
    }
    liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: cycleSymbol, phase: "risk", message: `Risk check passed — position size ${risk.decision.positionSize}.` });
    console.log(`[scan] CANDIDATE #${index} (${cycleSymbol}) → PASSED — proceeding to order submission`);

    const freshBeforeOrder = await this.deps.store.getBot(bot.id);
    if ((freshBeforeOrder?.desiredStatus ?? "RUNNING") !== "RUNNING") {
      await this.deps.stateManager.transition(bot.id, "TRADE_PLANNED", "STOPPED", JSON.stringify(plan));
      await this.deps.events.emit({ type: "BOT_STOPPED", botId: bot.id, userId: bot.userId, message: "Bot was stopped before order placement; no trade created" });
      return { status: "DONE", result: { executed: false, state: "STOPPED", action: "SKIPPED", message: "Bot stopped before order placement" } };
    }

    await this.deps.stateManager.transition(bot.id, "TRADE_PLANNED", "ORDER_PENDING");
    await this.deps.refreshLease?.(bot.id);

    console.log(`[scan] ORDER SUBMISSION START — ${plan.side ?? plan.action} ${cycleSymbol} | size ${risk.decision.positionSize} | leverage ${config.leverage}`);
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
      return { status: "DONE", result: await this.handleCycleError(bot, error) };
    }

    await this.deps.lifecycle.updateBotHeartbeat(bot.id, null, new Date().toISOString());
    await this.deps.lifecycle.updateHeartbeatAt(bot.id);
    console.log(`[scan] ORDER RESULT — state ${executionResult.state} | ${executionResult.message}`);

    switch (executionResult.state) {
      case "MONITORING_ENTRY":
        // The LIMIT entry is still resting on the exchange (possibly partially
        // filled). Release this cycle; the server-side PositionMonitor keeps
        // watching the order until it fills, invalidates, is explicitly
        // cancelled, or reaches its configured orderExpiryMinutes (persisted
        // as expires_at). handoff() creates/keeps the position row the monitor
        // operates on and parks the bot in ORDER_PENDING so no duplicate entry
        // order can be placed by the next analysis cycle.
        await this.deps.lifecycle.setRetryCount(bot.id, 0);
        await this.handoff(bot);
        await this.deps.events.emit({
          type: "ENTRY_ORDER_CREATED",
          botId: bot.id,
          userId: bot.userId,
          message: executionResult.remainingQuantity != null
            ? `Entry order for ${cycleSymbol} resting with ${executionResult.remainingQuantity} remaining — monitored until fill, invalidation, cancellation or expiry`
            : `Entry order for ${cycleSymbol} resting on the exchange — monitored until fill, invalidation, cancellation or expiry`,
          data: { executionId: executionResult.executionId, filledQuantity: executionResult.filledQuantity, remainingQuantity: executionResult.remainingQuantity },
        });
        liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: cycleSymbol, phase: "lifecycle", message: executionResult.message });
        return { status: "DONE", result: { executed: true, state: "ORDER_PENDING", action: "ANALYZED", message: executionResult.message } };
      case "ENTRY_FILLED":
      case "PARTIALLY_FILLED":
        await this.deps.lifecycle.setRetryCount(bot.id, 0);
        await this.handoff(bot);
        await this.deps.events.emit({ type: "POSITION_OPENED", botId: bot.id, userId: bot.userId, message: `Position opened for ${bot.symbol}`, data: { executionId: executionResult.executionId, filledQuantity: executionResult.filledQuantity } });
        liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: bot.symbol, phase: "execution", message: `Entry filled — position opened for ${bot.symbol} (${executionResult.filledQuantity}).` });
        return { status: "DONE", result: { executed: true, state: "POSITION_OPEN", action: "TRADE_EXECUTED", message: "Entry filled; responsibility transferred to Position Manager" } };
      case "UNPROTECTED":
        await this.deps.lifecycle.setRetryCount(bot.id, 0);
        await this.handoff(bot);
        return { status: "DONE", result: { executed: true, state: "POSITION_OPEN", action: "TRADE_EXECUTED", message: "Entry filled but unprotected; Position Manager will attempt emergency protection" } };
      case "CANCELLED":
        await this.completeAnalysis(bot, "CANCELLED", executionResult.message);
        return { status: "DONE", result: { executed: true, state: "RUNNING", action: "ANALYZED", message: executionResult.message } };
      case "FAILED":
        return { status: "DONE", result: await this.handleCycleError(bot, new Error(executionResult.message || "Execution failed")) };
      default:
        await this.completeAnalysis(bot, "CANCELLED", executionResult.message);
        return { status: "DONE", result: { executed: true, state: "RUNNING", action: "ANALYZED", message: executionResult.message } };
    }
  }

  /** Log + publish one candidate rejection. The scan loop decides what happens next. */
  private rejectCandidate(bot: BotRuntimeState, cycleSymbol: string, index: number, reason: string, source: string): void {
    console.log(`[scan] CANDIDATE #${index} (${cycleSymbol}) → REJECTED — ${source}: ${reason}`);
    const publishMessage =
      source === "risk"
        ? `Risk check rejected: ${reason}`
        : `CANDIDATE #${index} (${cycleSymbol}) rejected (${source}): ${reason}`;
    liveActivityHub.publish({ botId: bot.id, userId: bot.userId, symbol: cycleSymbol, phase: "risk", message: publishMessage });
  }

  /** Full per-candidate disclosure: levels, distances, R:R and EVERY risk check result. */
  private logCandidateDetails(cycleSymbol: string, plan: TradePlan, decision: RiskDecision): void {
    const entry = Number(plan.limitPrice ?? plan.entryPrice);
    const stop = Number(plan.stopLoss);
    const take = Number(plan.takeProfit);
    const stopDistance = Math.abs(entry - stop);
    const rewardDistance = Math.abs(take - entry);
    const rr = stopDistance > 0 ? rewardDistance / stopDistance : 0;
    const entrySafe = Number.isFinite(entry) && entry > 0;
    const lines = [
      `[scan] CANDIDATE DETAILS — ${cycleSymbol}`,
      `  strategy direction: ${plan.side ?? plan.action}`,
      `  confidence: ${plan.confidence != null ? `${Math.round(plan.confidence * 100)}%` : "n/a"}`,
      `  entry: ${entry}`,
      `  SL: ${stop}`,
      `  TP: ${take}`,
      `  risk distance: ${stopDistance.toFixed(6)}${entrySafe ? ` (${((stopDistance / entry) * 100).toFixed(2)}%)` : ""}`,
      `  reward distance: ${rewardDistance.toFixed(6)}${entrySafe ? ` (${((rewardDistance / entry) * 100).toFixed(2)}%)` : ""}`,
      `  calculated R:R: ${rr.toFixed(2)}`,
    ];
    for (const check of decision.checks ?? []) {
      lines.push(`  risk ${check.name}: ${check.passed ? "PASS" : "FAIL"} — ${check.message}`);
    }
    console.log(lines.join("\n"));
  }

  /** Group the scan's rejection reasons, counting identical reasons so repeats are obvious. */
  private groupRejectionReasons(rejections: string[]): string {
    if (rejections.length === 0) return "no rejection reasons";
    const counts = new Map<string, number>();
    for (const reason of rejections) {
      const key = reason.replace(/^#[0-9]+ \S+: /, "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => `${key}${count > 1 ? ` (${count}x)` : ""}`);
    return `rejection reasons: ${parts.length === 1 ? parts[0] : parts.join("; ")}`;
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
    const analysisIntervalMs = this.deps.config.analysisIntervalMinutes * 60_000;
    const baseInterval = config ? intervalMsFromTimeframe(config.timeframe, analysisIntervalMs) : analysisIntervalMs;
    // Auto-select bots rotate to the strongest current coin, so never wait a full
    // long timeframe (1h/4h…) before noticing a better setup appeared. Re-check at
    // least as often as the configured analysis interval.
    const interval = config?.autoSelect ? Math.min(baseInterval, analysisIntervalMs) : baseInterval;
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
    const [wallet, exchangePositions, openOrders, daily] = await Promise.all([
      this.deps.client.getWalletSnapshot(bot.userId).catch(() => null),
      this.deps.client.getPositions(bot.userId).catch(() => []),
      this.deps.client.getOpenOrders(bot.userId).catch(() => []),
      this.deps.store.getDailyStats(bot.userId),
    ]);

    const runningBots = await this.deps.lifecycle.countActiveBotsForUser(bot.userId);
    const isPercent = config.capitalMode === "percent";
    const fixedCapital = Number(config.capital) || 0;
    const walletAvailable = wallet?.available ?? null;
    // percent mode MUST size against the live wallet; it must never silently
    // fall back to a stale fixed capital (the root cause of "uses last amount").
    const balance = isPercent ? (walletAvailable ?? 0) : (walletAvailable ?? fixedCapital);
    const allocatedCapital =
      config.capitalMode === "percent"
        ? balance * ((Number(config.walletPercent) || 0) / 100)
        : fixedCapital;

    // --- Persistent peak-equity tracking for drawdown protection ---
    // Equity is the TRUE account equity (wallet total balance + unrealized PnL
    // of live positions) — NEVER total_available_balance, which falls whenever
    // margin is locked in a position even when the account has not suffered an
    // equivalent loss. A realised-loss-free drop in available balance must not
    // by itself trip the drawdown gate.
    const equity = computeAccountEquity({ wallet, positions: exchangePositions });
    const peakInfo = resolveDrawdownPeak({
      equity,
      persistedPeak: bot.peakEquity ?? null,
      persistedBasis: bot.peakEquityBasis ?? "available_balance",
    });
    if (peakInfo.needsPersist && peakInfo.peak != null) {
      void this.deps.lifecycle.updatePeakEquity(bot.id, peakInfo.peak, peakInfo.basis);
    }
    const peakForDrawdown = peakInfo.peak;
    const equityForRisk = equity ?? 0;

    // R:R gate — ONE resolved floor per candidate via the shared resolver. The
    // historical bug: this gate silently defaulted to 2.0 while the planner
    // validated against 1.5, so a legit 1.8 R:R died here. Now the planner and
    // this live gate always resolve the SAME number (bot config, else the
    // documented 1.5 fallback) and every rejection is logged with its inputs.
    const resolvedMinRR = resolveMinRiskReward(config);
    const entry = Number(plan.limitPrice ?? plan.entryPrice);
    const stop = Number(plan.stopLoss);
    const take = Number(plan.takeProfit);
    const stopDistance = Math.abs(entry - stop);
    const rewardDistance = Math.abs(take - entry);
    const computedRR = stopDistance > 0 ? rewardDistance / stopDistance : 0;
    const rrSource =
      resolvedMinRR.source === "bot-config"
        ? `bot config (minRiskRewardRatio ${resolvedMinRR.value})`
        : "fallback (documented system default 1.5)";
    console.log(
      `[scan] R:R validation — symbol ${plan.symbol ?? config.symbol} | entry ${entry} | SL ${stop} | TP ${take} | ` +
        `risk distance ${stopDistance.toFixed(6)} | reward distance ${rewardDistance.toFixed(6)} | ` +
        `calculated R:R ${computedRR.toFixed(2)} | required min R:R ${resolvedMinRR.value} ` +
        `(source: ${rrSource}) | comparison ${computedRR.toFixed(2)} >= ${resolvedMinRR.value} ? ${computedRR >= resolvedMinRR.value}`,
    );

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
        // Disable account-level max-drawdown as an execution gate for automated
        // trading. The system still records peak/equity for analytics/history
        // (see computeAccountEquity / resolveDrawdownPeak), but it must not
        // cause candidate rejection here — set to a permissive value.
        minRiskRewardRatio: resolvedMinRR.value,
      },
      wallet: { balance, equity: equityForRisk, peakBalance: peakForDrawdown ?? equityForRisk },
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

  /**
   * Persist the currently selected auto coin so that after a restart the bot
   * reflects its latest symbol / direction / leverage / cycle state without
   * waiting for the next analysis to complete.
   */
  private async persistAutoSelection(botId: number, selected: SelectedOpportunity): Promise<void> {
    try {
      const current = await this.deps.store.getBot(botId);
      if (!current) return;
      let config: AutomationConfig;
      try {
        config = this.loadConfig(current);
      } catch {
        return;
      }
      const updated: AutomationConfig = {
        ...config,
        symbol: selected.symbol,
        side: selected.side,
        leverage: selected.leverage,
        leverageMode: config.leverageMode ?? "auto",
      };
      await this.deps.lifecycle.setConfig(botId, JSON.stringify(updated));
      await this.deps.lifecycle.updateSelectedCoin(botId, selected.symbol, selected.leverage);
    } catch (error) {
      console.error(`[auto-select] failed to persist selection for bot ${botId}`, error);
    }
  }

  private skipped(message: string): CycleResult {
    return { executed: false, state: "STOPPED", action: "SKIPPED", message };
  }
}
