/**
 * Serialises work per key (e.g. one user's account in one trading mode).
 *
 * Wallet-% bots size every trade from the wallet's FREE balance at that
 * moment. Without this, two bots finishing their analysis at the same time
 * both read the same free balance and size from money the other is about to
 * use. Holding the lock from "read balance" until the order is on the exchange
 * means the next bot sees the balance that is really left.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

/** Shared by every analysis cycle in this server process. */
export const accountOrderLock = new KeyedLock();
