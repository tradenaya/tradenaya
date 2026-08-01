import { NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";

export async function GET() {
  try {
    const { url, headers } = buildSignedRequest("GET", "/futures/instrument_info", {
      exchange: "EXCHANGE_2",
    });

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));

    return NextResponse.json({ success: true, data: data.data });
  } catch (error: any) {
    console.log("INSTRUMENT INFO ERROR", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}