import { NextResponse, NextRequest } from "next/server";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { convertInrToUsdt, CoinSwitchAccessError } from "@/lib/coinswitch/convert";
import { db } from "@/lib/db";
import { getCustomerFromRequest } from "@/lib/auth";

async function ensureConvertHistoryTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS inr_to_usdt_conversions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NULL,
      user_email VARCHAR(255) NULL,
      amount_inr DECIMAL(18, 8) NOT NULL,
      inr_spent DECIMAL(18, 8) NULL,
      usdt_received DECIMAL(18, 8) NULL,
      rate DECIMAL(18, 8) NULL,
      fee DECIMAL(18, 8) NULL,
      status VARCHAR(40) NOT NULL,
      message TEXT NULL,
      exchange_order_id VARCHAR(255) NULL,
      client_order_id VARCHAR(255) NULL,
      raw_response JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function saveConversionRecord(payload: {
  userId: number | null;
  userEmail: string | null;
  amountInr: number;
  inrSpent: number | null;
  usdtReceived: number | null;
  rate: number | null;
  fee: number | null;
  status: string;
  message: string | null;
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  rawResponse: string | null;
}) {
  try {
    await ensureConvertHistoryTable();
    await db.query(
      `INSERT INTO inr_to_usdt_conversions (
        user_id, user_email, amount_inr, inr_spent, usdt_received, rate, fee,
        status, message, exchange_order_id, client_order_id, raw_response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        payload.userId,
        payload.userEmail,
        payload.amountInr,
        payload.inrSpent ?? null,
        payload.usdtReceived ?? null,
        payload.rate ?? null,
        payload.fee ?? null,
        payload.status,
        payload.message,
        payload.exchangeOrderId,
        payload.clientOrderId,
        payload.rawResponse,
      ],
    );
  } catch (error) {
    console.error("FAILED TO SAVE INR→USDT CONVERSION", error);
  }
}

export async function POST(req: NextRequest) {
  let customer: { customerId: number; email: string | null } | null = null;
  try {
    customer = getCustomerFromRequest(req);
  } catch {
    customer = null;
  }

  let body: { amountInr?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }

  const amountInr = Number(body.amountInr);
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    return NextResponse.json({ success: false, message: "Enter how much INR you want to convert (a number greater than zero)." }, { status: 400 });
  }

  const keys = await getKeysFromRequest(req);
  if (!keys?.apiKey || !keys?.apiSecret) {
    return NextResponse.json(
      { success: false, message: "Not authenticated — please sign in and reconnect your CoinSwitch account." },
      { status: 401 },
    );
  }

  try {
    const result = await convertInrToUsdt({ apiKey: keys.apiKey, apiSecret: keys.apiSecret }, amountInr);

    await saveConversionRecord({
      userId: customer?.customerId ?? null,
      userEmail: customer?.email ?? null,
      amountInr,
      inrSpent: result.inrSpent,
      usdtReceived: result.usdtReceived,
      rate: result.rate,
      fee: result.fee,
      status: result.status,
      message: null,
      exchangeOrderId: result.orderId,
      clientOrderId: result.clientOrderId,
      rawResponse: JSON.stringify(result),
    });

    return NextResponse.json({
      success: true,
      data: {
        amountInr,
        inrSpent: result.inrSpent,
        usdtReceived: result.usdtReceived,
        rate: result.rate,
        fee: result.fee,
        orderId: result.orderId,
        status: result.status,
        note: "USDT is credited to your CoinSwitch exchange (spot) wallet. Move it to your Futures wallet in CoinSwitch PRO → Wallet → Transfer so your bots can trade with it.",
      },
    });
  } catch (error: any) {
    const message = error?.message ?? "Failed to convert INR to USDT — please try again.";
    const status = error instanceof CoinSwitchAccessError && error.status ? error.status : 400;

    await saveConversionRecord({
      userId: customer?.customerId ?? null,
      userEmail: customer?.email ?? null,
      amountInr,
      inrSpent: null,
      usdtReceived: null,
      rate: null,
      fee: null,
      status: "FAILED",
      message,
      exchangeOrderId: null,
      clientOrderId: null,
      rawResponse: JSON.stringify({ error: message }),
    });

    return NextResponse.json({ success: false, message, statusCode: status }, { status });
  }
}