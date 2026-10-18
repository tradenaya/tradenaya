import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, parsePagedQuery, requireUserId } from "../analytics/_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const url = new URL(req.url);
    const filters = parseFilters(url);
    const { page, pageSize, sortBy, sortDir } = parsePagedQuery(url);
    const service = getAnalyticsService();

    const [tradesResult, positions, allTrades] = await Promise.all([
      service.getTrades(userId, filters, page, pageSize, sortBy, sortDir),
      service.getPositions(userId, filters.botId ?? undefined),
      service.getTrades(userId, filters, 1, 10000, "closedAt", "asc"),
    ]);

    const allSorted = allTrades.items;
    let cumulative = 0;
    const balanceAfterMap = new Map<number, number>();
    for (const t of allSorted) {
      cumulative += t.netPnl;
      balanceAfterMap.set(t.id, cumulative);
    }

    return ok({
      closed: tradesResult.items.map((t) => {
        const investment = t.entryPrice * Math.abs(t.quantity);
        // Your own money in the trade (margin); returns are shown against it,
        // the same way the exchange shows ROE.
        const margin = t.leverage && t.leverage > 0 ? investment / t.leverage : investment;
        const priceMovePct = t.entryPrice > 0 ? ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 : 0;
        const upperReason = (t.exitReason ?? "").toUpperCase();
        const isWin = t.netPnl > 0;
        const isLoss = t.netPnl < 0;
        let outcome: "WIN" | "LOSS" | "BREAKEVEN" = "BREAKEVEN";
        if (isWin) outcome = "WIN";
        else if (isLoss) outcome = "LOSS";

        return {
          id: t.id,
          tradeId: t.tradeId,
          symbol: t.symbol,
          side: t.side,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          quantity: t.quantity,
          investment,
          profitLoss: t.netPnl,
          realizedPnl: t.realizedPnl,
          grossProfit: t.grossProfit,
          commission: t.commission,
          fundingFee: t.fundingFee,
          fees: t.fees,
          margin,
          executionId: t.executionId ?? null,
          priceMovePct,
          /** Net P&L as a % of your own money (margin). */
          percentage: margin > 0 ? (t.netPnl / margin) * 100 : 0,
          exitReason: t.exitReason,
          outcome,
          botName: t.botName,
          strategy: t.strategy,
          leverage: t.leverage,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          durationMs: t.durationMs,
          balanceAfter: balanceAfterMap.get(t.id) ?? null,
          stopLoss: t.stopLoss ?? null,
          takeProfit: t.takeProfit ?? null,
          trailingActivated: t.trailingActivated,
          highestPrice: t.highestPrice ?? null,
          lowestPrice: t.lowestPrice ?? null,
          positionSize: t.quantity,
        };
      }),
      active: positions.map((p) => ({
        positionId: p.positionId,
        botId: p.botId,
        botName: p.botName,
        symbol: p.symbol,
        side: p.side,
        state: p.state,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        unrealizedPnl: p.unrealizedPnl,
        quantity: p.filledQuantity ?? p.quantity,
        margin: p.margin,
        leverage: p.leverage,
        openTime: p.openTime,
        durationMs: p.durationMs,
        stopLoss: p.stopLoss ?? null,
        takeProfit: p.takeProfit ?? null,
        trailingActivated: p.trailingActivated,
      })),
      total: tradesResult.total,
      page: tradesResult.page,
      pageSize: tradesResult.pageSize,
      totalPages: tradesResult.totalPages,
    });
  } catch (error: any) {
    console.error("[position-history]", error);
    return errorResponse(error, 500, "Failed to load position history", "/api/position-history");
  }
}
