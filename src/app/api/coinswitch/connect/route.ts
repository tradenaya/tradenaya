import { NextResponse } from "next/server";
import { verifyConnection } from "@/app/services/coinswitch.service";
import {
 startCoinSwitchSocket
} from "@/app/services/market/coinswitch.socket";


export async function POST() {

  try {

    const apiKey =
      process.env.COINSWITCH_API_KEY;

    const apiSecret =
      process.env.COINSWITCH_API_SECRET;


    if (!apiKey || !apiSecret) {

      return NextResponse.json(
        {
          success:false,
          message:"CoinSwitch credentials missing in environment variables"
        },
        {
          status:500
        }
      );

    }


    const response =
      await verifyConnection(
        apiKey,
        apiSecret
      );

const coinsResponse =
 await fetch(
  "https://coinswitch.co/trade/api/v2/coins?exchange=c2c1"
 );


const coinsData =
 await coinsResponse.json();


console.log(
 "COINS RESPONSE",
 coinsData
);
    return NextResponse.json(
      {
        success:true,
        data:response
      }
    );


  } catch(error:any) {


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