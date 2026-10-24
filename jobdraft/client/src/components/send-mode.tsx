"use client";

import { Check, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { SEND_MODE_OPTIONS, sendModeTitle, type SendModeOption } from "@/lib/send-modes";
import type { Profile, SendMode } from "@/lib/types";
import { useConfirm, type ConfirmOptions } from "./confirm-dialog";
import { cx } from "./ui";

function confirmFor(o: SendModeOption): ConfirmOptions {
  switch (o.value) {
    case "send_all_instant":
      return { title: "Send all instantly?", body: "Emails will be sent without a chance to cancel. Continue?", confirmLabel: "Continue", danger: true };
    case "drafts_only":
      return {
        title: "Switch to Drafts only?",
        body: "From now on every email stays in your Gmail drafts. Anything waiting to be sent is cancelled now and kept as a draft.",
        confirmLabel: "Switch to Drafts only",
      };
    default:
      return {
        title: `Switch to ${o.title}?`,
        body: `${o.description} This applies to emails prepared from now on; existing drafts are never sent for you.`,
        confirmLabel: `Switch to ${o.title}`,
      };
  }
}

/** One mode at a time, as toggle cards. Usable only while automation is ON; the saved value is kept while it's OFF. */
export function SendModeSelector({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [busy, setBusy] = useState<SendMode | null>(null);
  const confirm = useConfirm();
  const { enabled, sendMode } = profile.automation;

  // Arriving from the dashboard's "Change" link: the page loads first, so scroll here once rendered.
  useEffect(() => {
    if (window.location.hash === "#send-mode") document.getElementById("send-mode")?.scrollIntoView({ block: "start" });
  }, []);

  async function choose(o: SendModeOption) {
    if (!enabled || busy || o.value === sendMode) return;
    if (!(await confirm(confirmFor(o)))) return;
    setBusy(o.value);
    try {
      const next = await api<Profile>("/api/automation/send-mode", { method: "PUT", body: { mode: o.value } });
      onChange(next);
      toast.success(`Sending mode: ${o.title}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="send-mode" aria-labelledby="send-mode-title" className="scroll-mt-20 rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
      <h2 id="send-mode-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <Send className="size-5 text-brand-700" aria-hidden />
        Sending mode
      </h2>
      <p id="send-mode-hint" className="mt-1 text-[15px] text-slate-700">
        {enabled ? "What happens to the emails JobDraft prepares. Changes apply to emails prepared from now on." : "Turn on automation to use. Your choice is kept."}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="send-mode-title"
        aria-describedby="send-mode-hint"
        aria-disabled={!enabled || undefined}
        className="mt-3 grid gap-2 sm:grid-cols-2"
        data-testid="send-mode"
      >
        {SEND_MODE_OPTIONS.map((o) => {
          const selected = o.value === sendMode;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={o.recommended ? `${o.title} (recommended)` : o.title}
              aria-describedby={`send-mode-${o.value}-desc`}
              disabled={!enabled || !!busy}
              onClick={() => void choose(o)}
              className={cx(
                "flex min-h-11 w-full items-start gap-3 rounded-xl p-3 text-left ring-1 ring-inset transition-colors",
                selected ? "bg-brand-50 ring-2 ring-brand-600" : "bg-white ring-slate-300 enabled:hover:bg-slate-50",
                "disabled:cursor-not-allowed disabled:opacity-55",
              )}
            >
              <span
                className={cx(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ring-2 ring-inset",
                  selected ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-400",
                )}
                aria-hidden
              >
                {selected && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-slate-900">
                  {o.title}
                  {o.recommended && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">Recommended</span>}
                  {busy === o.value && <span className="text-xs font-normal text-slate-600">Saving…</span>}
                </span>
                <span id={`send-mode-${o.value}-desc`} className="mt-0.5 block text-sm text-slate-700">
                  {o.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The current mode with a "Change" link (dashboard, next to the automation switch). */
export function SendModeSummary({ profile }: { profile: Profile }) {
  const { enabled, sendMode } = profile.automation;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 border-t border-black/10 pt-3 text-[15px] text-slate-800" data-testid="send-mode-summary">
      <span>
        Sending mode: <strong className="font-semibold">{sendModeTitle(sendMode)}</strong>
        {!enabled && <span className="text-slate-600"> (applies when automation is on)</span>}
      </span>
      <Link href="/setup#send-mode" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline-offset-2 hover:underline">
        Change
      </Link>
    </p>
  );
}
