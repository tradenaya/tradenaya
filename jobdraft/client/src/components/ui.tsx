"use client";

import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { forwardRef, useId, useState } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-gradient text-white shadow-md shadow-brand-600/25 hover:brightness-110 hover:shadow-lg hover:shadow-brand-600/30 active:brightness-95 disabled:bg-none disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none disabled:brightness-100",
  secondary: "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-500",
  ghost: "bg-transparent text-brand-700 hover:bg-brand-50 active:bg-brand-100 disabled:text-slate-500",
  danger: "bg-red-700 text-white hover:bg-red-800 active:bg-red-900 disabled:bg-slate-300 disabled:text-slate-600",
};

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-base font-semibold transition duration-150 enabled:active:scale-[0.98] disabled:cursor-not-allowed select-none";

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; full?: boolean }>(
  function Button({ variant = "primary", loading, full, className, children, disabled, ...rest }, ref) {
    return (
      <button ref={ref} className={cx(BASE, VARIANTS[variant], full && "w-full", className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
        {loading && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export function ButtonLink({ href, variant = "primary", full, external, className, children }: { href: string; variant?: ButtonVariant; full?: boolean; external?: boolean; className?: string; children: React.ReactNode }) {
  const cls = cx(BASE, VARIANTS[variant], full && "w-full", className);
  if (external)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Card({ title, action, children, className, id }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("animate-rise rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6", className)} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "info" | "warn" | "error" | "success";
const TONES: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: "bg-sky-50 text-sky-900 ring-sky-200", Icon: Info },
  warn: { cls: "bg-amber-50 text-amber-900 ring-amber-300", Icon: AlertTriangle },
  error: { cls: "bg-red-50 text-red-900 ring-red-200", Icon: XCircle },
  success: { cls: "bg-emerald-50 text-emerald-900 ring-emerald-200", Icon: CheckCircle2 },
};

export function Banner({ tone = "info", title, children, action }: { tone?: Tone; title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const { cls, Icon } = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex gap-3 rounded-xl p-3 ring-1 ring-inset sm:p-4", cls)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-[15px] leading-6">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-slate-200", className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function PageTitle({ children, subtitle }: { children: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-4 animate-rise">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{children}</h1>
      {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ invalid, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        "block min-h-11 w-full rounded-xl border bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-500",
        invalid ? "border-red-600" : "border-slate-300",
        "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30",
        className,
      )}
      {...rest}
    />
  );
});

/** Password input with an eye button to show or hide what was typed (`what` names it for screen readers). */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { invalid?: boolean; what?: string }>(function PasswordInput(
  { className, what = "password", ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cx("pr-12", className)} {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Hide ${what}` : `Show ${what}`}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-600 hover:text-slate-900"
      >
        {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  );
});

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block font-medium text-slate-900">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="mt-1 text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="mt-1 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={`${id}-label`} className="font-medium text-slate-900">
          {label}
        </p>
        {description && (
          <p id={`${id}-desc`} className="text-sm text-slate-600">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-11 w-16 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
      >
        <span className={cx("absolute h-7 w-12 rounded-full transition-colors", checked ? "bg-brand-600" : "bg-slate-400")} />
        <span className={cx("absolute size-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-2.5" : "-translate-x-2.5")} />
      </button>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</div>}
      <p className="font-semibold text-slate-900">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-sm text-slate-600">{children}</div>}
    </div>
  );
}
