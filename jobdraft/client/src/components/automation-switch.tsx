"use client";

import { Power } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatDateIst } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { cx } from "./ui";

/** The master switch: "I got a job, stop searching." Large on the dashboard, mirrored on Setup. */
export function AutomationSwitch({ profile, onChange, compact }: { profile: Profile; onChange: (p: Profile) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const a = profile.automation;
  const blocked = !a.enabled && a.missing.length > 0;

  async function toggle() {
    setBusy(true);
    try {
      const next = await api<Profile>("/api/automation", { method: "PUT", body: { enabled: !a.enabled } });
      onChange(next);
      toast.success(next.automation.enabled ? "Automation is on. JobDraft will run at your daily time." : "Automation is off. Nothing will be drafted or sent.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="automation-title"
      className={cx(
        "rounded-2xl p-4 ring-1 sm:p-5",
        a.enabled ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-200",
        !compact && "shadow-sm",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="automation-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Power className={cx("size-5", a.enabled ? "text-emerald-700" : "text-slate-500")} aria-hidden />
            Automation {a.enabled ? "ON" : "OFF"}
          </h2>
          <p id="automation-desc" className="mt-1 text-[15px] text-slate-700">
            {a.enabled
              ? "Every day at your run time, JobDraft finds matching jobs and prepares emails in your Gmail. Only the strongest matches are sent automatically, after a 30-minute window to cancel; the rest wait in your drafts."
              : a.changedAt
                ? `Off since ${formatDateIst(a.changedAt)}. Nothing is fetched, drafted or sent until you turn it on.`
                : "Turn on to start daily runs. Nothing is drafted or sent while it's off."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={a.enabled}
          aria-labelledby="automation-title"
          aria-describedby="automation-desc"
          disabled={busy || blocked}
          onClick={toggle}
          className="relative inline-flex h-11 w-[4.5rem] shrink-0 items-center justify-center rounded-full disabled:opacity-50"
          data-testid="automation-switch"
        >
          <span className={cx("absolute h-8 w-14 rounded-full transition-colors", a.enabled ? "bg-emerald-700" : "bg-slate-400")} />
          <span className={cx("absolute size-7 rounded-full bg-white shadow transition-transform", a.enabled ? "translate-x-3" : "-translate-x-3")} />
        </button>
      </div>
      {blocked && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-[15px] text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-semibold">To turn it on:</p>
          <ul className="mt-1 list-disc pl-5">
            {a.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
