import {
  coinSwitchRequest
} from "@/lib/coinswitch";


export async function getMarketCoins(
  apiKey:string,
  apiSecret:string
){

  return coinSwitchRequest(
    "/trade/api/v2/coins",
    "GET",
    apiKey,
    apiSecret,
    undefined,
    {
      exchange:"c2c1"
    }
  );

}