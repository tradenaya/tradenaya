import { NextResponse, NextRequest } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";


export async function GET(req: NextRequest) {

  try {

    const keys = await getKeysFromRequest(req as any);

    const apiKey = keys?.apiKey;
    const apiSecret = keys?.apiSecret;

    if (!apiKey || !apiSecret) {
      throw new Error("No saved CoinSwitch credentials were found for this account. Please reconnect your CoinSwitch account.");
    }

    const response = await coinSwitchRequest(
      "/futures/all-pairs/ticker",
      "GET",
      apiKey,
      apiSecret,
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