export type SourceName = "adzuna" | "jsearch" | "mock";

/** Which search produced a posting (recorded per job and in the run funnel). */
export type QueryVariant = "plain" | "remote" | "wfh" | "startup" | "immediate" | "send_resume" | "walk_in";

/** One job posting, normalised from any source. */
export interface Job {
  /** stable id: "<source>:<source id>" */
  key: string;
  source: SourceName;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  description: string;
  /** Where to apply (for JSearch: a direct apply link when there is one). */
  url: string;
  postedAt: string | null;
  salaryMinLpa: number | null;
  salaryMaxLpa: number | null;
  employerWebsite?: string | null;
  variant?: QueryVariant;
}

/** A (role, location) pair to search for. location is "City, State" or "Remote (India)". */
export interface SearchPair {
  role: string;
  location: string;
}
