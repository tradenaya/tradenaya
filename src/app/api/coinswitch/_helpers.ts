import { NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import { getKeysForUser } from "@/lib/coinswitch.store";

export async function getKeysFromRequest(req: NextRequest) {
  const customer = getCustomerFromRequest(req as any as NextRequest);
  if (!customer) return null;
  const keys = await getKeysForUser(customer.customerId);
  return keys;
}
