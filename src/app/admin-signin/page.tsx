"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, Shield } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, fetchJson } from "@/lib/api-client";

import { Button } from "@/components/ui/button";
import AuthShell from "@/components/auth/AuthShell";
import { AuthField } from "@/components/auth/AuthField";
import { useAppDispatch } from "@/store/hooks";
import { adminLogin } from "@/store/slices/adminAuthSlice";

export default function AdminSigninPage() {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const router = useRouter();
  const dispatch = useAppDispatch();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.password) {
      toast.error("Please enter your email and password");
      return;
    }

    setLoading(true);
    try {
      let data: {
        user: {
          tenantId: number;
          tenantCode: string;
          tenantName: string;
          userId: number;
          userCode: string;
          firstName: string;
          lastName: string;
          email: string;
          role: string;
        };
      };
      try {
        data = await fetchJson("/api/admin/signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
      } catch (err: unknown) {
        toast.error(errorMessage(err, "Invalid credentials"));
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
    <AuthShell
      title="Admin Console"
      subtitle="Administrator Sign In"
      footer={
        <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
          Restricted access · Authorized personnel only
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField
          id="email"
          label="Email"
          type="email"
          placeholder="Admin email"
          icon={<Mail size={16} />}
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />

        <AuthField
          id="password"
          label="Password"
          placeholder="Password"
          icon={<Lock size={16} />}
          toggleable
          autoComplete="current-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />

        <Button
          type="submit"
          className="h-12 w-full"
          style={{ fontFamily: "var(--font-cinzel), serif", letterSpacing: "0.08em" }}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" /> Signing in…
            </>
          ) : (
            <>
              <Shield /> Admin Sign In
            </>
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
