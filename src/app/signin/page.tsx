"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import AuthShell from "@/components/auth/AuthShell";
import { AuthField } from "@/components/auth/AuthField";
import { useAppDispatch } from "@/store/hooks";
import { customerLogin } from "@/store/slices/customerAuthSlice";

export default function SigninPage() {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const dispatch = useAppDispatch();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.password) {
      toast.error("Please enter your email and password");
      return;
    }

    setLoading(true);
    try {
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
          tenantName: "Tradenaya",
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
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Tradenaya account"
      footer={
        <p className="text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium transition hover:opacity-80" style={{ color: "var(--primary)" }}>
            Register
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField
          id="email"
          label="Email"
          type="email"
          placeholder="Enter email"
          icon={<Mail size={16} />}
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />

        <AuthField
          id="password"
          label="Password"
          placeholder="Enter password"
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
            "Sign In"
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
