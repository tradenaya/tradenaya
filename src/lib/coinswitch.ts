import crypto from "crypto";

const BASE_URL = process.env.COINSWITCH_BASE_URL!;


function createSignature(
  method: string,
  path: string,
  secretKey: string,
  epoch: string
) {

  const decodedPath = decodeURIComponent(
    path.replace(/\+/g, " ")
  );


  const message =
    method.toUpperCase() +
    decodedPath +
    epoch;


  const seed = Buffer.from(
    secretKey,
    "hex"
  );


  const der = Buffer.concat([
    Buffer.from(
      "302e020100300506032b657004220420",
      "hex"
    ),
    seed,
  ]);


  const privateKey = crypto.createPrivateKey({
    key: der,
    format: "der",
    type: "pkcs8",
  });


  const signature = crypto.sign(
    null,
    Buffer.from(message, "utf8"),
    privateKey
  )
  .toString("hex");


  return signature;
}



export async function coinSwitchRequest(
  endpoint: string,
  method: "GET" | "POST",
  apiKey: string,
  apiSecret: string,
  body?: any,
  params?: any
) {

  let url = `${BASE_URL}${endpoint}`;

  let signPath = `/trade/api/v2${endpoint}`;   // ← added prefix here

  if (params) {
    const query = new URLSearchParams(params).toString();
    url += `?${query}`;
    signPath = `/trade/api/v2${endpoint}?${query}`;   // ← added prefix here too
  }

  const epoch = Date.now().toString();

  const signature = createSignature(
    method,
    signPath,
    apiSecret,
    epoch
  );

  // ... rest of the function stays exactly the same
console.log("========== COINSWITCH REQUEST ==========");
console.log("URL:", url);
console.log("SIGN PATH:", signPath);
console.log("METHOD:", method);
console.log("EPOCH:", epoch);
console.log("API KEY:", apiKey);
console.log("========================================");

  const response = await fetch(url, {

    method,

    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey,
      "X-AUTH-SIGNATURE": signature,
      "X-AUTH-EPOCH": epoch,
    },


    body:
      method === "POST" && body
        ? JSON.stringify(body)
        : undefined,

  });



  const data = await response.json();



  if (!response.ok) {

    throw new Error(
      JSON.stringify(data)
    );

  }



  return data;
}