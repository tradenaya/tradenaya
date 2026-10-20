"use client";

import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatDayIst, formatRunTime, formatTimeIst } from "@/lib/format";
import { Button, cx } from "./ui";

/** "HH:MM" (24 h) ⇄ 12-hour parts */
function toParts(value: string): { hour12: number; minute: number; pm: boolean } {
  const [h = 9, m = 0] = value.split(":").map(Number);
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: m, pm: h >= 12 };
}
function fromParts(hour12: number, minute: number, pm: boolean): string {
  const h = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 15, 30, 45];
const PRESETS = ["07:00", "09:00", "12:00", "18:00"];

/** Point on the dial, in % of the face (0° = 12 o'clock). */
function onDial(index: number, of: number, radius = 38) {
  const angle = (index / of) * 2 * Math.PI;
  return { x: 50 + radius * Math.sin(angle), y: 50 - radius * Math.cos(angle) };
}

/** Clock-face picker in a dialog: pick the hour, then :00 / :15 / :30 / :45, and AM/PM. */
function ClockDialog({ open, value, onClose, onSet }: { open: boolean; value: string; onClose: () => void; onSet: (v: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => toParts(value));
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const [prevOpen, setPrevOpen] = useState(open);
  // Each time it opens, start from the saved value on the hour dial.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(toParts(value));
      setMode("hour");
    }
  }

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const items = mode === "hour" ? HOURS : MINUTES;
  const selectedIndex = mode === "hour" ? HOURS.indexOf(draft.hour12) : MINUTES.indexOf(draft.minute);
  const hand = onDial(mode === "hour" ? selectedIndex : selectedIndex * 3, 12, 30);
  const two = (n: number) => String(n).padStart(2, "0");

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label="Choose your daily run time"
      className="m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-3xl bg-white p-0 text-slate-900 shadow-2xl ring-1 ring-slate-200"
    >
      <div className="p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Run every day at (India time)</p>

        {/* Digital display: tap hour/minute to switch the dial; AM/PM toggle. */}
        <div className="mt-3 flex items-center justify-center gap-3">
          <div className="flex items-center gap-1 text-5xl font-bold tabular-nums">
            <button
              type="button"
              onClick={() => setMode("hour")}
              aria-label={`Hour ${draft.hour12}, change`}
              aria-pressed={mode === "hour"}
              className={cx("min-h-11 rounded-xl px-2", mode === "hour" ? "bg-brand-50 text-brand-700" : "text-slate-900 hover:bg-slate-100")}
            >
              {two(draft.hour12)}
            </button>
            <span aria-hidden className="text-slate-400">
              :
            </span>
            <button
              type="button"
              onClick={() => setMode("minute")}
              aria-label={`Minute ${two(draft.minute)}, change`}
              aria-pressed={mode === "minute"}
              className={cx("min-h-11 rounded-xl px-2", mode === "minute" ? "bg-brand-50 text-brand-700" : "text-slate-900 hover:bg-slate-100")}
            >
              {two(draft.minute)}
            </button>
          </div>
          <div role="group" aria-label="AM or PM" className="flex flex-col overflow-hidden rounded-xl ring-1 ring-slate-300">
            {(["AM", "PM"] as const).map((p) => {
              const active = (p === "PM") === draft.pm;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDraft({ ...draft, pm: p === "PM" })}
                  className={cx("min-h-11 px-3 text-sm font-bold", active ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100")}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        {/* The clock face */}
        <div className="relative mx-auto mt-4 aspect-square w-full max-w-[17rem] rounded-full bg-slate-100" role="group" aria-label={mode === "hour" ? "Hours" : "Minutes"}>
          <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
            {mode === "minute" &&
              Array.from({ length: 60 }, (_, i) => {
                const a = onDial(i, 60, 46);
                const b = onDial(i, 60, i % 5 === 0 ? 43 : 44.5);
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-slate-300)" strokeWidth={i % 5 === 0 ? 0.8 : 0.4} />;
              })}
            {selectedIndex >= 0 && (
              <>
                <line x1="50" y1="50" x2={hand.x} y2={hand.y} stroke="var(--color-brand-600)" strokeWidth="1.2" strokeLinecap="round" className="transition-all" />
                <circle cx="50" cy="50" r="1.8" fill="var(--color-brand-600)" />
              </>
            )}
          </svg>
          {items.map((n, i) => {
            const p = mode === "hour" ? onDial(i, 12) : onDial(i * 3, 12);
            const selected = i === selectedIndex;
            return (
              <button
                key={n}
                type="button"
                aria-label={mode === "hour" ? `${n} o'clock` : `${two(n)} minutes`}
                aria-pressed={selected}
                onClick={() => {
                  if (mode === "hour") {
                    setDraft({ ...draft, hour12: n });
                    setMode("minute");
                  } else setDraft({ ...draft, minute: n });
                }}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                className={cx(
                  "absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-base font-semibold tabular-nums transition-colors",
                  selected ? "bg-brand-600 text-white shadow" : "text-slate-800 hover:bg-white",
                )}
              >
                {mode === "hour" ? n : `:${two(n)}`}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-center text-sm text-slate-600">{mode === "hour" ? "Tap an hour" : "Tap the minutes (every 15)"}</p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Quick picks">
          {PRESETS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setDraft(toParts(t))}
              className="min-h-11 rounded-full px-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
            >
              {formatRunTime(t)}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSet(fromParts(draft.hour12, draft.minute, draft.pm))}>
            Set {formatRunTime(fromParts(draft.hour12, draft.minute, draft.pm))}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

export function RunTimeField({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<{ at: string | null; automationEnabled: boolean } | null>(null);

  // Live "Next run" hint, computed by the server with the scheduler's own function.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ at: string | null; automationEnabled: boolean }>(`/api/profile/next-run?run_time=${encodeURIComponent(value)}`, { signal: ctrl.signal }).then(
        (r) => setHint(r),
        () => undefined,
      );
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value]);

  return (
    <div>
      <p id={`${id}-label`} className="mb-1 block font-medium text-slate-900">
        Run every day at (India time)
      </p>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-labelledby={`${id}-label ${id}`}
        aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
        data-testid="run-time-button"
        className={cx(
          "flex min-h-14 w-full max-w-64 items-center gap-3 rounded-2xl border bg-white px-4 py-2 text-left hover:bg-slate-50",
          error ? "border-red-600" : "border-slate-300",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Clock className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-2xl font-bold tabular-nums text-slate-900">{formatRunTime(value)}</span>
          <span className="block text-sm text-slate-600">IST · tap to change</span>
        </span>
      </button>
      <p id={`${id}-hint`} className="mt-2 flex items-center gap-1.5 text-sm text-slate-600" aria-live="polite" data-testid="next-run-hint">
        {hint?.at ? (
          <span>
            Next run: {formatDayIst(hint.at)}, {formatTimeIst(hint.at)} IST{hint.automationEnabled ? "" : " (once automation is on)"}
          </span>
        ) : (
          <span>Default 9:00 AM. Any time of day, in 15-minute steps.</span>
        )}
      </p>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
      <ClockDialog
        open={open}
        value={value}
        onClose={() => setOpen(false)}
        onSet={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
    </div>
  );
}
