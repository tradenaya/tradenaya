import { NextResponse, NextRequest } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { requireKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { errorResponse } from "@/lib/api-error";


export async function GET(req: NextRequest) {

  try {

    const keys = await requireKeysFromRequest(req as any, { allowServerKeys: true });

    const response = await coinSwitchRequest(
      "/futures/all-pairs/ticker",
      "GET",
      keys?.apiKey || process.env.COINSWITCH_API_KEY!,
      keys?.apiSecret || process.env.COINSWITCH_API_SECRET!,
      undefined,
      {
        exchange: "EXCHANGE_2"
      }
    );


    return NextResponse.json({
      success:true,
      data:response.data
    });


  } catch(error:any){

    return errorResponse(error, 500, "Failed to load futures prices", "/api/coinswitch/futures/ticker");

  }

}