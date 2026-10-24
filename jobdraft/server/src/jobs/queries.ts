// What to search for. One user's (role, location) pairs become concrete source
// queries: Adzuna per (role, area) with nearby/alternate city names, JSearch
// per (role, city, variant) with variants that surface email-apply postings.
import { isRemoteLocation } from "../matching/locations.js";
import { normalize } from "../matching/text.js";
import type { QueryVariant, SearchPair } from "./types.js";

/** Names job boards file postings under for the same city, each searched separately. */
const SEARCH_AREAS: Record<string, string[]> = {
  bengaluru: ["Bengaluru", "Bangalore"],
  bangalore: ["Bengaluru", "Bangalore"],
  mumbai: ["Mumbai", "Navi Mumbai", "Thane"],
  bombay: ["Mumbai", "Navi Mumbai", "Thane"],
  pune: ["Pune", "Pimpri-Chinchwad"],
  hyderabad: ["Hyderabad", "Secunderabad"],
  delhi: ["Delhi", "New Delhi"],
  "new delhi": ["Delhi", "New Delhi"],
  gurugram: ["Gurugram", "Gurgaon"],
  gurgaon: ["Gurugram", "Gurgaon"],
  chennai: ["Chennai"],
  kolkata: ["Kolkata"],
};

/** "Pune, Maharashtra" → "Pune" (as the user typed it). */
export function displayCity(location: string): string {
  return (location.split(",")[0] ?? location).trim();
}

/** The area names to search for one location (the city itself first). */
export function searchAreas(location: string): string[] {
  return SEARCH_AREAS[normalize(displayCity(location))] ?? [displayCity(location)];
}

export interface AdzunaQuery {
  role: string;
  /** The user's location this query serves. */
  location: string;
  /**
   * Adzuna `title_only`: every word of the role must be in the posting title.
   * Measured (Product Manager, Pune, 7 days): `what` returned 9 relevant of 50
   * (most were "Relationship Manager", "Data Engineer"…); `title_only`
   * returned all 14 relevant postings in one call.
   */
  titleOnly: string;
  /** Adzuna `what` keywords: "remote" / "work from home" for remote searches. */
  what?: string;
  /** City/area for `where`; absent for remote searches. */
  where?: string;
  variant: QueryVariant;
  /** Remote searches keep only postings that say remote / work from home. */
  remoteOnly: boolean;
}

/** The search as one line, for the funnel and the cache key: `Product Manager + "remote"`. */
export const adzunaLabel = (q: Pick<AdzunaQuery, "titleOnly" | "what">) => (q.what ? `${q.titleOnly} + "${q.what}"` : q.titleOnly);

/** One Adzuna query per (role, area); remote = two keyword searches without `where`. Deduplicated. */
export function adzunaQueries(pairs: SearchPair[]): AdzunaQuery[] {
  const out = new Map<string, AdzunaQuery>();
  for (const { role, location } of pairs) {
    const r = role.trim();
    const qs: AdzunaQuery[] = isRemoteLocation(location)
      ? [
          { role: r, location, titleOnly: r, what: "remote", variant: "remote", remoteOnly: true },
          { role: r, location, titleOnly: r, what: "work from home", variant: "wfh", remoteOnly: true },
        ]
      : searchAreas(location).map((where) => ({ role: r, location, titleOnly: r, where, variant: "plain" as const, remoteOnly: false }));
    for (const q of qs) {
      const key = `${normalize(adzunaLabel(q))}|${normalize(q.where ?? "")}`;
      if (!out.has(key)) out.set(key, q);
    }
  }
  return [...out.values()];
}

/** JSearch query variants, in priority order (plain first). Small employers post email-apply jobs. */
export const JSEARCH_VARIANTS: QueryVariant[] = ["plain", "startup", "immediate", "send_resume", "walk_in"];

/** The JSearch `query` text for one (role, location, variant), or null when the variant doesn't apply. */
export function jsearchQueryText(role: string, location: string, variant: QueryVariant): string | null {
  const r = role.trim();
  if (isRemoteLocation(location)) {
    switch (variant) {
      case "plain":
        return `${r} remote India`;
      case "startup":
        return `${r} startup remote India`;
      case "immediate":
        return `${r} hiring immediate joiner remote India`;
      case "send_resume":
        return `${r} send resume remote India`;
      default:
        return null; // a walk-in can't be remote
    }
  }
  const city = displayCity(location);
  switch (variant) {
    case "plain":
      return `${r} in ${city}, India`;
    case "startup":
      return `${r} startup in ${city}, India`;
    case "immediate":
      return `${r} hiring immediate joiner ${city}`;
    case "send_resume":
      return `${r} send resume ${city}`;
    case "walk_in":
      return `${r} walk-in ${city}`;
    default:
      return null;
  }
}

export interface JSearchQuery {
  role: string;
  location: string;
  variant: QueryVariant;
  query: string;
  /** Rotation/cache key: the normalised query text. */
  comboKey: string;
}

/**
 * Every (role, location, variant) JSearch could run for these pairs, plain
 * variants of every pair first, then startup, etc., so the rotation covers the
 * most useful searches first. Deduplicated.
 */
export function jsearchCombos(pairs: SearchPair[]): JSearchQuery[] {
  const out = new Map<string, JSearchQuery>();
  for (const variant of JSEARCH_VARIANTS) {
    for (const { role, location } of pairs) {
      const query = jsearchQueryText(role, location, variant);
      if (!query) continue;
      const comboKey = normalize(query).slice(0, 190);
      if (!out.has(comboKey)) out.set(comboKey, { role: role.trim(), location, variant, query, comboKey });
    }
  }
  return [...out.values()];
}
