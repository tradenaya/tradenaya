/**
 * Single source of truth for the minimum risk/reward ratio used by trade
 * validation. Every layer that enforces a min-R:R floor must resolve its value
 * through `resolveMinRiskRewardRatio` so a candidate can never be judged against
 * two different floors (this was the historical bug: the planner validated
 * against 1.5 while the live account risk gate silently defaulted to 2.0).
 *
 * The fallback (1.5) matches the strategy's own documented RR floor
 * (`TRADIAURA_THRESHOLDS.rrMin`) and the planner's historic default.
 */
export const DEFAULT_MIN_RISK_REWARD_RATIO = 1.5;

export type MinRiskRewardSource = "bot-config" | "strategy-config" | "fallback";

export interface ResolvedMinRiskReward {
  value: number;
  /** Where the resolved floor came from — surfaced in every R:R rejection log. */
  source: MinRiskRewardSource;
}

/**
 * Resolve the one and only minimum R:R floor for a candidate.
 *
 * - bot-config: the user explicitly set `minRiskRewardRatio` on the bot.
 * - fallback: no explicit config -> documented system default (1.5).
 *
 * (strategy-config is reserved for a future per-strategy override; no strategy
 * currently overrides it.)
 */
export function resolveMinRiskReward(
  config: { minRiskRewardRatio?: number },
): ResolvedMinRiskReward {
  const configured = Number(config.minRiskRewardRatio);
  if (Number.isFinite(configured) && configured > 0) {
    return { value: configured, source: "bot-config" };
  }
  return { value: DEFAULT_MIN_RISK_REWARD_RATIO, source: "fallback" };
}