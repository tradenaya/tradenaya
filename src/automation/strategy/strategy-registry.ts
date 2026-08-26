import { TradiAuraSmartV1Strategy } from "./tradiaura";
import type { BaseStrategy } from "./types";

export class StrategyRegistry {
  private readonly strategies: BaseStrategy[] = [];

  constructor() {
    this.register(new TradiAuraSmartV1Strategy());
  }

  register(strategy: BaseStrategy) {
    this.strategies.push(strategy);
  }

  getStrategies(): BaseStrategy[] {
    return this.strategies;
  }

  getStrategy(name: string): BaseStrategy | undefined {
    return this.strategies.find((strategy) => strategy.name === name);
  }
}
