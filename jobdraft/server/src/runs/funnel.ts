// The run funnel: what one run fetched, how many postings each filter step
// removed, and what was checked and created. Stored as JSON on the run and
// shown in History, so "why did nothing happen?" always has an answer.
import type { QueryVariant, SourceName } from "../jobs/types.js";

export type RemovalStep =
  | "excluded"
  | "seen"
  | "location"
  | "title"
  | "industry"
  | "seniority"
  | "experience"
  | "salary"
  | "agency"
  | "contacted"
  | "duplicate"
  | "other";

export interface SourceReport {
  source: SourceName;
  configured: boolean;
  /** API calls made by this run. */
  calls: number;
  /** Searches answered from the shared cache. */
  cached: number;
  /** Postings returned (after source-level filters such as India-only / remote-only). */
  fetched: number;
  errors: { status?: number; message: string }[];
  /** e.g. "Daily limit reached", "Not configured", "Quota exhausted". */
  note?: string;
}

export interface QueryReport {
  source: SourceName;
  variant: QueryVariant;
  role: string;
  location: string;
  /** The search text (Adzuna `what`, JSearch `query`). */
  query: string;
  where?: string;
  fetched: number;
  fromCache: boolean;
  error?: string;
}

export interface Funnel {
  v: 1;
  sources: SourceReport[];
  queries: QueryReport[];
  /** Unique postings across all sources. */
  fetched: number;
  removed: Partial<Record<RemovalStep, number>>;
  afterFilters: number;
  /** Postings the AI screened for suitability. */
  aiChecked: number;
  suitable: number;
  /** Suitable postings that state an application email. */
  emailsFound: number;
  drafted: number;
  autoSent: number;
  linkOnly: number;
  /** Passed the filters but over this run's AI cap; left for the next run. */
  notChecked: number;
  /** Per search variant: postings fetched and how many had an application email. */
  variants: Partial<Record<QueryVariant, { fetched: number; emailApply: number }>>;
  /** Why nothing was fetched, when that happens. */
  note?: string;
}

export const MAX_QUERY_REPORTS = 80;

export function emptyFunnel(): Funnel {
  return {
    v: 1,
    sources: [],
    queries: [],
    fetched: 0,
    removed: {},
    afterFilters: 0,
    aiChecked: 0,
    suitable: 0,
    emailsFound: 0,
    drafted: 0,
    autoSent: 0,
    linkOnly: 0,
    notChecked: 0,
    variants: {},
  };
}

const SOURCE_LABEL: Record<SourceName, string> = { adzuna: "Adzuna", jsearch: "JSearch", mock: "Demo source" };

/** One line per source explaining a run that fetched nothing, e.g. "Adzuna error 401 · JSearch quota exhausted". */
export function zeroFetchReason(sources: SourceReport[]): string {
  if (!sources.some((s) => s.configured)) return "No job source is configured on the server (Adzuna or JSearch keys).";
  const parts = sources.map((s) => {
    const name = SOURCE_LABEL[s.source];
    if (!s.configured) return `${name} not configured`;
    if (s.note) return `${name}: ${s.note}`;
    const err = s.errors[0];
    if (err) return `${name} error${err.status ? ` ${err.status}` : ""}: ${err.message}`;
    return `${name} returned 0 jobs`;
  });
  return `No jobs were fetched. ${parts.join(" · ")}.`;
}

/** Filter reasons (matching/filters.ts) grouped into funnel steps. */
export function stepOf(reason: string): RemovalStep {
  if (reason === "already seen") return "seen";
  if (reason === "location") return "location";
  if (reason === "title") return "title";
  if (reason.startsWith("industry")) return "industry";
  if (reason === "experience required too high") return "experience";
  if (reason === "internship" || reason.startsWith("too senior") || reason === "too junior") return "seniority";
  if (reason === "salary below expectation") return "salary";
  if (reason === "staffing agency") return "agency";
  if (reason === "company contacted recently") return "contacted";
  if (reason === "duplicate") return "duplicate";
  return "other";
}
