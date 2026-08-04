"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
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
import { useAppDispatch } from "@/store/hooks";
import { customerLogin } from "@/store/slices/customerAuthSlice";

export default function SigninPage() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const dispatch = useAppDispatch();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (!form.email || !form.password) {
        toast.error("Please enter your email and password");
        return;
      }

      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.message || "Invalid credentials");
        return;
      }

      dispatch(
        customerLogin({
          tenantId: 1,
          tenantCode: "tradenaya",
          tenantName: "TradeNaya",
          profileId: data.user.id,
          profileCode: `CUS-${data.user.id}`,
          firstName: data.user.firstName,
          lastName: data.user.lastName,
          email: data.user.email,
          role: "CUSTOMER",
        })
      );

      toast.success("Signed in successfully");
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "#0f1115", color: "#f5f7fa" }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at top right, #23262c 0%, transparent 40%), radial-gradient(circle at bottom left, #12141a 0%, transparent 45%)" }} />

      <Card className="relative z-10 w-full max-w-md border shadow-2xl" style={{ backgroundColor: "#171a20", color: "#f5f7fa", borderColor: "#2a2f38" }}>
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">TradeNaya</CardTitle>
          <CardDescription>User Sign In</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label style={{ color: "var(--foreground)" }}>Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="Enter email"
                  className="pl-10"
                  style={{ backgroundColor: "#1d2129", color: "#f5f7fa", borderColor: "#3a414d" }}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label style={{ color: "var(--foreground)" }}>Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  className="pl-10 pr-10"
                  style={{ backgroundColor: "#1d2129", color: "#f5f7fa", borderColor: "#3a414d" }}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading} style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}>
              {loading ? "Signing In..." : "Sign In"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-primary font-medium">
                Register
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
