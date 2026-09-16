"use client";

import { useState, useRef, useEffect } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function buildDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(new Date(year, month, d));
  return cells;
}

function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function formatDisplay(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${date}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function valueToDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function DateTimePicker({ value, onChange, placeholder = "Select date & time", className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = valueToDate(value);
  const now = new Date();

  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? now.getMonth());
  const [hour, setHour] = useState(selected?.getHours() ?? now.getHours());
  const [minute, setMinute] = useState(selected?.getMinutes() ?? 0);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const syncView = () => {
    const base = selected ?? now;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setHour(base.getHours());
    setMinute(base.getMinutes());
  };

  const goPrev = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const goNext = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectDay = (d: Date) => {
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0);
    onChange(dt.toISOString());
    setHour(dt.getHours());
    setMinute(dt.getMinutes());
    setOpen(false);
  };

  const days = buildDays(viewYear, viewMonth);
  const todayStr = now.toDateString();

  const inputStyle: React.CSSProperties = {
    backgroundColor: "rgba(7,6,5,0.8)",
    borderColor: "rgba(201,154,88,0.16)",
    color: value ? "#eee5d8" : "#a89880",
  };

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => { syncView(); setOpen(!open); }}
        className="flex h-10 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm shadow-sm transition"
        style={inputStyle}
      >
        <CalendarDays size={15} className="shrink-0" style={{ color: "#c99a58" }} />
        <span className="flex-1 truncate">{value ? formatDisplay(value) : placeholder}</span>
        <ChevronDown size={14} className="shrink-0" style={{ color: "rgba(201,154,88,0.45)" }} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 rounded-xl border shadow-2xl"
          style={{
            background: "linear-gradient(180deg, #14100c 0%, #0a0907 100%)",
            borderColor: "rgba(201,154,88,0.16)",
            boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
            width: 300,
          }}
        >
          {/* Month nav */}
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <button type="button" onClick={goPrev} className="p-1 rounded-md transition cursor-pointer" style={{ color: "#a89880" }}>
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold" style={{ color: "#c99a58", fontFamily: "var(--font-cinzel), serif" }}>
              {monthLabel(viewYear, viewMonth)}
            </span>
            <button type="button" onClick={goNext} className="p-1 rounded-md transition cursor-pointer" style={{ color: "#a89880" }}>
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 px-3 mt-1">
            {WEEKDAYS.map((d) => (
              <span key={d} className="flex h-6 items-center justify-center text-[0.65rem] font-medium" style={{ color: "rgba(201,154,88,0.45)" }}>
                {d}
              </span>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1 px-3 mt-1">
            {days.map((date, i) => {
              if (date == null) return <span key={`e-${i}`} className="h-8 w-8" />;
              const isSelected = selected?.toDateString() === date.toDateString();
              const isToday = date.toDateString() === todayStr;
              return (
                <button
                  key={date.toDateString()}
                  type="button"
                  onClick={() => selectDay(date)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-sm transition cursor-pointer"
                  style={
                    isSelected
                      ? { background: "linear-gradient(135deg, #c99a58, #a47209)", color: "#070605", fontWeight: 600, boxShadow: "0 0 12px rgba(201,154,88,0.35)" }
                      : isToday
                        ? { border: "1px solid rgba(201,154,88,0.6)", color: "#c99a58" }
                        : { color: "#eee5d8" }
                  }
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.15)"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Time selector */}
          <div className="flex items-center gap-2 px-3 pt-3 pb-3 border-t mt-2" style={{ borderColor: "rgba(201,154,88,0.12)" }}>
            <Clock size={14} style={{ color: "#a89880" }} />
            <span className="text-xs" style={{ color: "#a89880" }}>Time:</span>
            <select
              value={pad(hour)}
              onChange={(e) => setHour(Number(e.target.value))}
              className="h-8 rounded-lg border px-1.5 text-xs font-medium outline-none cursor-pointer"
              style={{ backgroundColor: "rgba(7,6,5,0.8)", borderColor: "rgba(201,154,88,0.16)", color: "#eee5d8" }}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={pad(i)} style={{ backgroundColor: "#0a0907", color: "#eee5d8" }}>
                  {pad(i)}
                </option>
              ))}
            </select>
            <span className="text-xs font-bold" style={{ color: "#c99a58" }}>:</span>
            <select
              value={pad(minute)}
              onChange={(e) => setMinute(Number(e.target.value))}
              className="h-8 rounded-lg border px-1.5 text-xs font-medium outline-none cursor-pointer"
              style={{ backgroundColor: "rgba(7,6,5,0.8)", borderColor: "rgba(201,154,88,0.16)", color: "#eee5d8" }}
            >
              {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                <option key={m} value={pad(m)} style={{ backgroundColor: "#0a0907", color: "#eee5d8" }}>
                  {pad(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
