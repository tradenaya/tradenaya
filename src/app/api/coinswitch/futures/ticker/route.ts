import { NextResponse, NextRequest } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";


export async function GET(req: NextRequest) {

  try {

    const keys = await getKeysFromRequest(req as any);

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

    console.log(
      "FUTURES TICKER ERROR",
      error
    );


    return NextResponse.json(
      {
        success:false,
        message:error.message
      },
      {
        status:500
      }
    );

  }

}