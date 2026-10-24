"use client";

import { CalendarClock, ExternalLink, MailCheck, Play, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AutomationSwitch } from "@/components/automation-switch";
import { useConfirm } from "@/components/confirm-dialog";
import { gmailConnectConfirm, startGmailConnect } from "@/components/gmail-section";
import { StatusBadge } from "@/components/status";
import { Banner, Button, ButtonLink, Card, PageSkeleton, PageTitle } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { countdown, formatDateTimeIst, formatDayIst, formatTimeIst, plural, TRIGGER_LABEL } from "@/lib/format";
import type { Dashboard, Profile, UpcomingSend } from "@/lib/types";

const GMAIL_DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState("");
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      api<Dashboard>("/api/dashboard").then(
        (d) => {
          setData(d);
          setNow(Date.now());
          setLoadError("");
        },
        (err) => setLoadError(errorMessage(err)),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Countdown clock for upcoming sends.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Refresh while something is happening: a run (4 s) or a send queue (30 s).
  const running = data?.lastRun?.status === "running";
  const sending = (data?.upcoming.length ?? 0) > 0;
  useEffect(() => {
    if (!running && !sending) return;
    const t = setInterval(() => void load(), running ? 4000 : 30_000);
    return () => clearInterval(t);
  }, [running, sending, load]);

  // Re-check when the Run now cooldown ends.
  const cooldownAt = data?.runNowAvailableAt;
  useEffect(() => {
    if (!cooldownAt) return;
    const ms = new Date(cooldownAt).getTime() - Date.now();
    const t = setTimeout(() => void load(), Math.max(ms, 0) + 1000);
    return () => clearTimeout(t);
  }, [cooldownAt, load]);

  const confirm = useConfirm();

  async function runNow() {
    const ok = await confirm({
      title: "Run now?",
      body: "JobDraft searches for new jobs now and prepares emails in your Gmail. The strongest matches are sent automatically 30 minutes after the run unless you cancel them; the rest wait in your drafts.",
      confirmLabel: "Run now",
    });
    if (!ok) return;
    setStarting(true);
    try {
      await api("/api/runs", { method: "POST" });
      toast.success("Run started. New emails will appear in a minute or two.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      await load();
      setStarting(false);
    }
  }

  async function cancel(u: UpcomingSend) {
    const email = u.kind === "email";
    const ok = await confirm({
      title: email ? `Cancel the email to ${u.company}?` : `Cancel this follow-up to ${u.company}?`,
      body: email
        ? "It won't be sent automatically. It stays in your Gmail drafts, so you can still review and send it yourself."
        : `This follow-up won't be sent.${u.label.startsWith("Follow-up 1") ? " Follow-up 2 won't be created either." : ""}`,
      confirmLabel: email ? "Cancel email" : "Cancel follow-up",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(u.kind === "email" ? `/api/items/${u.itemId}/cancel` : `/api/followups/${u.id}/cancel`, { method: "POST" });
      toast.success(u.kind === "email" ? "Cancelled. It stays in your Gmail drafts." : "Follow-up cancelled.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await load();
  }

  async function cancelAll(runId: number) {
    const ok = await confirm({
      title: "Cancel all scheduled emails?",
      body: "None of this run's scheduled emails will be sent automatically. They stay in your Gmail drafts, so you can still send any of them yourself.",
      confirmLabel: "Cancel all",
      cancelLabel: "Keep them",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api<{ cancelled: number }>(`/api/runs/${runId}/cancel-all`, { method: "POST" });
      toast.success(`${plural(res.cancelled, "email")} cancelled and kept as drafts.`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await load();
  }

  if (loadError && !data)
    return (
      <Banner tone="error" title="Couldn't load your dashboard" action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}>
        {loadError}
      </Banner>
    );
  if (!data) return <PageSkeleton />;

  const { profile, lastRun } = data;
  const auto = data.automation;
  const gmailOk = profile.gmail.status === "connected";
  const cooldown = data.runNowAvailableAt;
  const canRun = auto.enabled && gmailOk && !running && !cooldown;
  const runIdsWithEmails = [...new Set(data.upcoming.filter((u) => u.kind === "email" && u.runId).map((u) => u.runId!))];
  const onAutomation = (p: Profile) => {
    setData({ ...data, profile: p, automation: p.automation, nextRunAt: p.nextRunAt });
    void load();
  };
  const reconnect = async () => {
    if (!(await confirm(gmailConnectConfirm(true)))) return;
    await startGmailConnect().catch((e) => toast.error(errorMessage(e)));
  };

  return (
    <div className="space-y-4">
      <PageTitle>Dashboard</PageTitle>

      <AutomationSwitch profile={profile} onChange={onAutomation} showMode />

      {data.mock && <Banner tone="info" title="Demo mode">External services are simulated (MOCK_EXTERNAL=true). No real emails or drafts are created.</Banner>}
      {data.notConfigured.map((m) => (
        <Banner key={m} tone="warn" title="Not configured">
          {m}
        </Banner>
      ))}
      {profile.gmail.status === "error" && (
        <Banner tone="error" title="Gmail access expired — please reconnect" action={<Button onClick={reconnect}>Reconnect Gmail</Button>}>
          Nothing can be drafted or sent until Gmail is reconnected.
        </Banner>
      )}
      {profile.gmail.status === "needs_reconnect" && (
        <Banner tone="warn" title="Reconnect Gmail and allow all permissions" action={<Button onClick={reconnect}>Reconnect Gmail</Button>}>
          JobDraft needs both permissions to prepare emails and track replies.
        </Banner>
      )}
      {data.sendingPausedUntil && (
        <Banner tone="warn" title="Sending is paused">
          Gmail asked JobDraft to slow down, so nothing is sent until {formatDateTimeIst(data.sendingPausedUntil)}. Waiting emails were kept as drafts.
        </Banner>
      )}
      {!profile.complete.resume && (
        <Banner tone="warn" title="No resume yet" action={<ButtonLink href="/setup#resume" variant="secondary">Upload resume</ButtonLink>}>
          Upload your resume so JobDraft can find matching jobs and write your emails.
        </Banner>
      )}
      {profile.complete.resume && !profile.complete.preferences && (
        <Banner tone="warn" title="Choose roles, locations and salary" action={<ButtonLink href="/setup#preferences" variant="secondary">Open setup</ButtonLink>} />
      )}
      {(profile.gmail.status === "not_connected" || profile.gmail.status === "disconnected") && (
        <Banner tone="warn" title="Gmail is not connected" action={<ButtonLink href="/setup#gmail" variant="secondary">Connect Gmail</ButtonLink>}>
          Emails are prepared in your own Gmail, so it needs to be connected.
        </Banner>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Last run" id="last-run">
            {lastRun ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={lastRun.status} />
                  <span className="text-slate-600">
                    {TRIGGER_LABEL[lastRun.trigger]} · {formatDateTimeIst(lastRun.startedAt)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Drafts for you" value={lastRun.draftsCount} testId="drafts-count" />
                  <Stat label="Auto-sending" value={lastRun.autoSendCount} testId="auto-count" />
                  <Stat label="Sent" value={lastRun.sentCount} />
                  <Stat label="Apply via link" value={lastRun.linkOnlyCount} />
                </dl>
                {lastRun.status === "running" && <p className="text-slate-700">Finding jobs and writing emails… this page updates by itself.</p>}
                {lastRun.status === "ready_to_send" && <p className="text-slate-700">Drafts are waiting in your Gmail. Review each one, then press Send.</p>}
                {lastRun.status === "sending" && <p className="text-slate-700">The strongest matches are being sent one by one. You can still cancel any of them below.</p>}
                {lastRun.status === "no_matches" && <p className="text-slate-700">No new jobs matched this time. JobDraft will look again at the next run.</p>}
                {lastRun.errorMessage && <Banner tone={lastRun.status === "failed" ? "error" : "warn"}>{lastRun.errorMessage}</Banner>}
                <Link href="/history" className="inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">
                  See every application in History
                </Link>
              </div>
            ) : (
              <p className="text-slate-600">No runs yet. Your first emails will appear after the next run.</p>
            )}
          </Card>

          <Card
            title="Upcoming sends"
            id="upcoming"
            action={
              runIdsWithEmails.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {runIdsWithEmails.map((id) => (
                    <Button key={id} variant="ghost" onClick={() => void cancelAll(id)} className="text-red-700 hover:bg-red-50">
                      Cancel all
                    </Button>
                  ))}
                </div>
              ) : undefined
            }
          >
            {data.upcoming.length === 0 ? (
              <p className="text-slate-600">Nothing scheduled. Strong matches are sent 30 minutes after a run, so you can cancel them first.</p>
            ) : (
              <ul className="divide-y divide-slate-200" aria-label="Scheduled emails">
                {data.upcoming.map((u) => (
                  <li key={`${u.kind}-${u.id}`} className="flex items-start gap-3 py-3 first:pt-0" data-testid="upcoming-item">
                    <Send className="mt-1 size-5 shrink-0 animate-whoosh text-brand-700" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-semibold text-slate-900">
                        {u.company} <span className="font-normal text-slate-600">· {u.label}</span>
                      </p>
                      <p className="break-words text-[15px] text-slate-700">{u.jobTitle}</p>
                      <p className="text-sm text-slate-600">
                        Sending at {formatTimeIst(u.sendAt)} ({countdown(u.sendAt, now)}) to <span className="break-all">{u.toEmail}</span>
                      </p>
                    </div>
                    <Button variant="secondary" onClick={() => void cancel(u)} aria-label={`Cancel ${u.label.toLowerCase()} to ${u.company}`} className="shrink-0 px-3">
                      <X className="size-4" aria-hidden />
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.followupDrafts.length > 0 && (
            <Card title="Follow-up drafts ready" id="followup-drafts">
              <p className="mb-2 text-[15px] text-slate-600">
                These are in your Gmail drafts, as replies to applications you sent yourself. Send them within 7 days, or they&apos;re removed.
              </p>
              <ul className="divide-y divide-slate-200">
                {data.followupDrafts.map((f) => (
                  <li key={f.id} className="py-2 first:pt-0">
                    <p className="font-semibold text-slate-900">
                      {f.company} <span className="font-normal text-slate-600">· Follow-up {f.sequence}/2</span>
                    </p>
                    <p className="text-sm text-slate-600">
                      {f.jobTitle} · removed {formatDayIst(f.expiresAt).toLowerCase()} if not sent
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Next run" id="next-run">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden />
              <div className="min-w-0">
                <p className="text-lg font-semibold text-slate-900" data-testid="next-run">
                  {auto.enabled && data.nextRunAt ? `${formatDayIst(data.nextRunAt)}, ${formatTimeIst(data.nextRunAt)} IST` : "Automation is off"}
                </p>
                <Link href="/setup#preferences" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-brand-700 hover:underline">
                  Change time
                </Link>
              </div>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <ButtonLink href={GMAIL_DRAFTS_URL} external full variant="secondary">
              <ExternalLink className="size-5" aria-hidden />
              Open Gmail drafts
            </ButtonLink>
            <Button full onClick={runNow} loading={starting} disabled={!canRun}>
              <Play className="size-5" aria-hidden />
              {running ? "Running…" : "Run now"}
            </Button>
          </div>
          {cooldown && !running && <p className="text-center text-sm text-slate-600">Run now is available again at {formatTimeIst(cooldown)} IST.</p>}
          {!auto.enabled && <p className="text-center text-sm text-slate-600">Turn automation on to use Run now.</p>}

          <Card title="Last 30 days" id="stats">
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Sent" value={data.stats30.sent} />
              <Stat label="Replies" value={data.stats30.replies} icon={<MailCheck className="size-4 text-emerald-700" aria-hidden />} />
              <Stat label="Follow-ups" value={data.stats30.followups} />
              <Stat label="No response" value={data.stats30.noResponse} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, testId, icon }: { label: string; value: number; testId?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="flex items-center gap-1 text-sm text-slate-600">
        {icon}
        {label}
      </dt>
      <dd className="text-2xl font-bold text-slate-900" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
