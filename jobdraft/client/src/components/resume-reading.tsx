"use client";

import { Check, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "./ui";

/**
 * Shown while a resume is uploaded and read. The server doesn't report its
 * progress, so the steps follow typical timings (≈10–30 s; it gives up at ~1 min).
 */
const STEPS = [
  { at: 0, label: "Uploading your PDF" },
  { at: 2, label: "Pulling out the text" },
  { at: 5, label: "Reading your experience and skills" },
  { at: 14, label: "Finding roles that fit you" },
  { at: 26, label: "Finishing up" },
];

export function ResumeReading({ fileName }: { fileName: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, []);

  const current = STEPS.reduce((acc, s, i) => (seconds >= s.at ? i : acc), 0);
  // Eases towards 95% and never claims to be done before the server answers.
  const progress = Math.min(95, Math.round(100 * (1 - Math.exp(-seconds / 16))));
  const slow = seconds >= 40;

  return (
    <div role="status" aria-live="polite" className="overflow-hidden rounded-2xl bg-brand-50 p-4 ring-1 ring-inset ring-brand-100 sm:p-5" data-testid="resume-reading">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <Paper />
        <div className="w-full min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              <Sparkles className="size-5 shrink-0 text-brand-600 motion-safe:animate-pulse" aria-hidden />
              Reading your resume
            </p>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-medium tabular-nums text-brand-700 ring-1 ring-inset ring-brand-100" aria-label={`${seconds} seconds so far`}>
              {formatElapsed(seconds)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-600" title={fileName}>
            {fileName}
          </p>

          <ol className="mt-3 space-y-1.5">
            {STEPS.map((s, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <li key={s.label} className={cx("flex items-center gap-2 text-[15px] transition-colors duration-300", done ? "text-slate-700" : active ? "font-medium text-slate-900" : "text-slate-500")}>
                  <span
                    className={cx(
                      "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                      done ? "bg-emerald-700 text-white" : active ? "bg-brand-600 text-white" : "ring-1 ring-inset ring-slate-300",
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : active ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  </span>
                  <span>{s.label}</span>
                  <span className="sr-only">{done ? "(done)" : active ? "(in progress)" : ""}</span>
                </li>
              );
            })}
          </ol>

          <div className="mt-4" aria-hidden>
            <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-inset ring-brand-100">
              <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-700 ease-out" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {slow ? "Taking a little longer than usual — hang tight." : "Usually takes 10–30 seconds, at most about a minute."} Please keep this page open.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatElapsed(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A little resume page with a scanning beam passing over it. */
function Paper() {
  const lines = ["w-3/5", "w-11/12", "w-4/5", "w-2/3", "w-11/12", "w-3/4", "w-1/2"];
  return (
    <div className="relative h-36 w-28 shrink-0 overflow-hidden rounded-lg bg-white p-3 shadow-lg shadow-brand-600/15 ring-1 ring-slate-200" aria-hidden>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="size-5 rounded-full bg-brand-100" />
        <span className="h-2 flex-1 rounded-full bg-slate-300" />
      </div>
      <div className="space-y-2">
        {lines.map((w, i) => (
          <span key={i} className={cx("block h-1.5 rounded-full bg-slate-200 motion-safe:animate-line-glow", w)} style={{ animationDelay: `${i * 0.28}s` }} />
        ))}
      </div>
      <span className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-brand-600/25 to-transparent motion-safe:animate-scan" />
      <span className="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded-full bg-brand-600 shadow-[0_0_10px_2px] shadow-brand-600/60 motion-safe:animate-scan" />
    </div>
  );
}
