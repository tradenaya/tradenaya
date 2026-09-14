"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import AuthShell from "@/components/auth/AuthShell";
import { AuthField } from "@/components/auth/AuthField";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form }),
      });
      const data = await response.json();

      if (response.ok) {
        toast.success("Account created — please sign in");
        router.push("/signin");
      } else {
        toast.error(data.message || "Sign up failed");
      }
    } finally {
      setLoading(false);
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join Tradenaya and start automated trading"
      footer={
        <p className="text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
          Already have an account?{" "}
          <Link href="/signin" className="font-medium transition hover:opacity-80" style={{ color: "var(--primary)" }}>
            Sign In
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <AuthField
            id="firstName"
            label="First Name"
            placeholder="First Name"
            icon={<User size={16} />}
            autoComplete="given-name"
            value={form.firstName}
            onChange={set("firstName")}
          />
          <AuthField
            id="lastName"
            label="Last Name"
            placeholder="Last Name"
            icon={<User size={16} />}
            autoComplete="family-name"
            value={form.lastName}
            onChange={set("lastName")}
          />
        </div>

        <AuthField
          id="email"
          label="Email"
          type="email"
          placeholder="Email"
          icon={<Mail size={16} />}
          autoComplete="email"
          value={form.email}
          onChange={set("email")}
        />

        <AuthField
          id="password"
          label="Password"
          placeholder="Create a password"
          icon={<Lock size={16} />}
          toggleable
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
        />

        <AuthField
          id="confirmPassword"
          label="Confirm Password"
          placeholder="Repeat your password"
          icon={<Lock size={16} />}
          toggleable
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={set("confirmPassword")}
        />

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="animate-spin" /> Creating account…
            </>
          ) : (
            "Create Account"
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
