import { Check } from "lucide-react";
import type { Profile } from "@/lib/types";
import { cx } from "./ui";

const STEPS = [
  { key: "resume", label: "Resume", href: "#resume" },
  { key: "preferences", label: "Preferences", href: "#preferences" },
  { key: "gmail", label: "Connect Gmail", href: "#gmail" },
] as const;

export function Stepper({ complete }: { complete: Profile["complete"] }) {
  const current = STEPS.findIndex((s) => !complete[s.key]);
  return (
    <nav aria-label="Setup progress" className="mb-4">
      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((s, i) => {
          const done = complete[s.key];
          const isCurrent = i === current;
          return (
            <li key={s.key}>
              <a
                href={s.href}
                aria-current={isCurrent ? "step" : undefined}
                className={cx(
                  "flex min-h-11 flex-col items-center gap-1 rounded-xl p-2 text-center text-sm font-semibold ring-1 ring-inset sm:flex-row sm:justify-center",
                  done ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : isCurrent ? "bg-brand-50 text-brand-800 ring-brand-100" : "bg-white text-slate-600 ring-slate-200",
                )}
              >
                <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-full text-xs", done ? "bg-emerald-700 text-white" : isCurrent ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-700")}>
                  {done ? <Check className="size-4" aria-hidden /> : i + 1}
                </span>
                <span>
                  {s.label}
                  <span className="sr-only">{done ? " (done)" : isCurrent ? " (current step)" : ""}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
