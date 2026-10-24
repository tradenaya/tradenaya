"use client";

import { ChevronDown, Filter } from "lucide-react";
import { useId, useState } from "react";
import type { Funnel, JobSource, QueryVariant, RemovalStep } from "@/lib/types";
import { cx } from "./ui";

const SOURCE_LABEL: Record<JobSource, string> = { adzuna: "Adzuna", jsearch: "JSearch", mock: "Demo source" };

const STEP_LABEL: Record<RemovalStep, string> = {
  excluded: "Past employers / companies to skip",
  seen: "Already seen in earlier runs",
  location: "Outside your locations",
  title: "Title doesn't match your roles",
  industry: "Not a software / IT role",
  seniority: "Seniority doesn't fit",
  experience: "Needs more experience",
  salary: "Pays below your expected salary",
  agency: "Staffing agency",
  contacted: "Company emailed in the last 60 days",
  duplicate: "Duplicate posting",
  other: "Missing details",
};
const STEP_ORDER: RemovalStep[] = ["seen", "location", "title", "industry", "seniority", "experience", "salary", "agency", "excluded", "contacted", "duplicate", "other"];

const VARIANT_LABEL: Record<QueryVariant, string> = {
  plain: "Standard search",
  remote: "Remote",
  wfh: "Work from home",
  startup: "Startups",
  immediate: "Immediate joiners",
  send_resume: "“Send resume” posts",
  walk_in: "Walk-ins",
};

/** The steps of the one-line summary, in order. */
export function funnelSteps(f: Funnel): { label: string; value: number }[] {
  return [
    { label: "Fetched", value: f.fetched },
    { label: "after filters", value: f.afterFilters },
    { label: "suitable", value: f.suitable },
    { label: "emails", value: f.drafted + f.autoSent },
    { label: "link-only", value: f.linkOnly },
  ];
}

/**
 * "Fetched 84 → after filters 12 → suitable 5 → emails 1 → link-only 4", or why
 * nothing was fetched. A span (it sits inside buttons and headings).
 */
export function FunnelSummary({ funnel, className }: { funnel: Funnel; className?: string }) {
  if (funnel.fetched === 0) {
    return (
      <span className={cx("block text-sm text-slate-700", className)} data-testid="funnel-summary">
        {funnel.note ?? "No jobs were fetched."}
      </span>
    );
  }
  const steps = funnelSteps(funnel);
  return (
    <span className={cx("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-slate-700", className)} data-testid="funnel-summary">
      {steps.map((s, i) => (
        <span key={s.label} className="whitespace-nowrap">
          {i > 0 && (
            <span className="mr-1.5 text-slate-500" aria-hidden>
              →
            </span>
          )}
          {s.label} <strong className="font-semibold text-slate-900">{s.value}</strong>
        </span>
      ))}
    </span>
  );
}

function Row({ label, value, muted }: { label: React.ReactNode; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className={cx("min-w-0 break-words", muted ? "text-slate-600" : "text-slate-800")}>{label}</dt>
      <dd className="shrink-0 font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h4>
      {children}
    </section>
  );
}

/** Tap to see where postings went at each step, per source, per search. */
export function FunnelDetails({ funnel }: { funnel: Funnel }) {
  const [open, setOpen] = useState(false);
  const [allQueries, setAllQueries] = useState(false);
  const id = useId();
  const removed = STEP_ORDER.filter((s) => (funnel.removed[s] ?? 0) > 0);
  const variants = (Object.keys(funnel.variants) as QueryVariant[]).filter((v) => (funnel.variants[v]?.fetched ?? 0) > 0);
  const queries = allQueries ? funnel.queries : funnel.queries.slice(0, 8);

  return (
    <div className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200" data-testid="funnel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100"
      >
        <Filter className="size-4 shrink-0 text-brand-700" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900">How this run went</span>
          <FunnelSummary funnel={funnel} />
        </span>
        <ChevronDown className={cx("size-5 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div id={id} className="grid gap-4 border-t border-slate-200 px-3 py-3 text-sm sm:grid-cols-2">
          <Section title="Fetched">
            <dl className="divide-y divide-slate-200">
              {funnel.sources.map((s) => (
                <div key={s.source} className="py-1">
                  <Row
                    label={
                      <>
                        {SOURCE_LABEL[s.source]}
                        {s.configured && (
                          <span className="text-slate-600">
                            {" "}
                            · {s.calls} {s.calls === 1 ? "search" : "searches"}
                            {s.cached ? `, ${s.cached} from cache` : ""}
                          </span>
                        )}
                      </>
                    }
                    value={s.configured ? s.fetched : "—"}
                  />
                  {s.note && <p className="text-xs text-amber-900">{s.note}</p>}
                  {s.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-800">
                      {e.status ? `HTTP ${e.status}: ` : ""}
                      {e.message}
                    </p>
                  ))}
                </div>
              ))}
              <Row label="Unique postings" value={funnel.fetched} />
            </dl>
          </Section>

          <Section title="Removed by filters">
            {removed.length === 0 ? (
              <p className="text-slate-600">Nothing removed.</p>
            ) : (
              <dl className="divide-y divide-slate-200">
                {removed.map((s) => (
                  <Row key={s} label={STEP_LABEL[s]} value={funnel.removed[s]} muted />
                ))}
                <Row label="Left after filters" value={funnel.afterFilters} />
              </dl>
            )}
          </Section>

          <Section title="Checked by AI">
            <dl className="divide-y divide-slate-200">
              <Row label="Screened" value={funnel.aiChecked} />
              <Row label="Suitable" value={funnel.suitable} />
              <Row label="With an application email" value={funnel.emailsFound} />
              {funnel.notChecked > 0 && <Row label="Left for the next run (daily AI limit)" value={funnel.notChecked} muted />}
            </dl>
          </Section>

          <Section title="Created">
            <dl className="divide-y divide-slate-200">
              <Row label="Drafts in your Gmail" value={funnel.drafted} />
              <Row label="Sending automatically" value={funnel.autoSent} />
              <Row label="Apply via link" value={funnel.linkOnly} />
            </dl>
          </Section>

          {variants.length > 0 && (
            <Section title="Which searches worked">
              <dl className="divide-y divide-slate-200">
                {variants.map((v) => (
                  <Row
                    key={v}
                    label={VARIANT_LABEL[v]}
                    value={
                      <>
                        {funnel.variants[v]!.fetched}
                        <span className="font-normal text-slate-600"> · {funnel.variants[v]!.emailApply} with email</span>
                      </>
                    }
                  />
                ))}
              </dl>
            </Section>
          )}

          {funnel.queries.length > 0 && (
            <Section title={`Searches (${funnel.queries.length})`}>
              <ul className="divide-y divide-slate-200">
                {queries.map((q, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="min-w-0 break-words text-slate-800">
                      <span className="text-slate-600">{SOURCE_LABEL[q.source]}:</span> {q.query}
                      {q.where ? ` · ${q.where}` : ""}
                      {q.fromCache && <span className="text-slate-600"> (cached)</span>}
                      {q.error && <span className="block text-xs text-red-800">{q.error}</span>}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{q.fetched}</span>
                  </li>
                ))}
              </ul>
              {funnel.queries.length > queries.length && (
                <button type="button" onClick={() => setAllQueries(true)} className="mt-1 min-h-11 font-semibold text-brand-700 underline-offset-2 hover:underline">
                  Show all {funnel.queries.length} searches
                </button>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
