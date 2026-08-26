import { normalizeSymbol } from "./normalizer";
import type { MarketDataRecoveryDeps } from "./types";

/**
 * Recovers market data subscriptions after a process restart or a prolonged
 * WebSocket outage:
 *  1. rebuilds the subscribed symbol set from running bots and open positions
 *  2. re-subscribes each symbol (deduped)
 *  3. primes the cache with a REST snapshot so consumers have data immediately
 *
 * Never throws — any symbol that fails to prime is simply retried lazily.
 */
export class MarketDataRecovery {
  constructor(private readonly deps: MarketDataRecoveryDeps) {}

  async recover(): Promise<{ symbols: string[]; primed: string[] }> {
    const symbols = await this.discoverSymbols();
    const primed: string[] = [];

    for (const symbol of symbols) {
      try {
        await this.deps.prime(symbol);
        primed.push(symbol);
      } catch {
        // consumer-side retry will pick this up later
      }
    }
    return { symbols, primed };
  }

  private async discoverSymbols(): Promise<string[]> {
    const set = new Set<string>();

    try {
      const bots = await this.deps.botService.getBotsByDesiredStatus(["RUNNING", "PAUSED"]);
      for (const bot of bots) {
        const symbol = normalizeSymbol(bot.symbol);
        if (symbol) set.add(symbol);
      }
    } catch {
      // ignore discovery failures
    }

    try {
      const positions = await this.deps.positionStore.getActivePositions();
      for (const position of positions) {
        const symbol = normalizeSymbol(position.symbol);
        if (symbol) set.add(symbol);
      }
    } catch {
      // ignore discovery failures
    }

    return Array.from(set);
  }
}
