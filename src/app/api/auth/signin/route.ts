import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signTradiauraToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ message: "Email and password are required" }, { status: 400 });
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();

    const [rows] = await db.execute(
      "SELECT id, first_name, last_name, email, password_hash, role FROM users WHERE email = ?",
      [normalizedEmail]
    );

    const users = rows as Array<{ id: number; first_name: string; last_name: string; email: string; password_hash: string; role: string }>;

    if (users.length === 0) {
      return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });
    }

    const token = signTradiauraToken({
      customerId: user.id,
      tenantId: 1,
      tenantCode: "tradiaura",
      tenantName: "TradiAura",
      customerCode: `CUS-${user.id}`,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.json({
      message: "Login successful",
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
      },
    });

    response.cookies.set("tradiaura_user_token", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.error("Signin error", error);
    return NextResponse.json({ message: "Login failed" }, { status: 500 });
  }
}
