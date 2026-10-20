/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LEGAL_SUFFIXES = /\b(private limited|pvt\.? ltd\.?|pvt|ltd\.?|limited|llp|inc\.?|corp\.?|corporation|co\.?|plc|gmbh|india)\b/g;

/** Key used to recognise the same employer across postings and runs. */
export function companyKey(name: string): string {
  const key = normalize(name).replace(/\./g, " ").replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
  return (key || normalize(name)).slice(0, 190);
}

/** Company name without legal suffixes, for "does the email mention the company" checks. */
export function companyCoreName(name: string): string {
  const core = name.replace(/\b(private limited|pvt\.?\s*ltd\.?|ltd\.?|limited|llp|inc\.?)\s*$/i, "").replace(/[,.\s]+$/, "").trim();
  return core || name.trim();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
