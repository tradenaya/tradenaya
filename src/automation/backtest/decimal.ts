/**
 * Fixed-point money type backed by BigInt scaled integers.
 *
 * The project's live code uses plain numbers rounded to 8 decimals, but the
 * backtest accumulates account balances, PnL and fees across many trades, so
 * floating point drift matters. This helper keeps every monetary accumulation
 * in 8-decimal fixed point and only converts back to a number at the edges
 * (candle prices, quantities, and final results), matching the codebase's
 * 1e-8 rounding convention.
 */

const SCALE = 100_000_000n; // 8 decimals
const SCALE_NUM = 1e8;

export class Money {
  private constructor(private readonly raw: bigint) {}

  static zero(): Money {
    return new Money(0n);
  }

  static fromRaw(raw: bigint): Money {
    return new Money(raw);
  }

  /** Convert a floating-point amount to fixed point (rounds to 8 dp). */
  static fromNumber(value: number): Money {
    if (!Number.isFinite(value)) return new Money(0n);
    return new Money(BigInt(Math.round(value * SCALE_NUM)));
  }

  /** Product of a monetary value and a plain scalar, rounded to 8 dp. */
  mulScalar(scalar: number): Money {
    if (!Number.isFinite(scalar) || scalar === 0) return new Money(0n);
    return new Money(BigInt(Math.round(Number(this.raw) * scalar)));
  }

  add(other: Money): Money {
    return new Money(this.raw + other.raw);
  }

  sub(other: Money): Money {
    return new Money(this.raw - other.raw);
  }

  neg(): Money {
    return new Money(-this.raw);
  }

  abs(): Money {
    return this.raw < 0n ? new Money(-this.raw) : this;
  }

  isZero(): boolean {
    return this.raw === 0n;
  }

  isNegative(): boolean {
    return this.raw < 0n;
  }

  isPositive(): boolean {
    return this.raw > 0n;
  }

  gt(other: Money): boolean {
    return this.raw > other.raw;
  }

  gte(other: Money): boolean {
    return this.raw >= other.raw;
  }

  lt(other: Money): boolean {
    return this.raw < other.raw;
  }

  lte(other: Money): boolean {
    return this.raw <= other.raw;
  }

  max(other: Money): Money {
    return this.raw >= other.raw ? this : other;
  }

  min(other: Money): Money {
    return this.raw <= other.raw ? this : other;
  }

  /** Ratio of two monetary values (losses represented as negative). */
  ratioOf(other: Money): number {
    if (other.isZero()) return 0;
    return Number(this.raw) / Number(other.raw);
  }

  toNumber(): number {
    return Number(this.raw) / SCALE_NUM;
  }

  toFixed(decimals = 2): string {
    return this.toNumber().toFixed(decimals);
  }

  toString(): string {
    return this.toFixed(8);
  }
}
