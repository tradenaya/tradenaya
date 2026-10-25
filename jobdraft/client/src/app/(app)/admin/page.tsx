"use client";

import { Check, LogIn, Plus, Search, ShieldCheck, Trash2, UserCheck, UserX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth";
import { AdminApprovals, type Approval } from "@/components/admin-approvals";
import { useConfirm } from "@/components/confirm-dialog";
import { GeminiKeyHelp } from "@/components/gemini-key";
import { Banner, Button, Card, cx, EmptyState, Field, Input, PageSkeleton, PageTitle, PasswordInput } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDateIst, formatDayIst, formatTimeIst } from "@/lib/format";
import { sendModeTitle } from "@/lib/send-modes";
import type { SendMode } from "@/lib/types";

interface AdminUser {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  status: "pending" | "active" | "inactive";
  createdAt: string;
  automation: boolean;
  sendMode: SendMode;
  setup: { resume: boolean; geminiKey: boolean; gmail: boolean };
  runs: number;
  lastRunAt: string | null;
  drafts: number;
  autoSends: number;
  sent: number;
  linkOnly: number;
  replies: number;
}

interface Overview {
  totals: { users: number; active: number; pending: number; inactive: number; automationOn: number; runs: number; drafts: number; autoSends: number; sent: number; linkOnly: number; replies: number };
  users: AdminUser[];
  approval: Approval;
}

interface AuditEntry {
  id: number;
  action: string;
  target: string | null;
  at: string;
  admin: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  user_create: "Created account",
  user_approve: "Approved",
  user_reject: "Rejected sign-up",
  access_email_sent: "Emailed login access to",
  approval_on: "Turned sign-up approval on",
  approval_off: "Turned sign-up approval off",
  user_activate: "Activated",
  user_deactivate: "Deactivated",
  user_delete: "Deleted account",
  impersonate_start: "Started using JobDraft as",
  impersonate_stop: "Returned from",
  admin_grant: "Made admin (server)",
  admin_revoke: "Removed admin (server)",
};

export default function AdminPage() {
  const { user, actor } = useAuth();
  const confirm = useConfirm();
  const [data, setData] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([api<Overview>("/api/admin/overview"), api<{ entries: AuditEntry[] }>("/api/admin/audit")]);
      setData(o);
      setAudit(a.entries);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!user?.isAdmin || actor) return;
    void (async () => {
      await load();
    })();
  }, [user, actor, load]);

  const users = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => u.status !== "pending").filter((u) => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
  }, [data, q]);

  if (!user?.isAdmin || actor)
    return (
      <div>
        <PageTitle>Admin</PageTitle>
        <Banner tone="error" title="Admins only">
          {actor ? "You're using JobDraft as another user. Use “Return to admin” at the top first." : "This page is for JobDraft admins."}
        </Banner>
      </div>
    );
  if (error && !data) return <Banner tone="error" title="Couldn't load the admin page">{error}</Banner>;
  if (!data) return <PageSkeleton />;

  async function act(u: AdminUser, kind: "impersonate" | "deactivate" | "activate" | "delete") {
    const texts = {
      impersonate: { title: `Use JobDraft as ${u.name}?`, body: `You'll see and change ${u.email}'s JobDraft exactly as they would (setup, Gmail, runs) for up to 1 hour. A banner lets you return to admin at any time. This is recorded in the audit log.`, confirmLabel: "Use as this user" },
      deactivate: { title: `Deactivate ${u.name}?`, body: `${u.email} can't log in and is told to ask the admin. Runs, sends and follow-ups stop; anything scheduled is cancelled and kept as a Gmail draft. You can activate them again any time.`, confirmLabel: "Deactivate", danger: true },
      activate: { title: `Activate ${u.name}?`, body: `${u.email} can log in again, and their daily runs resume if their automation is on.`, confirmLabel: "Activate" },
      delete: { title: `Delete ${u.name}'s account permanently?`, body: `Everything for ${u.email} is deleted: resume, settings, Gmail connection and history. Drafts already in their Gmail stay there. This can't be undone.`, confirmLabel: "Delete permanently", danger: true },
    }[kind];
    if (!(await confirm(texts))) return;
    setBusy(u.id);
    try {
      if (kind === "impersonate") {
        await api(`/api/admin/users/${u.id}/impersonate`, { method: "POST" });
        window.location.assign("/dashboard");
        return;
      }
      if (kind === "delete") await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      else await api(`/api/admin/users/${u.id}/status`, { method: "POST", body: { active: kind === "activate" } });
      toast.success(kind === "delete" ? "Account deleted." : kind === "activate" ? "Account activated." : "Account deactivated.");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const t = data.totals;
  return (
    <div className="space-y-4">
      <PageTitle subtitle="Every account, what JobDraft has done for it, and full control.">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-6 text-brand-700" aria-hidden /> Admin
        </span>
      </PageTitle>

      <section aria-label="Totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5" data-testid="admin-totals">
        {[
          ["Users", t.users, `${t.active} active · ${t.pending} waiting · ${t.inactive} inactive`],
          ["Automation on", t.automationOn, "active users"],
          ["Runs", t.runs, "all time"],
          ["Drafted", t.drafts, "waiting for users"],
          ["Auto-send", t.autoSends, "created as auto"],
          ["Sent", t.sent, "by JobDraft or the user"],
          ["Apply via link", t.linkOnly, "suitable, no email"],
          ["Replies", t.replies, "from companies"],
        ].map(([label, value, hint]) => (
          <div key={label as string} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <p className="text-sm text-slate-600">{label}</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{value}</p>
            <p className="text-xs text-slate-600">{hint}</p>
          </div>
        ))}
      </section>

      <AdminApprovals approval={data.approval} pending={data.users.filter((u) => u.status === "pending")} onChanged={load} />

      {creating ? (
        <CreateUserForm
          onDone={async () => {
            setCreating(false);
            await load();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <Card
        title={`Users (${users.length})`}
        action={
          !creating && (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="size-5" aria-hidden /> Create user
            </Button>
          )
        }
      >
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-500" aria-hidden />
          <label htmlFor="admin-search" className="sr-only">
            Search users
          </label>
          <Input id="admin-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="pl-10" />
        </div>
        {users.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <ul className="divide-y divide-slate-200" data-testid="admin-users">
            {users.map((u) => (
              <li key={u.id} className="py-3" data-testid="admin-user">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                      <span className="break-words">{u.name}</span>
                      {u.isAdmin && <Badge tone="brand">Admin</Badge>}
                      {u.status === "inactive" && <Badge tone="red">Inactive</Badge>}
                      <Badge tone={u.automation ? "green" : "muted"}>{u.automation ? `Automation on · ${sendModeTitle(u.sendMode)}` : "Automation off"}</Badge>
                    </p>
                    <p className="break-all text-sm text-slate-700">{u.email}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                      <span>Joined {formatDateIst(u.createdAt)}</span>
                      <Tick ok={u.setup.geminiKey} label="Gemini key" />
                      <Tick ok={u.setup.resume} label="Resume" />
                      <Tick ok={u.setup.gmail} label="Gmail" />
                    </p>
                  </div>
                  {!u.isAdmin && u.id !== user.id && (
                    <div className="flex flex-wrap gap-1">
                      <Button type="button" variant="secondary" onClick={() => void act(u, "impersonate")} disabled={busy === u.id} aria-label={`Use JobDraft as ${u.name}`}>
                        <LogIn className="size-4" aria-hidden /> Use as user
                      </Button>
                      {u.status === "active" ? (
                        <Button type="button" variant="ghost" onClick={() => void act(u, "deactivate")} disabled={busy === u.id} aria-label={`Deactivate ${u.name}`}>
                          <UserX className="size-4" aria-hidden /> Deactivate
                        </Button>
                      ) : (
                        <Button type="button" variant="ghost" onClick={() => void act(u, "activate")} disabled={busy === u.id} aria-label={`Activate ${u.name}`}>
                          <UserCheck className="size-4" aria-hidden /> Activate
                        </Button>
                      )}
                      <Button type="button" variant="ghost" onClick={() => void act(u, "delete")} disabled={busy === u.id} className="text-red-700 hover:bg-red-50" aria-label={`Delete ${u.name}`}>
                        <Trash2 className="size-4" aria-hidden /> Delete
                      </Button>
                    </div>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                  {[
                    ["Runs", u.runs],
                    ["Drafted", u.drafts],
                    ["Auto-send", u.autoSends],
                    ["Sent", u.sent],
                    ["Via link", u.linkOnly],
                    ["Replies", u.replies],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded-xl bg-slate-50 px-2 py-1.5">
                      <dt className="text-xs text-slate-600">{label}</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1 text-xs text-slate-600">{u.lastRunAt ? `Last run ${formatDayIst(u.lastRunAt)} ${formatTimeIst(u.lastRunAt)}` : "No runs yet"}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent admin actions">
        {audit.length === 0 ? (
          <p className="text-slate-600">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-sm" data-testid="admin-audit">
            {audit.slice(0, 30).map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-x-3 py-2">
                <span className="min-w-0 break-words text-slate-800">
                  {ACTION_LABEL[e.action] ?? e.action} {e.target && <strong className="break-all">{e.target}</strong>}
                  <span className="text-slate-600"> · by {e.admin ?? "server shell"}</span>
                </span>
                <span className="text-slate-600">
                  {formatDayIst(e.at)} {formatTimeIst(e.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Badge({ tone, children }: { tone: "brand" | "red" | "green" | "muted"; children: React.ReactNode }) {
  const cls = { brand: "bg-brand-50 text-brand-800 ring-brand-100", red: "bg-red-50 text-red-900 ring-red-200", green: "bg-emerald-50 text-emerald-900 ring-emerald-200", muted: "bg-slate-100 text-slate-700 ring-slate-200" }[tone];
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", cls)}>{children}</span>;
}

function Tick({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cx("inline-flex items-center gap-0.5", ok ? "text-emerald-700" : "text-slate-500")}>
      {ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
      {label}
      <span className="sr-only">{ok ? " done" : " missing"}</span>
    </span>
  );
}

/** Create an account on someone's behalf; then "Use as user" to finish their setup. */
function CreateUserForm({ onDone, onCancel }: { onDone: () => void | Promise<void>; onCancel: () => void }) {
  const confirm = useConfirm();
  const [v, setV] = useState({ name: "", email: "", password: "", geminiKey: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await confirm({
      title: "Create this account?",
      body: `A JobDraft account for ${v.email.trim() || "this email"}, checked like a normal sign-up (the Gemini key with Google). Share the password with them safely; then use “Use as user” to finish their setup.`,
      confirmLabel: "Create account",
    });
    if (!ok) return;
    setBusy(true);
    setErrors({});
    try {
      await api("/api/admin/users", { body: { ...v, geminiKey: v.geminiKey.trim() } });
      toast.success("Account created.");
      await onDone();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Create a user">
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2" data-testid="create-user-form">
        <Field label="Name" htmlFor="cu-name" error={errors.name}>
          <Input id="cu-name" value={v.name} onChange={set("name")} invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="cu-email" error={errors.email}>
          <Input id="cu-email" type="email" value={v.email} onChange={set("email")} invalid={!!errors.email} autoCapitalize="none" />
        </Field>
        <Field label="Password" htmlFor="cu-password" error={errors.password} hint="At least 8 characters.">
          <PasswordInput id="cu-password" value={v.password} onChange={set("password")} invalid={!!errors.password} autoComplete="new-password" />
        </Field>
        <Field label="Their Gemini API key" htmlFor="cu-key" error={errors.geminiKey}>
          <PasswordInput id="cu-key" what="key" value={v.geminiKey} onChange={set("geminiKey")} invalid={!!errors.geminiKey} autoComplete="off" spellCheck={false} />
        </Field>
        <div className="sm:col-span-2">
          <GeminiKeyHelp />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" loading={busy}>
            Create account
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
