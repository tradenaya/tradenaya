"use client";

import { AlertTriangle, LogOut, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth";
import { useConfirm } from "@/components/confirm-dialog";
import { GmailSection } from "@/components/gmail-section";
import { Button, Card, Field, Input, PageSkeleton, PageTitle, PasswordInput } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { Profile, User } from "@/lib/types";

export default function AccountPage() {
  const { user, setUser, logout } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(user?.name ?? "");
  const [nameError, setNameError] = useState("");
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    api<Profile>("/api/profile").then(setProfile, (err) => toast.error(errorMessage(err)));
  }, []);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setNameError("Enter your name.");
    setNameError("");
    const ok = await confirm({ title: "Change your name?", body: `Your name will be changed to "${name.trim()}".`, confirmLabel: "Save name" });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await api<{ user: User }>("/api/account", { method: "PATCH", body: { name } });
      setUser(res.user);
      toast.success("Name updated.");
    } catch (err) {
      if (err instanceof ApiError && err.fields.name) setNameError(err.fields.name);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function doLogout() {
    const ok = await confirm({
      title: "Log out?",
      body: "You'll need your email and password to log back in. Automation keeps running on its daily schedule while you're logged out.",
      confirmLabel: "Log out",
    });
    if (!ok) return;
    await logout();
    router.replace("/login");
  }

  if (!user) return <PageSkeleton />;
  return (
    <div>
      <PageTitle>Account</PageTitle>
      {/* Phones: Profile → Gmail → Deactivate (danger last). Desktop: Profile + Deactivate left, Gmail right. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="lg:col-start-1 lg:row-start-1">
          <Card title="Profile" id="profile">
            <form onSubmit={saveName} noValidate className="space-y-4">
              <Field label="Name" htmlFor="account-name" error={nameError}>
                <Input id="account-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!nameError} aria-describedby={nameError ? "account-name-error" : undefined} />
              </Field>
              <div>
                <p className="font-medium text-slate-900">Email</p>
                <p className="break-all text-slate-700">{user.email}</p>
              </div>
              <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === user.name}>
                Save name
              </Button>
            </form>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <p className="text-[15px] text-slate-600">Signed in as {user.name}</p>
              <Button variant="secondary" onClick={doLogout}>
                <LogOut className="size-5" aria-hidden />
                Log out
              </Button>
            </div>
          </Card>
        </div>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {profile ? <GmailSection profile={profile} onChange={setProfile} title="Gmail connection" /> : <PageSkeleton />}
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <DeactivateAccount
            email={user.email}
            onDeleted={() => {
              // Full navigation: drops all in-memory state, and the guard can't bounce to /login first.
              window.location.assign("/register?deactivated=1");
            }}
          />
        </div>
      </div>
    </div>
  );
}

const CONSEQUENCES = [
  "Your account is permanently deleted. This can't be undone.",
  "No more emails will be drafted. Scheduled runs stop immediately.",
  "All your configuration is removed: resume, target roles, locations, salary, Gmail connection and run history.",
  "If you register again with the same email, you start from the beginning, as a brand-new user.",
  "Drafts already in your Gmail stay there. Delete them in Gmail if you don't need them.",
];

function DeactivateAccount({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function open() {
    setPassword("");
    setError("");
    dialogRef.current?.showModal();
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return setError("Enter your password to confirm.");
    setBusy(true);
    try {
      await api("/api/account", { method: "DELETE", body: { password } });
      dialogRef.current?.close();
      toast.success("Your account was deactivated and all your data deleted.");
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.password ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Deactivate account" id="deactivate-account">
      <p className="mb-3 text-[15px] text-slate-600">
        Stops JobDraft for this account and permanently deletes the account with everything in it. You can register again later with the same email and start fresh.
      </p>
      <Button variant="danger" onClick={open}>
        <UserX className="size-5" aria-hidden />
        Deactivate account
      </Button>

      <dialog ref={dialogRef} aria-labelledby="deactivate-title" aria-describedby="deactivate-desc" className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-0 text-slate-900 shadow-xl ring-1 ring-slate-200">
        <form onSubmit={confirm} noValidate className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="deactivate-title" className="text-lg font-bold text-slate-900">
                Deactivate and permanently delete?
              </h2>
              <p className="break-all text-sm text-slate-600">{email}</p>
            </div>
          </div>
          <ul id="deactivate-desc" className="list-disc space-y-1.5 pl-5 text-[15px] text-slate-800">
            {CONSEQUENCES.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Field label="Enter your password to confirm" htmlFor="deactivate-password" error={error}>
            <PasswordInput
              id="deactivate-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!error}
              aria-describedby={error ? "deactivate-password-error" : undefined}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              Yes, delete permanently
            </Button>
          </div>
        </form>
      </dialog>
    </Card>
  );
}
