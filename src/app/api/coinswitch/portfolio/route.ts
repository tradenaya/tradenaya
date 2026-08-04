import { NextResponse, NextRequest } from "next/server";
import crypto from "crypto";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

const BASE_URL = process.env.COINSWITCH_BASE_URL!;

function createSignature(
  method: string,
  path: string,
  secretKey: string,
  epoch: string
) {

  const decodedPath =
    decodeURIComponent(
      path.replace(/\+/g, " ")
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
      key: der,
      format: "der",
      type: "pkcs8"
    });

  return crypto
    .sign(
      null,
      Buffer.from(message),
      privateKey
    )
    .toString("hex");
}

export async function GET(req: NextRequest) {

  try {

    const endpoint =
      "/user/portfolio";

    const signPath =
      `/trade/api/v2${endpoint}`;

    const epoch =
      Date.now().toString();

    const keys = await getKeysFromRequest(req as any);
    const apiSecret = keys?.apiSecret;
    const apiKey = keys?.apiKey;

    if (!apiKey || !apiSecret) {
      throw new Error("No saved CoinSwitch credentials were found for this account. Please reconnect your CoinSwitch account.");
    }

    const signature = createSignature("GET", signPath, apiSecret, epoch);

    console.log("========== PORTFOLIO ==========");
    console.log("URL:", `${BASE_URL}${endpoint}`);
    console.log("SIGN PATH:", signPath);
    console.log("EPOCH:", epoch);
    console.log("===============================");

    const response =
      await fetch(
        `${BASE_URL}${endpoint}`,
        {
          method: "GET",

          headers: {
            "Content-Type":
              "application/json",

            "X-AUTH-APIKEY": apiKey,

            "X-AUTH-SIGNATURE":
              signature,

            "X-AUTH-EPOCH":
              epoch,
          },
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      console.log(
        "PORTFOLIO ERROR:",
        data
      );

      throw new Error(
        JSON.stringify(data)
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });

  } catch (error: any) {

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      {
        status: 500,
      }
    );

  }

}