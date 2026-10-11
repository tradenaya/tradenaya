import { NextResponse, NextRequest } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { requireKeysFromRequest, paperFetch } from "@/app/api/coinswitch/_helpers";
import { errorResponse } from "@/lib/api-error";

async function callSigned(req: NextRequest, method: "GET" | "POST", endpoint: string, payload?: Record<string, any>) {
  const keys = await requireKeysFromRequest(req as any);
  const { url, headers } = buildSignedRequest(method, endpoint, method === "GET" ? payload : undefined, keys?.apiKey, keys?.apiSecret);

  const res = (await paperFetch(req as any, method, endpoint, payload)) ?? await fetch(url, { method, headers, ...(method === "POST" && payload ? { body: JSON.stringify(payload) } : {}) });

  const raw = await res.text();
  const data = JSON.parse(raw);

  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.data;
}

export async function GET(req: NextRequest) {
  try {
    // Step 1: find every symbol you've ever had open orders on (last 7 days,
    // per docs' time-window limit) — this is our best proxy for "symbols I trade"
    const openOrdersData = await callSigned(req, "POST", "/futures/orders/open", { exchange: "EXCHANGE_2", limit: 50 });

    // Normalise case: the same coin can appear as "BTCUSDT" and "btcusdt" across
    // order lists; without this it is queried twice and its position duplicated.
    const symbolsFromOrders = new Set<string>(
      (openOrdersData.orders ?? []).map((o: { symbol?: unknown }) => String(o.symbol ?? "").toUpperCase()).filter(Boolean)
    );

    // Step 2: also check closed orders, in case a position is open from a
    // trade placed a while back with no currently-open order
    const closedOrdersData = await callSigned(req, "POST", "/futures/orders/closed", { exchange: "EXCHANGE_2", limit: 50 });

    (closedOrdersData.orders ?? []).forEach((o: { symbol?: unknown }) => {
      const symbol = String(o.symbol ?? "").toUpperCase();
      if (symbol) symbolsFromOrders.add(symbol);
    });

    const symbols = Array.from(symbolsFromOrders);

    // Step 3: check positions for each candidate symbol
    const positionResults = await Promise.allSettled(symbols.map((symbol) => callSigned(req, "GET", "/futures/positions", { exchange: "EXCHANGE_2", symbol: symbol.toLowerCase() })));

    const seen = new Set<string>();
    const positions = positionResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .flatMap((r) => (Array.isArray(r.value) ? r.value : []))
      .filter((p) => p && Number(p.position_size) > 0)
      // One entry per exchange position, even if two lookups returned it.
      .filter((p) => {
        const key = String(p.position_id ?? `${String(p.symbol).toUpperCase()}:${p.position_side}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return NextResponse.json({ success: true, data: positions });
  } catch (error: any) {
    console.log("ALL POSITIONS ERROR", error);
    return errorResponse(error, 500, "Request failed", "/api/coinswitch/futures/all-positions");
  }
}