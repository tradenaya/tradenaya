"use client";

import { ChevronDown, ExternalLink, History as HistoryIcon, Link2, Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { FunnelDetails, FunnelSummary } from "@/components/run-funnel";
import { ApplicationChip, StatusBadge } from "@/components/status";
import { Banner, Button, cx, EmptyState, PageTitle, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDayIst, formatTimeIst, plural, TRIGGER_LABEL } from "@/lib/format";
import type { Application, FollowUp, Run } from "@/lib/types";

interface RunDetail {
  run: Run;
  applications: Application[];
  linkOnly: Application[];
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loadFirst = useCallback(
    () =>
      api<{ runs: Run[]; nextCursor: number | null }>("/api/runs?limit=10").then(
        (res) => {
          setRuns(res.runs);
          setCursor(res.nextCursor);
          setError("");
        },
        (err) => setError(errorMessage(err)),
      ),
    [],
  );

  useEffect(() => {
    void (async () => {
      await loadFirst();
      // Check Gmail (headers only) for sent / replied / bounced, then refresh the list.
      const res = await api<{ checked: number }>("/api/runs/refresh", { method: "POST" }).catch(() => null);
      if (res && res.checked > 0) await loadFirst();
    })();
  }, [loadFirst]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api<{ runs: Run[]; nextCursor: number | null }>(`/api/runs?limit=10&before=${cursor}`);
      setRuns((r) => [...(r ?? []), ...res.runs]);
      setCursor(res.nextCursor);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <PageTitle subtitle="Every run, every application, and what happened to it.">History</PageTitle>
      {error && !runs && (
        <Banner tone="error" title="Couldn't load history" action={<Button variant="secondary" onClick={() => void loadFirst()}>Try again</Button>}>
          {error}
        </Banner>
      )}
      {!runs && !error && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading runs">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {runs && runs.length === 0 && (
        <EmptyState icon={<HistoryIcon className="size-6" aria-hidden />} title="No runs yet">
          JobDraft runs once a day at your chosen time while automation is on. You can also press Run now on the dashboard.
        </EmptyState>
      )}
      {runs && runs.length > 0 && (
        <ul className="space-y-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </ul>
      )}
      {cursor && (
        <div className="mt-4">
          <Button variant="secondary" full onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function RunCard({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  const panelId = `run-${run.id}-panel`;

  const loadDetail = useCallback(
    () =>
      api<RunDetail>(`/api/runs/${run.id}`).then(
        (d) => {
          setDetail(d);
          setError("");
        },
        (err) => setError(errorMessage(err)),
      ),
    [run.id],
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) void loadDetail();
  }

  const r = detail?.run ?? run;
  return (
    <li className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <h2>
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId} className="flex min-h-11 w-full items-start gap-3 p-4 text-left hover:bg-slate-50">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-slate-900">{formatDayIst(r.startedAt)}</span>
              <span className="text-slate-600">{formatTimeIst(r.startedAt)}</span>
              <span className="text-slate-600">· {TRIGGER_LABEL[r.trigger]}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={r.status} />
              <span className="text-[15px] text-slate-700">
                {plural(r.draftsCount + r.autoSendCount, "email")} · {r.sentCount} sent · {r.linkOnlyCount} via link
              </span>
            </div>
            {r.funnel ? (
              <FunnelSummary funnel={r.funnel} className="mt-2" />
            ) : (
              r.errorMessage && <span className={cx("mt-2 block text-sm", r.status === "failed" ? "text-red-800" : "text-slate-700")}>{r.errorMessage}</span>
            )}
          </div>
          <ChevronDown className={cx("mt-1 size-6 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h2>
      {open && (
        <div id={panelId} className="border-t border-slate-200 p-4">
          {r.errorMessage && r.errorMessage !== r.funnel?.note && (
            <div className="mb-3">
              <Banner tone={r.status === "failed" ? "error" : "warn"}>{r.errorMessage}</Banner>
            </div>
          )}
          {r.funnel && (
            <div className="mb-4">
              <FunnelDetails funnel={r.funnel} />
            </div>
          )}
          {error && <Banner tone="error">{error}</Banner>}
          {!detail && !error && <Skeleton className="h-16 w-full" />}
          {detail && (
            <div className="grid gap-5 lg:grid-cols-2 lg:gap-8">
              <section aria-label="Applications">
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
                  <Mail className="size-5 text-brand-700" aria-hidden /> Applications ({detail.applications.length})
                </h3>
                {detail.applications.length === 0 ? (
                  <p className="text-slate-600">No emails in this run.</p>
                ) : (
                  <ul className="divide-y divide-slate-200">
                    {detail.applications.map((a) => (
                      <ApplicationRow key={a.id} app={a} onChanged={() => void loadDetail()} />
                    ))}
                  </ul>
                )}
              </section>
              <section aria-label="Apply via link">
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
                  <Link2 className="size-5 text-brand-700" aria-hidden /> Apply via link ({detail.linkOnly.length})
                </h3>
                {detail.linkOnly.length === 0 ? (
                  <p className="text-slate-600">Nothing to apply for by link in this run.</p>
                ) : (
                  <>
                    <p className="mb-2 text-sm text-slate-600">Good matches that don&apos;t take email applications. Apply on their site.</p>
                    <ul className="divide-y divide-slate-200">
                      {detail.linkOnly.map((d) => (
                        <li key={d.id} className="py-3 first:pt-0" data-testid="link-item">
                          <p className="break-words font-semibold text-slate-900">{d.company}</p>
                          <p className="break-words text-slate-800">{d.jobTitle}</p>
                          {d.location && <p className="text-sm text-slate-600">{d.location}</p>}
                          {d.jobUrl && <JobLink href={d.jobUrl} />}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ApplicationRow({ app, onChanged }: { app: Application; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const confirm = useConfirm();

  async function cancelSend() {
    const ok = await confirm({
      title: `Cancel the email to ${app.company}?`,
      body: "It won't be sent automatically. It stays in your Gmail drafts, so you can still review and send it yourself.",
      confirmLabel: "Cancel email",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (ok) await post(`/api/items/${app.id}/cancel`, "Cancelled. It stays in your Gmail drafts.");
  }

  async function cancelFollowUp(fu: FollowUp) {
    const ok = await confirm({
      title: `Cancel follow-up ${fu.sequence} to ${app.company}?`,
      body: `This follow-up won't be sent.${fu.sequence === 1 ? " Follow-up 2 won't be created either." : ""}`,
      confirmLabel: "Cancel follow-up",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (ok) await post(`/api/followups/${fu.id}/cancel`, "Follow-up cancelled.");
  }

  async function post(path: string, ok: string) {
    setBusy(true);
    try {
      await api(path, { method: "POST" });
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  }

  const scheduledFu = app.followups.find((f) => f.state === "scheduled");
  return (
    <li className="py-3 first:pt-0" data-testid="application-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-semibold text-slate-900">{app.company}</p>
        <ApplicationChip status={app.status} />
      </div>
      <p className="break-words text-slate-800">{app.jobTitle}</p>
      {app.location && <p className="text-sm text-slate-600">{app.location}</p>}
      {app.handling.label !== app.status.label && (
        <p className={cx("mt-1 text-sm font-semibold", HANDLING_TONE[app.handling.key])} data-testid="handling">
          {app.handling.label}
        </p>
      )}
      <p className="mt-1 break-all text-[15px] text-slate-700">
        To: <span className="font-medium">{app.toEmail}</span>
      </p>
      {app.subject && <p className="break-words text-[15px] text-slate-700">Subject: {app.subject}</p>}
      <Timeline app={app} />
      <div className="mt-1 flex flex-wrap items-center gap-x-1">
        {app.jobUrl && <JobLink href={app.jobUrl} />}
        {app.canCancel && (
          <Button variant="ghost" loading={busy} onClick={() => void cancelSend()} className="text-red-700 hover:bg-red-50">
            Cancel send
          </Button>
        )}
        {scheduledFu && (
          <Button variant="ghost" loading={busy} onClick={() => void cancelFollowUp(scheduledFu)} className="text-red-700 hover:bg-red-50">
            Cancel follow-up
          </Button>
        )}
        {app.canStopFollowUps && (
          <Button variant="ghost" disabled={busy} onClick={() => setConfirmStop(true)}>
            Stop follow-ups
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmStop}
        title="Stop follow-ups?"
        confirmLabel="Stop follow-ups"
        busy={busy}
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => void post(`/api/items/${app.id}/stop-followups`, "No more follow-ups will be sent for this application.")}
      >
        JobDraft won&apos;t send or prepare any more follow-ups to {app.company} for this role. Any pending follow-up is cancelled.
      </ConfirmDialog>
    </li>
  );
}

const HANDLING_TONE: Record<Application["handling"]["key"], string> = {
  auto: "text-violet-900",
  user: "text-emerald-700",
  scheduled: "text-sky-900",
  draft: "text-amber-900",
  removed: "text-slate-600",
};

const FU_STATE: Record<FollowUp["state"], string> = {
  scheduled: "scheduled",
  draft_created: "draft ready",
  sending: "sending",
  sent: "sent",
  cancelled: "cancelled",
  skipped: "skipped",
  not_needed: "not needed",
  expired: "expired",
  failed: "failed",
};

const OUTCOME: Record<Application["outcome"], string> = { open: "Waiting for a reply", replied: "Replied", bounced: "Bounced", no_response: "No response", stopped: "Stopped" };

/** sent → follow-up 1 → follow-up 2 → outcome */
function Timeline({ app }: { app: Application }) {
  if (app.sendState !== "sent" && !app.sentAt) return null;
  const when = (d: string | null | undefined) => (d ? `${formatDayIst(d)} ${formatTimeIst(d)}` : "");
  const steps: { label: string; detail: string; state: "done" | "pending" | "off" }[] = [{ label: "Sent", detail: when(app.sentAt), state: "done" }];
  for (const n of [1, 2] as const) {
    const f = app.followups.find((x) => x.sequence === n);
    if (f) steps.push({ label: `Follow-up ${n}`, detail: `${FU_STATE[f.state]}${f.state === "sent" ? ` ${when(f.sentAt)}` : f.sendAt && f.state === "scheduled" ? ` ${when(f.sendAt)}` : ""}`, state: f.state === "sent" ? "done" : f.state === "scheduled" || f.state === "draft_created" ? "pending" : "off" });
  }
  steps.push({ label: OUTCOME[app.outcome], detail: app.repliedAt ? when(app.repliedAt) : "", state: app.outcome === "open" ? "pending" : "done" });
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Timeline">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className={cx("size-2 rounded-full", s.state === "done" ? "bg-emerald-700" : s.state === "pending" ? "bg-sky-600" : "bg-slate-400")} aria-hidden />
          <span className="text-slate-700">
            <span className="font-semibold text-slate-900">{s.label}</span>
            {s.detail && ` ${s.detail}`}
          </span>
          {i < steps.length - 1 && <span className="text-slate-400" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

function JobLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 hover:underline">
      View job <ExternalLink className="size-4" aria-hidden />
    </a>
  );
}
