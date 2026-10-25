"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "./auth";
import { useConfirm } from "./confirm-dialog";
import { GeminiKeyHelp } from "./gemini-key";
import { Button, Field, Input, PasswordInput } from "./ui";

type Mode = "login" | "register";

function validate(mode: Mode, v: { name: string; email: string; password: string; geminiKey: string }) {
  const e: Record<string, string> = {};
  if (mode === "register" && !v.name.trim()) e.name = "Enter your name.";
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (mode === "register" && v.password.length < 8) e.password = "Password must be at least 8 characters.";
  if (mode === "login" && !v.password) e.password = "Enter your password.";
  if (mode === "register" && !v.geminiKey.trim()) e.geminiKey = "Paste your Gemini API key.";
  else if (mode === "register" && !/^\S{20,300}$/.test(v.geminiKey.trim())) e.geminiKey = "That doesn't look like a Gemini API key. Copy the whole key from Google AI Studio.";
  return e;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, setUser } = useAuth();
  const [values, setValues] = useState({ name: "", email: "", password: "", geminiKey: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // Registered, but the admin must approve it before it can log in.
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  // Set once this form logs someone in, so the redirect below doesn't race it.
  const submitted = useRef(false);

  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  useEffect(() => {
    // Already logged in when the page opened → skip the form.
    if (!loading && user && !submitted.current) router.replace(safeNext);
  }, [loading, user, router, safeNext]);

  const confirm = useConfirm();
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(mode, values);
    setErrors(errs);
    setFormError("");
    if (Object.keys(errs).length) return;
    if (
      mode === "register" &&
      !(await confirm({
        title: "Create your account?",
        body: `We'll check your Gemini API key with Google, then create a JobDraft account for ${values.email.trim()}. Next, you'll upload your resume and connect Gmail.`,
        confirmLabel: "Create account",
      }))
    )
      return;
    setBusy(true);
    try {
      const body = mode === "register" ? { ...values, geminiKey: values.geminiKey.trim() } : { email: values.email, password: values.password };
      const res = await api<{ user?: User; pending?: boolean }>(`/api/auth/${mode}`, { body });
      if (res.pending) {
        setPendingFor(values.email.trim());
        return;
      }
      if (!res.user) throw new Error("Unexpected response");
      submitted.current = true;
      setUser(res.user);
      if (mode === "register") {
        toast.success("Account created. Let's set things up.");
        router.replace("/setup?welcome=1");
      } else {
        router.replace(safeNext);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === "register";
  if (pendingFor)
    return (
      <div role="status" className="space-y-3" data-testid="pending-approval">
        <h1 className="text-xl font-bold text-slate-900">Account created</h1>
        <p className="rounded-xl bg-emerald-50 p-3 text-[15px] text-emerald-900 ring-1 ring-inset ring-emerald-200">
          Your account for <strong className="break-all">{pendingFor}</strong> has been created. The JobDraft admin needs to approve it before you can log in.
        </p>
        <p className="text-[15px] text-slate-700">You&apos;ll get an email (or a message from the admin) as soon as it&apos;s approved. Then log in with the email and password you just chose.</p>
        <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline-offset-2 hover:underline">
          Go to log in
        </Link>
      </div>
    );
  const deactivated = isRegister && params.get("deactivated") === "1";
  const inactiveNotice = !isRegister && params.get("inactive") === "1";
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {deactivated && (
        <div role="status" className="rounded-xl bg-emerald-50 p-3 text-[15px] text-emerald-900 ring-1 ring-inset ring-emerald-200" data-testid="deactivated-banner">
          <p className="font-semibold">Your account has been deactivated</p>
          <p className="mt-1">
            Your resume, settings, Gmail connection and history were permanently deleted, and nothing more will be drafted or sent. Drafts already in your Gmail stay there.
          </p>
          <p className="mt-1">Want to start again? Create a new account below — you can use the same email and you&apos;ll begin from the first step.</p>
        </div>
      )}
      {inactiveNotice && (
        <div role="alert" className="rounded-xl bg-amber-50 p-3 text-[15px] text-amber-900 ring-1 ring-inset ring-amber-300" data-testid="inactive-banner">
          <p className="font-semibold">Your account is inactive</p>
          <p className="mt-1">The JobDraft admin has deactivated it. Please ask the admin to activate it again.</p>
        </div>
      )}
      <h1 className="text-xl font-bold text-slate-900">{isRegister ? (deactivated ? "Start again" : "Create your account") : "Log in"}</h1>
      {formError && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-[15px] font-medium text-red-800 ring-1 ring-inset ring-red-200">
          {formError}
        </p>
      )}
      {isRegister && (
        <Field label="Name" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" autoComplete="name" value={values.name} onChange={set("name")} invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} />
        </Field>
      )}
      <Field label="Email" htmlFor="email" error={errors.email}>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={values.email} onChange={set("email")} invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password} hint={isRegister ? "At least 8 characters." : undefined}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={values.password}
          onChange={set("password")}
          invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : isRegister ? "password-hint" : undefined}
        />
      </Field>
      {isRegister && (
        <div className="space-y-2">
          <Field label="Gemini API key" htmlFor="geminiKey" error={errors.geminiKey}>
            <PasswordInput
              id="geminiKey"
              what="key"
              name="geminiKey"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Paste your key (starts with AIza…)"
              value={values.geminiKey}
              onChange={set("geminiKey")}
              invalid={!!errors.geminiKey}
              aria-describedby={errors.geminiKey ? "geminiKey-error" : "gemini-key-help"}
            />
          </Field>
          <GeminiKeyHelp id="gemini-key-help" />
        </div>
      )}
      <Button type="submit" full loading={busy}>
        {isRegister ? "Create account" : "Log in"}
      </Button>
      <p className="text-center text-[15px] text-slate-600">
        {isRegister ? "Already have an account? " : "New to JobDraft? "}
        <Link href={isRegister ? "/login" : "/register"} className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline-offset-2 hover:underline">
          {isRegister ? "Log in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
