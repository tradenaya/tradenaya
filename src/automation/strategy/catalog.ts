/**
 * The strategies a bot (or backtest) can run. Pure data so client components
 * can import it. `id` is what is stored on automation_bots.strategy and in
 * the bot / backtest config JSON.
 */

export const TRADENAYA_SMART_ID = "TradenayaSmartV1";
export const TREND_BREAKOUT_ID = "TrendBreakoutV1";

/** Recommended bot settings, applied when the strategy is picked (all still editable). */
export interface StrategyDefaults {
  timeframe: string;
  maxRiskPerTrade: number;
  dailyLossLimit: number;
  leverageMode: "auto" | "manual";
  momentumEntriesOnly: boolean;
  enableTrailingStop: boolean;
  /** Which coins auto-select scans. */
  coinUniverse: "MAJORS" | "TOP_VOLUME";
  /** Why these values, shown under the picker. */
  note: string;
}

export interface StrategyInfo {
  id: string;
  label: string;
  /** One line for pickers. */
  summary: string;
  /** When set the strategy only runs on this timeframe (it was designed/tested there). */
  fixedTimeframe?: string;
  /** Whether the "strong-momentum entries only" filter applies to it. */
  supportsMomentumFilter: boolean;
  /** Whether the pullback-entry tuning (drift / regime / resting-candle limits, % trailing stop) applies. */
  usesPullbackTuning: boolean;
  defaults: StrategyDefaults;
}

export const STRATEGIES: StrategyInfo[] = [
  {
    id: TRADENAYA_SMART_ID,
    label: "Tradenaya Smart",
    summary: "Multi-factor pullback entries (trend, structure, momentum, volume) with a fixed take-profit.",
    supportsMomentumFilter: true,
    usesPullbackTuning: true,
    defaults: {
      timeframe: "1h",
      maxRiskPerTrade: 5,
      dailyLossLimit: 30,
      leverageMode: "auto",
      momentumEntriesOnly: true,
      enableTrailingStop: false,
      coinUniverse: "TOP_VOLUME",
      note: "1h candles, strong-momentum entries only, 5% risk per trade.",
    },
  },
  {
    id: TREND_BREAKOUT_ID,
    label: "Trend Breakout (4h)",
    summary:
      "Enters when price breaks the last 20 candles' range in the direction of the 200-EMA trend; the stop trails the last 10 candles so winners can run. Wins ~1 in 3 trades, but wins are ~3x the losses.",
    fixedTimeframe: "4h",
    supportsMomentumFilter: false,
    usesPullbackTuning: false,
    defaults: {
      timeframe: "4h",
      maxRiskPerTrade: 1,
      dailyLossLimit: 10,
      leverageMode: "auto",
      momentumEntriesOnly: false,
      enableTrailingStop: false,
      coinUniverse: "MAJORS",
      note: "Major coins only (BTC, ETH, SOL, XRP, BNB, DOGE — what it was tested on), 1% risk per trade: this strategy wins ~1 in 3 trades, so losing streaks of 6–8 are normal and must stay small. Its own stop trails the last 10 candles.",
    },
  },
];

export const DEFAULT_STRATEGY_ID = TRADENAYA_SMART_ID;

export function strategyInfo(id: string | null | undefined): StrategyInfo {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
}

export function isKnownStrategy(id: unknown): id is string {
  return typeof id === "string" && STRATEGIES.some((s) => s.id === id);
}

export function strategyLabel(id: string | null | undefined): string {
  if (!id) return "Unknown";
  return STRATEGIES.find((s) => s.id === id)?.label ?? id;
}
