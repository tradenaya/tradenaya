import { NextResponse, NextRequest } from "next/server";
import crypto from "crypto";
import { requireKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { errorResponse, HttpError } from "@/lib/api-error";

const BASE_URL = process.env.COINSWITCH_BASE_URL!;


function createSignature(
  method:string,
  path:string,
  secretKey:string,
  epoch:string
){

  const decodedPath =
    decodeURIComponent(
      path.replace(/\+/g," ")
    );


  const message =
    method.toUpperCase() +
    decodedPath +
    epoch;


  const seed =
    Buffer.from(
      secretKey,
      "hex"
    );


  const der =
    Buffer.concat([
      Buffer.from(
        "302e020100300506032b657004220420",
        "hex"
      ),
      seed
    ]);


  const privateKey =
    crypto.createPrivateKey({
      key:der,
      format:"der",
      type:"pkcs8"
    });



  return crypto.sign(
    null,
    Buffer.from(message),
    privateKey
  )
  .toString("hex");

}



export async function GET(req: NextRequest){

 try{


 const {searchParams} =
   new URL(req.url);


 const symbol =
   searchParams.get("symbol");

 if (!symbol) {
   throw new HttpError(400, "The 'symbol' query parameter is required, e.g. /api/coinswitch/futures/kline?symbol=BTCUSDT&interval=5", "MISSING_SYMBOL");
 }


 const interval =
   searchParams.get("interval") || "5";



 const query =
 new URLSearchParams({

   exchange:"EXCHANGE_2",
   symbol:symbol.toLowerCase(),
   interval,
   limit:"100"

 }).toString();



 const endpoint =
 `/futures/klines?${query}`;



 const signPath =
 `/trade/api/v2${endpoint}`;



 const epoch =
 Date.now().toString();



    const keys = await requireKeysFromRequest(req as any, { allowServerKeys: true });
    const apiSecret = keys?.apiSecret || process.env.COINSWITCH_API_SECRET!;
    const apiKey = keys?.apiKey || process.env.COINSWITCH_API_KEY!;

    const signature = createSignature("GET", signPath, apiSecret, epoch);



 const response =
 await fetch(
 `${BASE_URL}${endpoint}`,
 {
   method:"GET",

   headers:{
     "Content-Type":"application/json",
     "X-AUTH-APIKEY": apiKey,
     "X-AUTH-SIGNATURE": signature,
     "X-AUTH-EPOCH": epoch
   }
 }
 );



 const data =
 await response.json();



 if(!response.ok)
   throw new Error(
    JSON.stringify(data)
   );



 return NextResponse.json({
   success:true,
   data:data.data
 });


 }
 catch(error:any){

  return errorResponse(error, 500, "Failed to load candles", "/api/coinswitch/futures/kline");


 }

}