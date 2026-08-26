import type { PnLBreakdown, PositionSnapshot } from "./PositionManagerTypes";
export class PositionPnLCalculator {
  async compute(snapshot: PositionSnapshot): Promise<PnLBreakdown> {
    const { position, currentPrice, exchangePosition } = snapshot;

    const quantity = exchangePosition?.quantity ?? position.filledQuantity ?? position.quantity ?? null;
    const entryPrice = exchangePosition?.entryPrice ?? position.entryPrice ?? null;
    const markPrice = exchangePosition?.markPrice ?? currentPrice ?? position.currentPrice ?? null;
    const leverage = exchangePosition?.leverage ?? position.leverage ?? null;

    let unrealizedPnl: number | null = null;
    if (quantity && entryPrice && markPrice) {
      const raw = position.side === "BUY" ? (markPrice - entryPrice) * quantity : (entryPrice - markPrice) * quantity;
      unrealizedPnl = this.round(raw);
    }

    return {
      unrealizedPnl,
      realizedPnl: null,
      fees: null,
      entryPrice,
      exitPrice: null,
      leverage,
      quantity,
    };
  }

  async computeRealized(snapshot: PositionSnapshot, exitPrice: number): Promise<PnLBreakdown> {
    const { position, exchangePosition } = snapshot;

    const quantity = exchangePosition?.quantity ?? position.filledQuantity ?? position.quantity ?? null;
    const entryPrice = exchangePosition?.entryPrice ?? position.entryPrice ?? null;
    const leverage = exchangePosition?.leverage ?? position.leverage ?? null;

    let realizedPnl: number | null = null;
    let fees: number | null = null;

    if (quantity && entryPrice && exitPrice) {
      const gross = position.side === "BUY" ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
      realizedPnl = this.round(gross);

      const feeRate = 0.0005;
      const notionalOpen = entryPrice * quantity;
      const notionalClose = exitPrice * quantity;
      fees = this.round((notionalOpen + notionalClose) * feeRate);
      realizedPnl = this.round(realizedPnl - (fees ?? 0));
    }

    return {
      unrealizedPnl: null,
      realizedPnl,
      fees,
      entryPrice,
      exitPrice,
      leverage,
      quantity,
    };
  }

  private round(n: number): number {
    return Math.round(n * 1e8) / 1e8;
  }
}
