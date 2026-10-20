import { extractText, getDocumentProxy } from "unpdf";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MIN_TEXT_CHARS = 200;

const PDF_MIMES = new Set(["application/pdf", "application/x-pdf"]);

/** MIME type + "%PDF-" magic bytes. Some Android pickers send octet-stream for .pdf files. */
export function looksLikePdf(buf: Buffer, mimetype: string, originalName: string): boolean {
  const mimeOk = PDF_MIMES.has(mimetype) || (mimetype === "application/octet-stream" && /\.pdf$/i.test(originalName));
  return mimeOk && buf.length > 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

export async function extractPdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text
    .replaceAll("\u0000", "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Keeps the user's file name readable but safe for headers and storage. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "resume";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
