import { describe, expect, it } from "vitest";
import { extractEmails, isDisallowedEmail, isValidEmailFormat, verifyApplicationEmail } from "../../src/matching/emails.js";

const posting = "We are hiring! Send your CV to Careers@Nimbus-Analytics.in or ping hr.team@nimbus.co.in. Don't write to noreply@nimbus.in.";

describe("email extraction", () => {
  it("finds every address, lowercased and unique", () => {
    expect(extractEmails(`${posting} Again: careers@nimbus-analytics.in.`)).toEqual(["careers@nimbus-analytics.in", "hr.team@nimbus.co.in", "noreply@nimbus.in"]);
  });
  it("validates format", () => {
    expect(isValidEmailFormat("a.b@c.io")).toBe(true);
    expect(isValidEmailFormat("a..b@c.io")).toBe(false);
    expect(isValidEmailFormat("no-at-sign.com")).toBe(false);
    expect(isValidEmailFormat("x@y")).toBe(false);
  });
  it.each(["noreply@x.com", "no-reply@x.com", "donotreply@x.in", "jobs@example.com", "hr@test.com", "test@company.in", "hr@mail.example"])("blocks %s", (e) => {
    expect(isDisallowedEmail(e)).toBe(true);
  });
  it("allows a normal hiring address", () => {
    expect(isDisallowedEmail("careers@nimbus.in")).toBe(false);
  });
});

describe("verbatim check", () => {
  it("accepts an address that appears in the posting (case-insensitive)", () => {
    expect(verifyApplicationEmail("careers@nimbus-analytics.in", posting)).toEqual({ ok: true, email: "careers@nimbus-analytics.in" });
    expect(verifyApplicationEmail("CAREERS@NIMBUS-ANALYTICS.IN", posting).ok).toBe(true);
  });
  it("rejects an address the model invented", () => {
    expect(verifyApplicationEmail("jobs@nimbus-analytics.in", posting)).toEqual({ ok: false, reason: "email not found verbatim in posting" });
  });
  it("rejects noreply even when present", () => {
    expect(verifyApplicationEmail("noreply@nimbus.in", posting)).toMatchObject({ ok: false, reason: expect.stringMatching(/noreply/) });
  });
  it("rejects empty and malformed", () => {
    expect(verifyApplicationEmail("", posting).ok).toBe(false);
    expect(verifyApplicationEmail("careers at nimbus", posting).ok).toBe(false);
  });
});
