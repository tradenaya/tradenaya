import { TradenayaSmartV1Strategy } from "./tradenaya";
import type { BaseStrategy } from "./types";

export class StrategyRegistry {
  private readonly strategies: BaseStrategy[] = [];

  constructor() {
    this.register(new TradenayaSmartV1Strategy());
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
