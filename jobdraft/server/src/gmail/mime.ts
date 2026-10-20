import crypto from "node:crypto";

export interface MimeAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MimeMessage {
  from: string;
  to: string;
  subject: string;
  body: string;
  /** Our own unique Message-ID, e.g. "<abc.123@gmail.com>". */
  messageId?: string;
  replyTo?: string;
  /** Follow-ups: Message-ID of the latest message in the thread. */
  inReplyTo?: string;
  /** Follow-ups: original Message-ID plus any later ones. */
  references?: string[];
  attachment?: MimeAttachment;
}

const CRLF = "\r\n";

/** Header values must never contain line breaks (header injection). */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** A globally unique Message-ID on the sender's domain. */
export function generateMessageId(fromAddress: string): string {
  const domain = /@([A-Za-z0-9.-]+)$/.exec(fromAddress.trim())?.[1] ?? "jobdraft.app";
  return `<jd.${Date.now().toString(36)}.${crypto.randomBytes(9).toString("hex")}@${domain}>`;
}

/** "Re: <subject>" exactly once, whatever the original looked like. */
export function replySubject(subject: string): string {
  return `Re: ${subject.replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, "").trim()}`;
}

/** RFC 2047 encoded-word, split so each line stays short. */
export function encodeHeaderWord(value: string): string {
  const safe = headerSafe(value);
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  const words: string[] = [];
  let chunk = "";
  for (const ch of safe) {
    // Keep each encoded word under ~45 source bytes (≈60 base64 chars), never splitting a character.
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join(`${CRLF} `);
}

function base64Lines(buf: Buffer): string {
  return (buf.toString("base64").match(/.{1,76}/g) ?? []).join(CRLF);
}

function quoteParam(value: string): string {
  return `"${value.replace(/["\\\r\n]/g, "_")}"`;
}

/** filename="ascii-fallback"; filename*=UTF-8''percent-encoded (RFC 2231). */
function filenameParams(name: string, param: "filename" | "name"): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  if (ascii === name) return `${param}=${quoteParam(name)}`;
  return `${param}=${quoteParam(ascii)}; ${param}*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

const TEXT_HEADERS = ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"];
const textBody = (body: string) => base64Lines(Buffer.from(body.replace(/\r?\n/g, CRLF), "utf8"));

/**
 * RFC 2822 message. With an attachment: multipart/mixed (text + PDF).
 * Without one (follow-ups): a single text/plain part.
 */
export function buildMimeMessage(msg: MimeMessage): string {
  const headers = [`From: ${headerSafe(msg.from)}`, `To: ${headerSafe(msg.to)}`];
  if (msg.replyTo) headers.push(`Reply-To: ${headerSafe(msg.replyTo)}`);
  headers.push(`Subject: ${encodeHeaderWord(msg.subject)}`);
  if (msg.messageId) headers.push(`Message-ID: ${headerSafe(msg.messageId)}`);
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${headerSafe(msg.inReplyTo)}`);
  if (msg.references?.length) headers.push(`References: ${msg.references.map(headerSafe).join(" ")}`);
  headers.push("MIME-Version: 1.0");

  if (!msg.attachment) {
    return `${[...headers, ...TEXT_HEADERS].join(CRLF)}${CRLF}${CRLF}${textBody(msg.body)}${CRLF}`;
  }

  const boundary = `jd_${crypto.randomBytes(12).toString("hex")}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const a = msg.attachment;
  const parts = [
    [`--${boundary}`, ...TEXT_HEADERS, "", textBody(msg.body)].join(CRLF),
    [
      `--${boundary}`,
      `Content-Type: ${a.contentType}; ${filenameParams(a.filename, "name")}`,
      `Content-Disposition: attachment; ${filenameParams(a.filename, "filename")}`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(a.content),
    ].join(CRLF),
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${parts.join(CRLF)}${CRLF}--${boundary}--${CRLF}`;
}

/** Gmail's API wants the raw message as base64url. */
export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}
