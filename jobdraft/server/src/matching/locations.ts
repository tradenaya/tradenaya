// Old/alternate names used by job boards for the same city. Generated from the
// same list the client's location picker uses (client/src/data/indian-cities.json).
import generatedAliases from "../data/city-aliases.json" with { type: "json" };
import { normalize } from "./text.js";

export const REMOTE_LOCATION = "Remote (India)";

const DELHI = ["delhi", "new delhi", "delhi ncr", "ncr"];
// Old names plus the neighbouring areas postings are filed under (also searched, see jobs/queries.ts).
const BENGALURU = ["bengaluru", "bangalore", "blr"];
const MUMBAI = ["mumbai", "bombay", "navi mumbai", "thane"];
const PUNE = ["pune", "poona", "pimpri chinchwad", "pimpri", "chinchwad"];
const HYDERABAD = ["hyderabad", "secunderabad"];
const ALIASES: Record<string, string[]> = {
  ...(generatedAliases as Record<string, string[]>),
  delhi: DELHI,
  "new delhi": DELHI,
  bengaluru: BENGALURU,
  bangalore: BENGALURU,
  mumbai: MUMBAI,
  bombay: MUMBAI,
  pune: PUNE,
  poona: PUNE,
  hyderabad: HYDERABAD,
};

/** "Bengaluru, Karnataka" → "bengaluru" */
export function cityOf(location: string): string {
  return normalize(location.split(",")[0] ?? location);
}

export function isRemoteLocation(location: string): boolean {
  return normalize(location).startsWith("remote");
}

export function cityAliases(location: string): string[] {
  const city = cityOf(location);
  return ALIASES[city] ?? [city];
}

const REMOTE_RE = /\b(remote|work from home|wfh|work-from-home|anywhere in india)\b/i;

export interface LocatedJob {
  location: string;
  isRemote: boolean;
  title: string;
}

/** True if the job is in one of the user's cities, or remote when the user picked remote. */
export function locationMatches(job: LocatedJob, userLocations: string[]): boolean {
  const jobLoc = ` ${normalize(job.location)} `;
  const remote = job.isRemote || REMOTE_RE.test(job.location) || REMOTE_RE.test(job.title);
  for (const loc of userLocations) {
    if (isRemoteLocation(loc)) {
      if (remote) return true;
      continue;
    }
    for (const alias of cityAliases(loc)) {
      if (jobLoc.includes(` ${alias} `)) return true;
    }
  }
  return false;
}
