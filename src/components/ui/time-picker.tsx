"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Clock as ClockIcon, Check, X } from "lucide-react";

import { normalizeTimeInput } from "@/lib/time-literal";

/**
 * Interactive 24-hour clock picker.
 *
 * Why this exists: `react-time-picker@8` renders `react-clock@6` without an
 * `onChange` handler, and `react-clock@6` is presentational only (its prop type
 * has no `onChange`). The dial it draws is therefore inert — clicking the
 * numbers does nothing. This component implements the selection itself.
 *
 * Hours are picked on a 24-number ring. The radius is sized from the actual
 * chord so adjacent numbers (15 degrees apart) never overlap:
 *   2 * 124 * sin(7.5deg) = 32.4px between centres vs 28px buttons.
 *
 * Minutes are offered as a 6x10 grid covering every minute 00-59. Sixty
 * positions on a dial would need a ~390px radius to stay clickable, and a ring
 * that large no longer fits on screen — a grid gives all sixty without that.
 *
 * 24-hour only, no AM/PM. The typed field stays editable for exact entry.
 */

const SIZE = 288;
const CENTER = SIZE / 2;
const FACE_RADIUS = 142;
const HOUR_RADIUS = 124;
const MINUTE_GRID_COLS = 6;

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Step = "hour" | "minute";

export interface TimePicker24Props {
  /** "HH:mm" in 24-hour form, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  hourAriaLabel?: string;
  minuteAriaLabel?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parse(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (!m) return { hour: 0, minute: 0 };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  };
}

/** Point on a circle: step 0 sits at 12 o'clock, advancing clockwise. */
function pointOn(radius: number, step: number, total: number) {
  const angle = (step / total) * 360 - 90;
  const rad = (angle * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

export function TimePicker24({
  value,
  onChange,
  id,
  className,
  hourAriaLabel = "Expiry hour (24-hour)",
  minuteAriaLabel = "Expiry minute",
}: TimePicker24Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("hour");
  const [placement, setPlacement] = useState({ above: false, left: 0, width: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const { hour, minute } = parse(value);
  const hasValue = Boolean(value);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Keep the popover inside the viewport: flip above the field when there is not
  // enough room below, and slide it sideways rather than letting it clip.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    const anchor = ref.current;
    if (!pop || !anchor) return;

    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const popH = pop.offsetHeight;
      const popW = pop.offsetWidth;
      const margin = 12;

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const above = spaceBelow < popH && spaceAbove > spaceBelow;

      // Horizontal: 0 keeps it aligned to the field's left edge.
      let left = 0;
      if (rect.left + popW > window.innerWidth - margin) {
        left = Math.min(0, window.innerWidth - margin - popW - rect.left);
      }
      if (rect.left + left < margin) {
        left = margin - rect.left;
      }

      setPlacement({ above, left, width: popW });
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step]);

  const pickHour = (h: number) => {
    onChange(`${pad(h)}:${pad(minute)}`);
    setStep("minute");
  };

  const pickMinute = (m: number) => {
    onChange(`${pad(hour)}:${pad(m)}`);
    setOpen(false);
  };

  const handleTyped = (raw: string) => {
    // Normalise to a canonical, clamped 24-hour value so the field can never
    // settle on something the save request would reject.
    onChange(normalizeTimeInput(raw));
  };

  const handPoint = pointOn(HOUR_RADIUS, hour, 24);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const allMinutes = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <div
        className="flex items-center rounded-lg border transition"
        style={{ borderColor: open ? "var(--primary)" : "var(--border)", background: "var(--input)" }}
      >
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => handleTyped(e.target.value)}
          placeholder="--:--"
          aria-label={`${hourAriaLabel} and ${minuteAriaLabel}`}
          className="h-10 w-full min-w-0 bg-transparent px-3 text-sm tabular-nums outline-none"
          style={{ color: hasValue ? "var(--foreground)" : "var(--text-muted)" }}
        />
        {hasValue && (
          <button
            type="button"
            aria-label="Clear time"
            onClick={() => onChange("")}
            className="flex items-center px-1.5 transition"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label={open ? "Close clock" : "Open clock"}
          aria-expanded={open}
          onClick={() => {
            setStep("hour");
            setOpen(!open);
          }}
          className="flex h-full items-center border-l px-2.5 transition"
          style={{ borderColor: "var(--border)", color: "var(--primary)" }}
        >
          <ClockIcon size={16} />
        </button>
      </div>

      {open && (
        <div
          ref={popRef}
          className="absolute z-50 rounded-xl border p-3 shadow-2xl"
          style={{
            width: step === "hour" ? SIZE + 24 : 234,
            left: placement.left,
            // Flip above the field when the space below is too short.
            ...(placement.above ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
            background: "var(--popover)",
            borderColor: "var(--border)",
            boxShadow: "0 18px 50px rgba(0,0,0,0.65)",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "var(--primary)" }}>
              {step === "hour" ? "Select hour (24-hour)" : "Select minute"}
            </span>
            <div className="flex items-center gap-1">
              {step === "minute" && (
                <button
                  type="button"
                  onClick={() => setStep("hour")}
                  className="rounded px-1.5 py-0.5 text-xs transition"
                  style={{ color: "var(--text-muted)" }}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition"
                style={{ color: "var(--primary)" }}
              >
                <Check size={12} />
                Done
              </button>
            </div>
          </div>

          {step === "hour" ? (
            <div className="relative" style={{ width: SIZE, height: SIZE }}>
              <svg
                width={SIZE}
                height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="absolute inset-0"
                aria-hidden="true"
              >
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={FACE_RADIUS}
                  fill="var(--card)"
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                {Array.from({ length: 24 }, (_, i) => {
                  const outer = pointOn(FACE_RADIUS - 2, i, 24);
                  const inner = pointOn(HOUR_RADIUS + 2, i, 24);
                  return (
                    <line
                      key={i}
                      x1={inner.x}
                      y1={inner.y}
                      x2={outer.x}
                      y2={outer.y}
                      stroke="var(--text-muted)"
                      strokeOpacity={0.4}
                      strokeWidth={1}
                    />
                  );
                })}
                {/* selected hand */}
                <line
                  x1={CENTER}
                  y1={CENTER}
                  x2={handPoint.x}
                  y2={handPoint.y}
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <circle cx={CENTER} cy={CENTER} r={3.5} fill="var(--primary)" />
              </svg>

              {hours.map((h) => {
                const p = pointOn(HOUR_RADIUS, h, 24);
                const isSelected = h === hour;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => pickHour(h)}
                    aria-label={`Hour ${pad(h)}`}
                    aria-pressed={isSelected}
                    className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-medium tabular-nums transition hover:bg-primary/25"
                    style={{
                      left: p.x,
                      top: p.y,
                      background: isSelected ? "var(--primary)" : "transparent",
                      color: isSelected ? "var(--primary-foreground)" : "var(--foreground)",
                    }}
                  >
                    {pad(h)}
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${MINUTE_GRID_COLS}, minmax(0, 1fr))` }}
            >
              {allMinutes.map((m) => {
                const isSelected = m === minute;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pickMinute(m)}
                    aria-label={`Minute ${pad(m)}`}
                    aria-pressed={isSelected}
                    className="flex h-7 items-center justify-center rounded-md text-xs font-medium tabular-nums transition hover:bg-primary/25"
                    style={{
                      background: isSelected ? "var(--primary)" : "transparent",
                      color: isSelected ? "var(--primary-foreground)" : "var(--foreground)",
                    }}
                  >
                    {pad(m)}
                  </button>
                );
              })}
            </div>
          )}

          <p className="mt-2 text-center text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {pad(hour)}:{pad(minute)}
          </p>
        </div>
      )}
    </div>
  );
}
