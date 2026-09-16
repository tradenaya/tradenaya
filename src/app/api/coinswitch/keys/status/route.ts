import { NextResponse, NextRequest } from "next/server";
import { getKeyMetaForUser, setExpiryForUser } from "@/lib/coinswitch.store";
import { getCustomerFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const customer = getCustomerFromRequest(request);
    if (!customer) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const meta = await getKeyMetaForUser(customer.customerId);

    if (!meta) {
      return NextResponse.json({ success: true, connected: false });
    }

    const createdAt = meta.createdAt instanceof Date ? meta.createdAt : new Date(meta.createdAt);
    const validUntil = meta.validUntil instanceof Date ? meta.validUntil : null;

    const daysLeft =
      validUntil != null && !Number.isNaN(validUntil.getTime())
        ? Math.ceil((validUntil.getTime() - Date.now()) / 86_400_000)
        : null;

    return NextResponse.json({
      success: true,
      connected: true,
      apiKeyMasked: meta.apiKeyMasked,
      status: meta.status,
      createdAt: createdAt.toISOString(),
      validUntil: validUntil && !Number.isNaN(validUntil.getTime()) ? validUntil.toISOString() : null,
      daysLeft,
    });
  } catch {
    return NextResponse.json({ success: false, message: "Failed to load key status" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const customer = getCustomerFromRequest(request);
    if (!customer) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validUntil: string | null | undefined = body?.validUntil;

    if (!validUntil) {
      return NextResponse.json({ success: false, message: "Please provide a valid expiry date." }, { status: 400 });
    }
    if (Number.isNaN(Date.parse(validUntil))) {
      return NextResponse.json({ success: false, message: "The expiry date is not valid." }, { status: 400 });
    }

    await setExpiryForUser(customer.customerId, validUntil);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, message: "Failed to save key expiry" }, { status: 500 });
  }
}
