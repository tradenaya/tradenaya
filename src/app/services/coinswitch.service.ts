import { coinSwitchRequest } from "@/lib/coinswitch";


export async function verifyConnection(
  apiKey: string,
  apiSecret: string
) {

  return coinSwitchRequest(
    "/user/portfolio",
    "GET",
    apiKey,
    apiSecret
  );

}


export async function getPortfolio(
  apiKey: string,
  apiSecret: string
) {

  return coinSwitchRequest(
    "/user/portfolio",
    "GET",
    apiKey,
    apiSecret
  );

}


export async function getBalance(
  apiKey: string,
  apiSecret: string
) {

  return coinSwitchRequest(
    "/user/balance",
    "GET",
    apiKey,
    apiSecret
  );

}