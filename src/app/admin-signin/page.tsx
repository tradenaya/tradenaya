"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Mail, Lock, Shield, Eye, EyeOff } from "lucide-react";

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
import { adminLogin } from "@/store/slices/adminAuthSlice";

export default function AdminSigninPage() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const router = useRouter();
  const dispatch = useAppDispatch();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (!form.email || !form.password) {
        toast.error("Please enter your email and password");
        return;
      }

      const response = await fetch("/api/admin/signin", {
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
        adminLogin({
          tenantId: data.user.tenantId,
          tenantCode: data.user.tenantCode,
          tenantName: data.user.tenantName,
          userId: data.user.userId,
          userCode: data.user.userCode,
          firstName: data.user.firstName,
          lastName: data.user.lastName,
          email: data.user.email,
          role: data.user.role,
        })
      );

      toast.success("Signed in successfully");
      router.push("/admin/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      <Card className="w-full max-w-md shadow-2xl border" style={{ backgroundColor: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" }}>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <Shield className="h-10 w-10 text-indigo-600" />
          </div>
          <CardTitle className="text-3xl">TradiAura</CardTitle>
          <CardDescription>Administrator Sign In</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="Admin email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div>
              <Label>Password</Label>
              <Input
                type="password"
                placeholder="Password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            <Button className="w-full" disabled={loading}>
              {loading ? "Signing In..." : "Admin Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
