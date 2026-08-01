import { NextResponse } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";


export async function GET() {

  try {

    const response = await coinSwitchRequest(
      "/futures/all-pairs/ticker",
      "GET",
      process.env.COINSWITCH_API_KEY!,
      process.env.COINSWITCH_API_SECRET!,
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