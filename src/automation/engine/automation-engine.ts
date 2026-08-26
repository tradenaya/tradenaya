import { CoinSwitchMarketDataService } from "@/automation/market/market-data-service";
import { TechnicalIndicatorEngine } from "@/automation/indicators/indicator-engine";
import { StrategyRegistry } from "@/automation/strategy/strategy-registry";
import { DefaultTradePlanner } from "@/automation/planner/trade-planner";
import type { TradePlan } from "@/automation/planner/types";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";
import type { AutomationConfig, StrategySignal } from "@/automation/types";
import type { StrategyContext, StrategyDecision } from "@/automation/strategy/types";
import type { MarketDataService } from "@/automation/market/market-data-service";
import { normalizeInterval } from "@/automation/market/normalizer";
import { summarizeDecision } from "@/automation/strategy/tradiaura/humanize";
import type { AnalysisPhase } from "@/automation/scheduler/LiveActivityHub";

export type EngineStep = { phase: AnalysisPhase; message: string; detail?: Record<string, unknown> };
export type EngineStepHandler = (step: EngineStep) => void;

export interface EngineAnalysis {
  trend: "UP" | "DOWN" | "SIDEWAYS";
  confidence: number;
  reasons: string[];
  price: number | null;
  summary: string;
}

export interface EngineResult {
  signal: StrategySignal;
  plan?: TradePlan;
  analysis?: EngineAnalysis;
}

export class AutomationEngine {
  constructor(
    private readonly marketDataService: MarketDataService = new CoinSwitchMarketDataService(),
    private readonly indicatorEngine = new TechnicalIndicatorEngine(),
    private readonly strategies = new StrategyRegistry(),
    private readonly planner = new DefaultTradePlanner(),
    private readonly riskManager = new DefaultRiskManager(),
  ) {}

  async run(config: AutomationConfig, onStep?: EngineStepHandler): Promise<EngineResult> {
    const step = (phase: AnalysisPhase, message: string, detail?: Record<string, unknown>) => onStep?.({ phase, message, detail });

    step("market", `Fetching live market data for ${config.symbol} (${config.timeframe})…`);
    const market = await this.marketDataService.getSnapshot(config.symbol, config.timeframe);

    // Never make a trade decision on stale or missing data.
    if (market.isFresh === "STALE" || market.isFresh === "UNAVAILABLE") {
      step("market", `Market data for ${config.symbol} is ${market.isFresh.toLowerCase()} — skipping this cycle.`);
      return { signal: "WAIT", analysis: { trend: "SIDEWAYS", confidence: 0, reasons: ["market data unavailable or stale"], price: null, summary: `No trade for ${config.symbol} — market data unavailable or stale` } };
    }

    const candles = market.candles[config.timeframe] ?? market.candles[String(normalizeInterval(config.timeframe) ?? "")] ?? [];
    const freshness = String(market.isFresh ?? "UNKNOWN").toLowerCase();
    step("market", `Received ${candles.length} candles for ${config.symbol} ${config.timeframe}; ${freshness} data.`);
    step("indicators", "Computing indicators (EMA, RSI, MACD, ATR, ADX, Bollinger, VWAP, SuperTrend)…");
    const indicators = this.indicatorEngine.compute(candles);

    const strategy = this.strategies.getStrategy("TradiAuraSmartV1") ?? this.strategies.getStrategies()[0];
    if (!strategy) {
      return { signal: "WAIT", analysis: { trend: "SIDEWAYS", confidence: 0, reasons: ["no strategy configured"], price: null, summary: `No trade for ${config.symbol} — no strategy configured` } };
    }

    step("strategy", `Running ${strategy.name} on ${candles.length} candles…`);
    const strategyContext: StrategyContext = {
      symbol: config.symbol,
      timeframe: config.timeframe,
      market,
      indicators,
      candles,
      report: (message, detail) => step("strategy", message, detail),
    };

    const decision: StrategyDecision = await strategy.analyze(strategyContext);
    const analysis = this.buildAnalysis(config, market.price, decision);

    step("strategy", `Decision: ${decision.signal} — ${analysis.summary}`);

    if (decision.signal === "WAIT") {
      return { signal: "WAIT", analysis };
    }

    step("plan", `Planning ${decision.signal} trade for ${config.symbol}…`);
    const plan = this.planner.plan({
      strategyDecision: decision,
      currentPrice: market.price,
      indicators,
      marketStructure: {
        trend: decision.trend,
        breakout: decision.indicators?.breakout === true,
        higherHighs: decision.indicators?.higherHighs === true,
        higherLows: decision.indicators?.higherLows === true,
        lowerHighs: decision.indicators?.lowerHighs === true,
        lowerLows: decision.indicators?.lowerLows === true,
      },
      supportResistance: this.extractSupportResistance(decision),
      atr: Number(indicators.atr ?? decision.indicators.atr ?? 0),
      config: {
        symbol: config.symbol,
        timeframe: config.timeframe,
        capital: config.capital,
        leverage: config.leverage,
        capitalMode: config.capitalMode,
        walletPercent: config.walletPercent,
        minRiskRewardRatio: config.minRiskRewardRatio,
        minStopDistancePct: config.minStopDistancePct,
        maxStopDistancePct: config.maxStopDistancePct,
        maxVolatilityPct: config.maxVolatilityPct,
        minConfidence: config.minConfidence,
        orderExpiryMinutes: config.orderExpiryMinutes,
      },
    });

    if (plan.action === "WAIT") {
      step("plan", `Planner skipped the trade: ${plan.reason}`);
      return { signal: "WAIT", analysis };
    }

    step("plan", `Plan ready — ${plan.action} ${config.symbol} @ ${plan.limitPrice ?? market.price} | SL ${plan.stopLoss} · TP ${plan.takeProfit} | R:R ${plan.riskRewardRatio}`);
    const risk = this.riskManager.assess(
      {
        capital: config.capital,
        capitalMode: config.capitalMode,
        walletPercent: config.walletPercent,
        maxRiskPerTrade: config.maxRiskPerTrade,
        dailyLossLimit: config.dailyLossLimit,
        leverage: config.leverage,
      },
      plan.limitPrice ?? market.price,
      plan.stopLoss ?? market.price,
      plan.takeProfit ?? market.price,
    );

    if (!risk.allowed) {
      step("risk", `Risk check failed: ${risk.reason}`);
      return { signal: "WAIT", analysis };
    }

    step("risk", `Risk check passed — position size ${risk.positionSize} (${risk.reason ?? "within limits"}).`);
    return { signal: plan.action, plan, analysis };
  }

  private buildAnalysis(config: AutomationConfig, price: number | null, decision: StrategyDecision): EngineAnalysis {
    const summary = summarizeDecision(config.symbol, config.timeframe, price, decision);
    return {
      trend: decision.trend,
      confidence: decision.confidence,
      reasons: decision.reasons,
      price,
      summary,
    };
  }

  private extractSupportResistance(decision: StrategyDecision): { support?: number; resistance?: number } {
    const support = Number(decision.indicators?.support);
    const resistance = Number(decision.indicators?.resistance);

    return {
      support: Number.isFinite(support) && support > 0 ? support : undefined,
      resistance: Number.isFinite(resistance) && resistance > 0 ? resistance : undefined,
    };
  }
}
