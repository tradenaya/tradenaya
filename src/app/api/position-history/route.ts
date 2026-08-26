import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { type } = parseFilters(new URL(req.url));
    const service = getAnalyticsService();
    
    // Fetch closed trades
    const closedTrades = await service.getClosedTrades(userId, parseFilters(new URL(req.url)));
    
    let activePositions = [];
    // Fetch active positions if type is 'active' or 'all'
    if (type !== "closed") {
      const { botId } = parseFilters(new URL(req.url));
      const positions = await service.getOpenPositions(userId, botId ?? undefined);
      activePositions = positions.map((p) => ({
        id: p.id,
        botId: p.botId,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        unrealizedPnl: p.unrealizedPnl,
        entryTime: p.createdAt,
        state: position.state,
      });
    }
    
    return ok({
      closed: closedTrades.map((t) => ({
        tradeId: t.id,
        symbol: t.symbol,
        side: t.side,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        profitLoss: t.realized_pnl,
        // Percentage ROI: (profit / (entry_price * |position_size|)) * 100
        percentage: t.entryPrice != null && t.position_size != null 
          ? ((t.realized_pnl / (t.entry_price * Math.abs(t.position_size))) * 100).toFixed(2) + "%" 
          : null,
        closedAt: t.closedAt,
      })),
      active: activePositions,
    });
  } catch (error: any) {
    return fail(500, error?.message ?? "Failed to load position history");
  }
}