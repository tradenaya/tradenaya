import type { OpenOrderSnapshot, OpenPositionSnapshot, RiskCheckResult } from "./types";

export interface ExposureManagerInput {
  symbol: string;
  openPositions: OpenPositionSnapshot[];
  openOrders: OpenOrderSnapshot[];
  runningBots: number;
  maxSimultaneousPositions: number;
  maxSimultaneousBots: number;
}

export interface ExposureManager {
  check(input: ExposureManagerInput): RiskCheckResult[];
}

export class DefaultExposureManager implements ExposureManager {
  check(input: ExposureManagerInput): RiskCheckResult[] {
    const checks: RiskCheckResult[] = [];
    const symbol = input.symbol.toUpperCase();

    if (input.openPositions.length >= input.maxSimultaneousPositions) {
      checks.push({
        name: "max-simultaneous-positions",
        passed: false,
        message: `Maximum simultaneous positions reached (${input.openPositions.length} of ${input.maxSimultaneousPositions}).`,
      });
    } else {
      checks.push({
        name: "max-simultaneous-positions",
        passed: true,
        message: `Open positions ${input.openPositions.length} are below the maximum of ${input.maxSimultaneousPositions}.`,
      });
    }

    if (input.runningBots >= input.maxSimultaneousBots) {
      checks.push({
        name: "max-simultaneous-bots",
        passed: false,
        message: `Maximum simultaneous bots reached (${input.runningBots} of ${input.maxSimultaneousBots}).`,
      });
    } else {
      checks.push({
        name: "max-simultaneous-bots",
        passed: true,
        message: `Running bots ${input.runningBots} are below the maximum of ${input.maxSimultaneousBots}.`,
      });
    }

    if (input.openPositions.some((position) => position.symbol.toUpperCase() === symbol)) {
      checks.push({
        name: "existing-position-symbol",
        passed: false,
        message: `A position is already open for ${input.symbol}.`,
      });
    } else {
      checks.push({
        name: "existing-position-symbol",
        passed: true,
        message: `No existing open position for ${input.symbol}.`,
      });
    }

    if (input.openOrders.some((order) => order.symbol.toUpperCase() === symbol && order.type.toUpperCase() === "LIMIT" && !order.reduceOnly)) {
      checks.push({
        name: "pending-limit-order",
        passed: false,
        message: `A pending LIMIT order already exists for ${input.symbol}.`,
      });
    } else {
      checks.push({
        name: "pending-limit-order",
        passed: true,
        message: `No pending entry LIMIT order for ${input.symbol}.`,
      });
    }

    return checks;
  }
}
