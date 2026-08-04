import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.TRADIAURA_AUTH_SECRET || process.env.JWT_SECRET || "tradenaya-local-dev-secret";
const JWT_EXPIRES_IN = "7d" as const;

export interface AdminPayload {
  userId: number;
  tenantId: number;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

export interface CustomerPayload {
  customerId: number;
  tenantId: number;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

export function signTradenayaToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function getAdminFromRequest(request: NextRequest): AdminPayload | null {
  const token = request.cookies.get("tradenaya_admin_token")?.value;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminPayload;
    if (!decoded.tenantId || !decoded.userId) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function getCustomerFromRequest(request: NextRequest): CustomerPayload | null {
  const token = request.cookies.get("tradenaya_user_token")?.value;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as CustomerPayload;
    if (!decoded.tenantId || !decoded.customerId) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function unauthorized() {
  return Response.json({ message: "Unauthorized" }, { status: 401 });
}
