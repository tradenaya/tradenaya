"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { applyThemeToDOM } from "@/components/providers/CustomerThemeProvider";

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const router = useRouter();

  useEffect(() => {
    fetch("/api/theme?tenant=tradenaya")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.customerTheme) {
          applyThemeToDOM(data.customerTheme);
        }
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form }),
    });
    const data = await response.json();
    setLoading(false);

    if (response.ok) {
      router.push("/signin");
    } else {
      toast.error(data.message);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "radial-gradient(circle at top, #16181d 0%, #05070b 55%, #030407 100%)", color: "var(--foreground)" }}
    >
      <Card
        className="w-full max-w-lg border shadow-2xl"
        style={{ backgroundColor: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" }}
      >
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-semibold">TradeNaya</CardTitle>
          <CardDescription style={{ color: "var(--muted-foreground)" }}>Create your account</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName" style={{ color: "var(--foreground)" }}>
                  First Name
                </Label>
                <Input
                  id="firstName"
                  placeholder="First Name"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  style={{ backgroundColor: "var(--input)", color: "var(--foreground)", borderColor: "var(--border)" }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName" style={{ color: "var(--foreground)" }}>
                  Last Name
                </Label>
                <Input
                  id="lastName"
                  placeholder="Last Name"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  style={{ backgroundColor: "var(--input)", color: "var(--foreground)", borderColor: "var(--border)" }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" style={{ color: "var(--foreground)" }}>
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={{ backgroundColor: "var(--input)", color: "var(--foreground)", borderColor: "var(--border)" }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" style={{ color: "var(--foreground)" }}>
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                style={{ backgroundColor: "var(--input)", color: "var(--foreground)", borderColor: "var(--border)" }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" style={{ color: "var(--foreground)" }}>
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm Password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                style={{ backgroundColor: "var(--input)", color: "var(--foreground)", borderColor: "var(--border)" }}
              />
            </div>

            <Button className="w-full" disabled={loading} style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}>
              {loading ? "Creating..." : "Create Account"}
            </Button>

            <p className="text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
              Already have an account?{" "}
              <Link href="/signin" style={{ color: "var(--foreground)" }} className="font-medium hover:opacity-80">
                Sign In
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
