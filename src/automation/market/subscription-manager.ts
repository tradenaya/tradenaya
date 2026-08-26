import { normalizeSymbol } from "./normalizer";
import type { MarketSubscription } from "./types";

/**
 * Centralized subscription manager for symbols across all consumers.
 *
 * Guarantees:
 *  - one logical subscription per symbol no matter how many consumers request it
 *  - reference counting so a symbol is released only when the last consumer leaves
 *  - the set of symbols to (re)subscribe after a reconnect is always available
 */
export class MarketDataSubscriptionManager {
  private readonly subscriptions = new Map<string, MarketSubscription>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Register a consumer for a symbol. Returns the subscription record. */
  subscribe(symbol: string, consumerId: string): MarketSubscription {
    const key = normalizeSymbol(symbol);
    const existing = this.subscriptions.get(key);
    if (existing) {
      if (!existing.consumerIds.includes(consumerId)) {
        existing.consumerIds.push(consumerId);
        existing.lastRefreshedAt = this.now();
      }
      return existing;
    }
    const subscription: MarketSubscription = {
      symbol: key,
      consumerIds: [consumerId],
      createdAt: this.now(),
      lastRefreshedAt: this.now(),
      websocketSubscribed: false,
    };
    this.subscriptions.set(key, subscription);
    return subscription;
  }

  /** Remove one consumer. Returns true when the symbol has no consumers left. */
  unsubscribe(symbol: string, consumerId: string): boolean {
    const key = normalizeSymbol(symbol);
    const existing = this.subscriptions.get(key);
    if (!existing) return false;
    existing.consumerIds = existing.consumerIds.filter((id) => id !== consumerId);
    if (existing.consumerIds.length === 0) {
      this.subscriptions.delete(key);
      return true;
    }
    return false;
  }

  hasConsumers(symbol: string): boolean {
    return (this.subscriptions.get(normalizeSymbol(symbol))?.consumerIds.length ?? 0) > 0;
  }

  consumerCount(symbol: string): number {
    return this.subscriptions.get(normalizeSymbol(symbol))?.consumerIds.length ?? 0;
  }

  getSymbols(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  getSubscriptions(): MarketSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  get(symbol: string): MarketSubscription | null {
    return this.subscriptions.get(normalizeSymbol(symbol)) ?? null;
  }

  markSubscribed(symbol: string, subscribed: boolean): void {
    const key = normalizeSymbol(symbol);
    const existing = this.subscriptions.get(key);
    if (existing) existing.websocketSubscribed = subscribed;
  }

  getPendingSymbols(): string[] {
    return this.getSymbols().filter((symbol) => !this.subscriptions.get(symbol)?.websocketSubscribed);
  }

  clear(): void {
    this.subscriptions.clear();
  }
}
