import crypto from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CoinSwitch futures requires `client_order_id` to be a UUID. This builds a
 * deterministic UUID (RFC 4122 v5 shape) from an arbitrary seed so callers can
 * recompute the id later (e.g. orphan-order reconciliation) without persisting it.
 */
export function clientOrderId(seed: string): string {
  const hash = crypto.createHash("sha1").update(seed).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
