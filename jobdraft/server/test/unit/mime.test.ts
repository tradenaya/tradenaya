import { describe, expect, it } from "vitest";
import { buildMimeMessage, encodeHeaderWord, generateMessageId, replySubject, toBase64Url } from "../../src/gmail/mime.js";

/** Tiny RFC 2822 / MIME parser, enough to read our own output back. */
function parseHeaders(block: string) {
  const unfolded = block.replace(/\r\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function decodeWords(value: string) {
  return value.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_m, b64: string) => Buffer.from(b64, "base64").toString("utf8"));
}

function parse(raw: string) {
  const sep = raw.indexOf("\r\n\r\n");
  const headers = parseHeaders(raw.slice(0, sep));
  const boundary = /boundary="([^"]+)"/.exec(headers["content-type"]!)![1]!;
  const body = raw.slice(sep + 4);
  const parts = body
    .split(`--${boundary}`)
    .slice(1)
    .filter((p) => !p.startsWith("--"))
    .map((p) => {
      const s = p.replace(/^\r\n/, "");
      const i = s.indexOf("\r\n\r\n");
      return { headers: parseHeaders(s.slice(0, i)), content: Buffer.from(s.slice(i + 4).replace(/\r\n/g, ""), "base64") };
    });
  return { headers, parts, closed: body.trimEnd().endsWith(`--${boundary}--`) };
}

describe("MIME builder", () => {
  const pdf = Buffer.from("%PDF-1.4 fake resume bytes ÿ", "latin1");
  const raw = buildMimeMessage({
    from: "priya@gmail.com",
    to: "careers@nimbus.in",
    subject: "Application for Software Engineer – Priya Sharma ✓",
    body: "Dear Hiring Team,\n\nNamaste — I'd like to apply.\n\nRegards,\nPriya",
    attachment: { filename: "Priya Sharma Resume.pdf", contentType: "application/pdf", content: pdf },
  });

  it("writes the headers with a UTF-8 encoded subject", () => {
    const { headers } = parse(raw);
    expect(headers.from).toBe("priya@gmail.com");
    expect(headers.to).toBe("careers@nimbus.in");
    expect(headers["mime-version"]).toBe("1.0");
    expect(headers["content-type"]).toMatch(/^multipart\/mixed; boundary="/);
    expect(headers.subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeWords(headers.subject!)).toBe("Application for Software Engineer – Priya Sharma ✓");
  });

  it("has a UTF-8 text/plain body and the PDF attachment", () => {
    const { parts, closed } = parse(raw);
    expect(closed).toBe(true);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.headers["content-type"]).toBe('text/plain; charset="UTF-8"');
    expect(parts[0]!.content.toString("utf8")).toBe("Dear Hiring Team,\r\n\r\nNamaste — I'd like to apply.\r\n\r\nRegards,\r\nPriya");
    expect(parts[1]!.headers["content-type"]).toBe('application/pdf; name="Priya Sharma Resume.pdf"');
    expect(parts[1]!.headers["content-disposition"]).toBe('attachment; filename="Priya Sharma Resume.pdf"');
    expect(parts[1]!.content.equals(pdf)).toBe(true);
  });

  it("uses CRLF line endings and short lines", () => {
    expect(raw.replace(/\r\n/g, "")).not.toMatch(/\n/);
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });

  it("encodes non-ASCII file names (RFC 2231)", () => {
    const r = buildMimeMessage({ from: "a@b.in", to: "c@d.in", subject: "Hi", body: "x", attachment: { filename: "रिज़्यूमे.pdf", contentType: "application/pdf", content: pdf } });
    expect(r).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(/filename\*=UTF-8''([^\r\n;]+)/.exec(r)![1]!)).toBe("रिज़्यूमे.pdf");
  });

  it("blocks header injection", () => {
    const r = buildMimeMessage({ from: "a@b.in", to: "c@d.in\r\nBcc: evil@x.com", subject: "Hi\r\nBcc: evil@x.com", body: "x" });
    expect(r).not.toMatch(/\r\nBcc:/);
  });

  it("splits long UTF-8 subjects into several encoded words without breaking characters", () => {
    const subject = "आवेदन ".repeat(20).trim();
    const encoded = encodeHeaderWord(subject);
    expect(encoded.split("\r\n ").length).toBeGreaterThan(1);
    expect(decodeWords(encoded)).toBe(subject);
  });

  it("produces base64url for the Gmail API", () => {
    const b = toBase64Url(raw);
    expect(b).not.toMatch(/[+/=]/);
    expect(Buffer.from(b, "base64url").toString("utf8")).toBe(raw);
  });
});

describe("Message-ID, Reply-To and follow-up replies", () => {
  it("adds a unique Message-ID on the sender's domain and Reply-To", () => {
    const id = generateMessageId("priya@gmail.com");
    expect(id).toMatch(/^<jd\.[a-z0-9]+\.[0-9a-f]{18}@gmail\.com>$/);
    expect(generateMessageId("priya@gmail.com")).not.toBe(id);
    const raw = buildMimeMessage({ from: "priya@gmail.com", to: "hr@x.in", replyTo: "priya@gmail.com", subject: "Hi", body: "x", messageId: id, attachment: { filename: "cv.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-") } });
    const { headers } = parse(raw);
    expect(headers["message-id"]).toBe(id);
    expect(headers["reply-to"]).toBe("priya@gmail.com");
  });

  it("builds a follow-up as a plain reply in the thread: In-Reply-To, References, one 'Re:', no attachment", () => {
    const original = "<jd.orig.1@gmail.com>";
    const fu1 = "<jd.fu1.2@gmail.com>";
    const raw = buildMimeMessage({
      from: "priya@gmail.com",
      to: "careers@nimbus.in",
      replyTo: "priya@gmail.com",
      subject: replySubject("Re: RE:  Application for Software Engineer – Priya"),
      body: "Dear Hiring Team,\n\nFollowing up.",
      messageId: "<jd.fu2.3@gmail.com>",
      inReplyTo: fu1,
      references: [original, fu1],
    });
    const sep = raw.indexOf("\r\n\r\n");
    const headers: Record<string, string> = Object.fromEntries(
      raw
        .slice(0, sep)
        .replace(/\r\n[ \t]+/g, " ")
        .split("\r\n")
        .map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
    );
    expect(decodeWords(headers.subject!)).toBe("Re: Application for Software Engineer – Priya");
    expect(decodeWords(headers.subject!).match(/Re:/gi)).toHaveLength(1);
    expect(headers["in-reply-to"]).toBe(fu1);
    expect(headers.references).toBe(`${original} ${fu1}`);
    expect(headers["content-type"]).toBe('text/plain; charset="UTF-8"');
    expect(raw).not.toMatch(/multipart|attachment|filename/i);
    expect(Buffer.from(raw.slice(sep + 4).replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Dear Hiring Team,\r\n\r\nFollowing up.");
  });

  it("never doubles Re:", () => {
    expect(replySubject("Application")).toBe("Re: Application");
    expect(replySubject("Re: Application")).toBe("Re: Application");
    expect(replySubject("RE: re: Fwd: Application")).toBe("Re: Application");
  });
});
