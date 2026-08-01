import { NextResponse } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";


export async function GET(){

    try{

const result = await coinSwitchRequest(
    "/24hr/all-pairs/ticker?exchange=coinswitchx",
    "GET",
    process.env.COINSWITCH_API_KEY!,
    process.env.COINSWITCH_API_SECRET!
);


        console.log(
            "TICKER RESPONSE",
            result
        );


        return NextResponse.json(result);


    }catch(error:any){

        console.log(
            "TICKER ERROR",
            error.message
        );


        return NextResponse.json(
            {
                error:error.message
            },
            {
                status:500
            }
        );

    }

}