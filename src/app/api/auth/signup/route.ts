import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { firstName, lastName, email, password } = await request.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();

    if (!normalizedFirstName || !normalizedLastName || !normalizedEmail || !password) {
      return NextResponse.json({ message: "All fields are required" }, { status: 400 });
    }

    const [existingRows] = await db.execute("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    const existingUsers = existingRows as Array<{ id: number }>;

    if (existingUsers.length > 0) {
      return NextResponse.json({ message: "Email already registered" }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.execute(
      "INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())",
      [normalizedFirstName, normalizedLastName, normalizedEmail, hashedPassword, "user", 1]
    );

    return NextResponse.json({ message: "User registered successfully" }, { status: 201 });
  } catch (error) {
    console.error("Signup error", error);
    return NextResponse.json({ message: "Registration failed" }, { status: 500 });
  }
}
