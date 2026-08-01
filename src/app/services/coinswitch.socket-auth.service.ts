import { coinSwitchRequest } from "@/lib/coinswitch";


export async function getSocketCredentials(
  apiKey:string,
  apiSecret:string
){

  return coinSwitchRequest(
    "/dma/api/v1/socket/signature",
    "GET",
    apiKey,
    apiSecret,
  );

}