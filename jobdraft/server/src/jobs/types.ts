/** One job posting, normalised from any source. */
export interface Job {
  /** stable id: "<source>:<source id>" */
  key: string;
  source: "adzuna" | "jsearch" | "mock";
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  description: string;
  url: string;
  postedAt: string | null;
  salaryMinLpa: number | null;
  salaryMaxLpa: number | null;
}

/** A (role, location) pair to search for. location is "City, State" or "Remote (India)". */
export interface SearchPair {
  role: string;
  location: string;
}

export interface SourceResult {
  jobs: Job[];
  errors: string[];
  calls: number;
}
