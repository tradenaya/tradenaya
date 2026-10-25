"use client";

import { Check, Copy, ExternalLink, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatDayIst, formatTimeIst } from "@/lib/format";
import { useConfirm } from "./confirm-dialog";
import { Banner, Button, Card, Toggle } from "./ui";

export interface PendingUser {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

export interface Approval {
  required: boolean;
  googleTestUsersUrl: string;
  adminGmail: string | null;
}

/**
 * Sign-ups waiting for the admin. While the Google app is in Testing mode only
 * its test users can connect Gmail, so: copy the email, add it on Google's
 * test-users page (opens in a new tab), then approve here.
 */
export function AdminApprovals({ approval, pending, onChanged }: { approval: Approval; pending: PendingUser[]; onChanged: () => void | Promise<void> }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | "switch" | null>(null);
  const [notify, setNotify] = useState(!!approval.adminGmail);

  async function copy(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      toast.success("Email copied. Paste it on Google's test users page.");
    } catch {
      toast.error("Couldn't copy. Select the email and copy it yourself.");
    }
  }

  async function setRequired(on: boolean) {
    const ok = await confirm(
      on
        ? { title: "Require approval for new sign-ups?", body: "New accounts will wait for you to approve them before they can log in. Keep this on while your Google app is in Testing mode.", confirmLabel: "Require approval" }
        : { title: "Let new sign-ups in without approval?", body: "Only do this once your Google app is published (In production). In Testing mode, people who aren't test users can't connect Gmail.", confirmLabel: "Turn approval off", danger: true },
    );
    if (!ok) return;
    setBusy("switch");
    try {
      await api("/api/admin/settings", { method: "PUT", body: { signupApproval: on } });
      toast.success(on ? "New sign-ups now need approval." : "New sign-ups can log in at once.");
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function approve(u: PendingUser) {
    const ok = await confirm({
      title: `Approve ${u.name}?`,
      body: `Have you added ${u.email} to the test users on Google's page? Without that, they can log in but can't connect Gmail. ${
        notify ? `They'll get an email from ${approval.adminGmail} saying they can log in.` : "No email is sent; let them know yourself."
      }`,
      confirmLabel: "Approve",
    });
    if (!ok) return;
    setBusy(u.id);
    try {
      const res = await api<{ email: { sent: boolean; reason?: string } }>(`/api/admin/users/${u.id}/approve`, { method: "POST", body: { notify } });
      if (res.email.sent) toast.success(`${u.name} approved and emailed.`);
      else toast.success(`${u.name} approved. ${res.email.reason ?? ""}`.trim());
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function reject(u: PendingUser) {
    const ok = await confirm({ title: `Reject ${u.name}?`, body: `${u.email}'s account is deleted. They can register again later.`, confirmLabel: "Reject", danger: true });
    if (!ok) return;
    setBusy(u.id);
    try {
      await api(`/api/admin/users/${u.id}/reject`, { method: "POST" });
      toast.success("Sign-up rejected.");
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={`Waiting for approval (${pending.length})`} id="approvals">
      <div className="space-y-3">
        <Toggle
          checked={approval.required}
          onChange={(v) => void setRequired(v)}
          disabled={busy === "switch"}
          label="New sign-ups need approval"
          description="Keep this on while your Google app is in Testing mode (only test users can connect Gmail)."
        />
        <div className="rounded-xl bg-slate-50 p-3 text-[15px] text-slate-800 ring-1 ring-inset ring-slate-200">
          <p className="font-semibold">How to give access</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Copy their email.</li>
            <li>
              Open <strong>Google test users</strong>, click <strong>Add users</strong>, paste it and save.
            </li>
            <li>
              Click <strong>Approve</strong> here.
            </li>
          </ol>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" className="size-5 accent-brand-600" checked={notify && !!approval.adminGmail} disabled={!approval.adminGmail} onChange={(e) => setNotify(e.target.checked)} />
            <span>
              {approval.adminGmail ? (
                <>
                  Email them from <strong className="break-all">{approval.adminGmail}</strong> when approved (free, uses your Gmail)
                </>
              ) : (
                "Connect your Gmail on Setup to email people automatically when you approve them."
              )}
            </span>
          </label>
        </div>
        {pending.length === 0 ? (
          <p className="text-slate-600">Nobody is waiting.</p>
        ) : (
          <ul className="divide-y divide-slate-200" data-testid="pending-users">
            {pending.map((u) => (
              <li key={u.id} className="py-3" data-testid="pending-user">
                <p className="font-semibold text-slate-900">{u.name}</p>
                <p className="break-all text-sm text-slate-700">{u.email}</p>
                <p className="text-xs text-slate-600">
                  Signed up {formatDayIst(u.createdAt)} {formatTimeIst(u.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button type="button" variant="secondary" onClick={() => void copy(u.email)} aria-label={`Copy ${u.email}`}>
                    <Copy className="size-4" aria-hidden /> Copy email
                  </Button>
                  <a
                    href={approval.googleTestUsersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 hover:bg-brand-50"
                    data-testid="google-test-users"
                  >
                    <UserPlus className="size-4" aria-hidden /> Open Google test users <ExternalLink className="size-4" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <Button type="button" onClick={() => void approve(u)} disabled={busy === u.id} aria-label={`Approve ${u.name}`}>
                    <Check className="size-4" aria-hidden /> Approve
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void reject(u)} disabled={busy === u.id} className="text-red-700 hover:bg-red-50" aria-label={`Reject ${u.name}`}>
                    <X className="size-4" aria-hidden /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!approval.required && pending.length > 0 && (
          <Banner tone="info">Approval is off for new sign-ups, but these people signed up while it was on and still need your approval.</Banner>
        )}
      </div>
    </Card>
  );
}
