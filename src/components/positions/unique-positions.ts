/**
 * One entry per exchange position. Duplicate positions (same position_id, or
 * same symbol + side when the id is missing) would otherwise render as several
 * cards and, sharing a React key, could linger across refreshes.
 */
export function uniquePositions<T extends { position_id?: string | null; symbol?: string | null; position_side?: string | null }>(
  positions: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of positions) {
    const key = p.position_id ? `id:${p.position_id}` : `sym:${String(p.symbol ?? "").toUpperCase()}:${p.position_side ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
