import { cx } from "./ui";
import type { Application, RunStatus } from "@/lib/types";
import { formatDayIst, formatTimeIst } from "@/lib/format";

const STATUS: Record<RunStatus, { label: string; cls: string }> = {
  running: { label: "Running", cls: "bg-sky-100 text-sky-900 ring-sky-300" },
  ready_to_send: { label: "Ready to send", cls: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  sending: { label: "Sending", cls: "bg-sky-100 text-sky-900 ring-sky-300" },
  sent: { label: "Sent", cls: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  no_matches: { label: "No new matches", cls: "bg-slate-100 text-slate-800 ring-slate-300" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-900 ring-red-300" },
  completed: { label: "Completed", cls: "bg-violet-100 text-violet-900 ring-violet-300" },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS[status] ?? STATUS.no_matches;
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ring-inset", s.cls)}>
      {(status === "running" || status === "sending") && <span className="size-2 animate-pulse rounded-full bg-sky-600" aria-hidden />}
      {s.label}
    </span>
  );
}

const TONE: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  info: "bg-sky-50 text-sky-900 ring-sky-200",
  wait: "bg-amber-50 text-amber-900 ring-amber-200",
  bad: "bg-red-50 text-red-900 ring-red-200",
  done: "bg-violet-50 text-violet-900 ring-violet-200",
  muted: "bg-slate-100 text-slate-800 ring-slate-200",
};

function toneOf(key: string): string {
  if (key === "replied") return TONE.good!;
  if (key === "bounced" || key === "failed") return TONE.bad!;
  if (key === "draft" || key === "followup_draft") return TONE.wait!;
  if (key === "scheduled" || key.endsWith("_scheduled")) return TONE.info!;
  if (key === "sent" || key.endsWith("_sent")) return TONE.done!;
  return TONE.muted!;
}

/** "Sent at 9:32 AM", "Follow-up 1 scheduled · Mon 10:45 AM", "Replied"… */
export function ApplicationChip({ status }: { status: Application["status"] }) {
  const when = status.at ? ` · ${formatDayIst(status.at)} ${formatTimeIst(status.at)}` : "";
  return (
    <span className={cx("inline-flex max-w-full rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", toneOf(status.key))}>
      <span className="truncate">
        {status.label}
        {when}
      </span>
    </span>
  );
}
