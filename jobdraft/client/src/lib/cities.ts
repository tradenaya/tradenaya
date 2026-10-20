import cities from "@/data/indian-cities.json";

export const REMOTE_OPTION = "Remote (India)";

interface City {
  name: string;
  state: string;
  aliases?: string[];
}

export interface LocationOption {
  value: string; // stored value: "Bengaluru, Karnataka" or "Remote (India)"
  label: string;
  hint: string;
}

/** Lowercase and strip accents, so "bengalūru" and "Bengaluru" match. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const OPTIONS: (LocationOption & { keys: string[]; aliasKeys: string[]; stateKey: string; rank: number })[] = [
  { value: REMOTE_OPTION, label: REMOTE_OPTION, hint: "Work from home", keys: ["remote india", "remote", "work from home", "wfh"], aliasKeys: [], stateKey: "", rank: -1 },
  ...(cities as City[]).map((c, i) => ({
    value: `${c.name}, ${c.state}`,
    label: c.name,
    hint: c.aliases?.length ? `${c.state} · ${c.aliases[0]}` : c.state,
    keys: [fold(c.name)],
    aliasKeys: (c.aliases ?? []).map(fold),
    stateKey: fold(c.state),
    rank: i,
  })),
];

/**
 * Prefix matches first (name, then old names like "Bangalore"), then word
 * prefixes, then substrings, then state. Ties keep population order.
 */
export function searchLocations(query: string, exclude: string[] = [], limit = 8): LocationOption[] {
  const q = fold(query);
  const excluded = new Set(exclude);
  if (!q) return OPTIONS.filter((o) => !excluded.has(o.value)).slice(0, limit).map(strip);
  const scored: { o: (typeof OPTIONS)[number]; score: number }[] = [];
  for (const o of OPTIONS) {
    if (excluded.has(o.value)) continue;
    let score = -1;
    if (o.keys.some((k) => k.startsWith(q))) score = 0;
    else if (o.aliasKeys.some((k) => k.startsWith(q))) score = 1;
    else if ([...o.keys, ...o.aliasKeys].some((k) => k.split(/[\s-]/).some((w) => w.startsWith(q)))) score = 2;
    else if ([...o.keys, ...o.aliasKeys].some((k) => k.includes(q))) score = 3;
    else if (o.stateKey.startsWith(q)) score = 4;
    if (score >= 0) scored.push({ o, score });
  }
  scored.sort((a, b) => a.score - b.score || a.o.rank - b.o.rank);
  return scored.slice(0, limit).map((s) => strip(s.o));
}

function strip(o: LocationOption): LocationOption {
  return { value: o.value, label: o.label, hint: o.hint };
}

export function locationLabel(value: string): string {
  return value === REMOTE_OPTION ? value : value.split(",")[0]!;
}
