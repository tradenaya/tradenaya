import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseResumeText, setGeneratorForTests } from "../../src/ai/index.js";
import { mockResume } from "../../src/ai/mock.js";
import { resumeDataSchema } from "../../src/ai/schemas.js";
import { ensureSecrets, loadEnvFile } from "../../src/config/env.js";
import { decrypt, encrypt } from "../../src/lib/crypto.js";
import { computeExperienceYears, parseResumeDate } from "../../src/resume/experience.js";
import { looksLikePdf } from "../../src/resume/pdf.js";
import { RESUME_LINES } from "../helpers.js";

describe("AES-256-GCM", () => {
  const key = crypto.randomBytes(32);
  it("round-trips", () => {
    const token = "1//0g-refresh-token-ÄÖ";
    const enc = encrypt(token, key);
    expect(enc).not.toContain(token);
    expect(decrypt(enc, key)).toBe(token);
  });
  it("uses a fresh IV every time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });
  it("detects tampering and wrong keys", () => {
    const enc = encrypt("secret", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), key)).toThrow();
    expect(() => decrypt(enc, crypto.randomBytes(32))).toThrow();
  });
});

describe("experience years", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  it("parses common date formats", () => {
    expect(parseResumeDate("2021-03", now)).toBe(2021 * 12 + 2);
    expect(parseResumeDate("03/2021", now)).toBe(2021 * 12 + 2);
    expect(parseResumeDate("Mar 2021", now)).toBe(2021 * 12 + 2);
    expect(parseResumeDate("September 2019", now)).toBe(2019 * 12 + 8);
    expect(parseResumeDate("Present", now)).toBe(2026 * 12 + 9);
    expect(parseResumeDate("sometime", now)).toBeNull();
  });
  it("sums roles, merges overlaps, skips internships", () => {
    const years = computeExperienceYears(
      [
        { title: "Software Engineer", start: "2021-03", end: "Present" },
        { title: "Freelance Developer", start: "2021-01", end: "2021-12" }, // overlaps
        { title: "Associate Engineer", start: "2019-07", end: "2021-02" },
        { title: "Summer Intern", start: "2018-05", end: "2018-07" },
      ],
      now,
    );
    // Jul 2019 → Oct 2026 inclusive = 88 months
    expect(years).toBe(7.3);
  });
  it("treats a missing end date as present only for the latest role", () => {
    expect(computeExperienceYears([{ title: "Dev", start: "2025-10", end: "" }], now)).toBe(1.1);
    expect(computeExperienceYears([{ title: "A", start: "2025-10", end: "2026-09" }, { title: "B", start: "2020-01", end: "" }], now)).toBe(1);
  });
  it("counts a role marked is_current up to today", () => {
    expect(computeExperienceYears([{ title: "Dev", start: "2025-10", end: "", is_current: true }, { title: "Old", start: "2020-01", end: "" }], now)).toBe(1.1);
    expect(computeExperienceYears([{ title: "Dev", start: "2024-10", end: "2025-01", is_current: true }], now)).toBe(2.1);
  });
  it("handles no roles", () => {
    expect(computeExperienceYears([], now)).toBe(0);
  });
});

describe("resume JSON validation", () => {
  afterEach(() => setGeneratorForTests(null));
  const valid = mockResume(RESUME_LINES.join("\n"));

  it("mock parser output matches the schema", () => {
    expect(resumeDataSchema.safeParse(valid).success).toBe(true);
    expect(valid.full_name).toBe("Priya Sharma");
    expect(valid.roles).toHaveLength(2);
    expect(valid.roles[0]).toMatchObject({ title: "Software Engineer", company: "Acme Retail Tech", start: "2021-03", end: "Present" });
  });

  it("rejects missing fields and wrong types", () => {
    expect(resumeDataSchema.safeParse({ ...valid, full_name: "" }).success).toBe(false);
    expect(resumeDataSchema.safeParse({ ...valid, roles: "many" }).success).toBe(false);
    expect(resumeDataSchema.safeParse({ ...valid, suggested_target_roles: [] }).success).toBe(false);
  });

  it("retries once on invalid output, then succeeds", async () => {
    let calls = 0;
    setGeneratorForTests(async () => (++calls === 1 ? { nonsense: true } : valid));
    const data = await parseResumeText("text", null);
    expect(calls).toBe(2);
    expect(data.full_name).toBe("Priya Sharma");
  });

  it("fails clearly after two invalid outputs", async () => {
    let calls = 0;
    setGeneratorForTests(async () => {
      calls++;
      return { full_name: 42 };
    });
    await expect(parseResumeText("text", null)).rejects.toThrow(/unexpected format/);
    expect(calls).toBe(2);
  });

  it("dedupes and caps suggested roles at 8", async () => {
    setGeneratorForTests(async () => ({ ...valid, suggested_target_roles: ["A1", "a1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9"] }));
    expect((await parseResumeText("x", null)).suggested_target_roles).toEqual(["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"]);
  });
});

describe("PDF checks", () => {
  it("requires PDF MIME type and magic bytes", () => {
    const pdf = Buffer.from("%PDF-1.7\n...");
    expect(looksLikePdf(pdf, "application/pdf", "cv.pdf")).toBe(true);
    expect(looksLikePdf(pdf, "application/octet-stream", "cv.pdf")).toBe(true);
    expect(looksLikePdf(pdf, "image/png", "cv.pdf")).toBe(false);
    expect(looksLikePdf(Buffer.from("PK\u0003\u0004 docx"), "application/pdf", "cv.pdf")).toBe(false);
  });
});

describe("env file loading", () => {
  it("uses the last value when a key appears twice, and never overrides real env vars", () => {
    const file = path.join(os.tmpdir(), `jd-dup-${Date.now()}.env`);
    fs.writeFileSync(file, "JD_TEST_DUP=\nJD_TEST_KEEP=from-file\n# later lines\nJD_TEST_DUP=filled\n");
    process.env.JD_TEST_KEEP = "from-env";
    try {
      loadEnvFile(file);
      expect(process.env.JD_TEST_DUP).toBe("filled");
      expect(process.env.JD_TEST_KEEP).toBe("from-env");
    } finally {
      delete process.env.JD_TEST_DUP;
      delete process.env.JD_TEST_KEEP;
      fs.rmSync(file, { force: true });
    }
  });
});

describe("secret generation", () => {
  it("appends missing secrets to the env file without logging values", () => {
    const file = path.join(os.tmpdir(), `jd-env-${Date.now()}.env`);
    fs.writeFileSync(file, "PORT=5055");
    const saved = { j: process.env.JWT_SECRET, e: process.env.ENCRYPTION_KEY };
    delete process.env.JWT_SECRET;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(ensureSecrets(file)).toEqual(["JWT_SECRET", "ENCRYPTION_KEY"]);
      const content = fs.readFileSync(file, "utf8");
      expect(content).toMatch(/^PORT=5055\n/);
      expect(content).toMatch(/\nENCRYPTION_KEY=[0-9a-f]{64}\n/);
      expect(ensureSecrets(file)).toEqual([]);
    } finally {
      process.env.JWT_SECRET = saved.j;
      process.env.ENCRYPTION_KEY = saved.e;
      fs.rmSync(file, { force: true });
    }
  });
});
