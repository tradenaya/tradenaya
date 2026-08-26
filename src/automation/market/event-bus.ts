import type { MarketDataEvent, MarketDataEventType } from "./types";

export type MarketDataHandler = (event: MarketDataEvent) => void;

/**
 * Lightweight in-memory event bus for market-data events.
 * High-frequency by design — nothing here touches the database.
 */
export class MarketDataEventBus {
  private readonly handlers = new Map<MarketDataEventType, Set<MarketDataHandler>>();

  on(type: MarketDataEventType, handler: MarketDataHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  emit(event: MarketDataEvent): void {
    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch (error) {
        console.error(`MarketDataEventBus: handler failed for ${event.type}`, error);
      }
    }
  }
}
