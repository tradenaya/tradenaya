import { NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";

async function callSigned(method: "GET" | "POST", endpoint: string, payload?: Record<string, any>) {
  const { url, headers } = buildSignedRequest(method, endpoint, method === "GET" ? payload : undefined);

  const res = await fetch(url, {
    method,
    headers,
    ...(method === "POST" && payload ? { body: JSON.stringify(payload) } : {}),
  });

  const raw = await res.text();
  const data = JSON.parse(raw);

  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.data;
}

export async function GET() {
  try {
    // Step 1: find every symbol you've ever had open orders on (last 7 days,
    // per docs' time-window limit) — this is our best proxy for "symbols I trade"
    const openOrdersData = await callSigned("POST", "/futures/orders/open", {
      exchange: "EXCHANGE_2",
      limit: 50,
    });

    const symbolsFromOrders = new Set<string>(
      (openOrdersData.orders ?? []).map((o: any) => o.symbol)
    );

    // Step 2: also check closed orders, in case a position is open from a
    // trade placed a while back with no currently-open order
    const closedOrdersData = await callSigned("POST", "/futures/orders/closed", {
      exchange: "EXCHANGE_2",
      limit: 50,
    });

    (closedOrdersData.orders ?? []).forEach((o: any) => symbolsFromOrders.add(o.symbol));

    const symbols = Array.from(symbolsFromOrders);

    // Step 3: check positions for each candidate symbol
    const positionResults = await Promise.allSettled(
      symbols.map((symbol) =>
        callSigned("GET", "/futures/positions", {
          exchange: "EXCHANGE_2",
          symbol: symbol.toLowerCase(),
        })
      )
    );

    const positions = positionResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .flatMap((r) => (Array.isArray(r.value) ? r.value : []))
      .filter((p) => p && Number(p.position_size) > 0);

    return NextResponse.json({ success: true, data: positions });
  } catch (error: any) {
    console.log("ALL POSITIONS ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}