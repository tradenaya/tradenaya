import { describe, expect, it } from "vitest";
import { mockResume } from "../../src/ai/mock.js";
import type { JobCheck } from "../../src/ai/schemas.js";
import type { Job } from "../../src/jobs/types.js";
import { exclusionKey } from "../../src/matching/exclusions.js";
import { followUpMode } from "../../src/runs/followups.js";
import { buildSignature, classifyAutoSend, decideDraft, humanize, layoutEmail, prepareFollowUpBody, SEND_MODES, styleProblem, templateFollowUp } from "../../src/runs/safety.js";
import { wordCount } from "../../src/matching/text.js";
import { RESUME_LINES } from "../helpers.js";

const resume = mockResume(RESUME_LINES.join("\n"));

const job: Job = {
  key: "mock:1",
  source: "mock",
  title: "Software Engineer",
  company: "Nimbus Analytics Pvt Ltd",
  location: "Bengaluru, India",
  isRemote: false,
  description: "Interested candidates can send their CV to careers@nimbusanalytics.in.",
  url: "https://nimbusanalytics.in/jobs/1",
  postedAt: null,
  salaryMinLpa: null,
  salaryMaxLpa: null,
};

const goodBody =
  "Dear Hiring Team,\n\nI am writing to apply for the Software Engineer role at Nimbus Analytics. " +
  "I currently work as a Software Engineer at Acme Retail Tech, where I build React and Node.js features for a checkout used by two million shoppers. ".repeat(3) +
  "Before that I developed REST APIs with Node.js and MySQL at Blue Ocean Systems. I enjoy shipping carefully tested features with product and design colleagues. " +
  "I would welcome the chance to discuss how I can help Nimbus Analytics.\n\nThank you for your consideration.";

const check = (over: Partial<JobCheck> = {}): JobCheck => ({
  suitable: true,
  reason: "fits",
  confidence: 92,
  real_employer_name: "",
  scam_or_spam_signals: false,
  is_staffing_agency: false,
  application_email: "careers@nimbusanalytics.in",
  contact_name: "",
  subject: "Application for Software Engineer – Priya Sharma",
  body: goodBody,
  ...over,
});

const excluded = ["Acme Retail Tech", "Blue Ocean Systems"].map((n) => ({ company_name: n, company_key: exclusionKey(n) }));
const decide = (c: JobCheck, j: Job = job) => decideDraft({ check: c, job: j, resume, expectedSalaryLpa: 14, experienceYears: 7.3, excluded });

describe("draft safety checks", () => {
  it("drafts a clean, verified email and appends the signature in code", () => {
    const d = decide(check({ body: `${goodBody}\n\nBest regards,\nSomeone Else\n+1 555 0100` }));
    expect(d.kind).toBe("draft");
    if (d.kind !== "draft") return;
    expect(d.to).toBe("careers@nimbusanalytics.in");
    expect(d.body).not.toContain("Someone Else");
    expect(d.body.endsWith(buildSignature(resume))).toBe(true);
    expect(buildSignature(resume)).toBe("Regards,\nPriya Sharma\n+91 98765 43210\npriya.sharma@gmail.com\nhttps://www.linkedin.com/in/priyasharma");
  });

  it("skips unsuitable, scam and agency postings", () => {
    expect(decide(check({ suitable: false })).kind).toBe("skip");
    expect(decide(check({ scam_or_spam_signals: true })).kind).toBe("skip");
    expect(decide(check({ is_staffing_agency: true })).kind).toBe("skip");
  });

  it("downgrades to link-only when the email is not verbatim in the posting", () => {
    expect(decide(check({ application_email: "hr@nimbusanalytics.in" }))).toEqual({ kind: "link_only", reason: "email not found verbatim in posting" });
    expect(decide(check({ application_email: "" })).kind).toBe("link_only");
  });

  it("rejects noreply addresses even if present in the posting", () => {
    const j = { ...job, description: "Apply: noreply@nimbusanalytics.in" };
    expect(decide(check({ application_email: "noreply@nimbusanalytics.in" }), j)).toMatchObject({ kind: "link_only" });
  });

  it("rejects placeholder brackets, missing company and missing role", () => {
    expect(decide(check({ body: goodBody.replace("Acme Retail Tech", "[Company]") }))).toMatchObject({ kind: "link_only", reason: "placeholder in body" });
    expect(decide(check({ body: `${goodBody} {skills}` }))).toMatchObject({ reason: "placeholder in body" });
    expect(decide(check({ body: `${goodBody} <b>` }))).toMatchObject({ reason: "placeholder in body" });
    expect(decide(check({ subject: "Application for <role>" }))).toMatchObject({ reason: "placeholder in subject" });
    expect(decide(check({ body: goodBody.replaceAll("Nimbus Analytics", "your company") }))).toMatchObject({ reason: "body does not name the company" });
    // The body mentions the candidate's own title, but not this posting's role.
    const platformJob = { ...job, title: "Data Platform Engineer" };
    expect(decide(check({ body: goodBody.replace("the Software Engineer role", "this role") }), platformJob)).toMatchObject({ reason: "body does not name the role" });
    expect(decide(check({ body: goodBody.replace("the Software Engineer role", "the Data Platform Engineer role") }), platformJob).kind).toBe("draft");
  });

  it("rejects bodies that are far too short or overstate experience", () => {
    expect(decide(check({ body: "Dear Hiring Team, I want the Software Engineer job at Nimbus Analytics." }))).toMatchObject({ kind: "link_only" });
    expect(decide(check({ body: goodBody.replace("I currently work", "With 12 years of experience I currently work") }))).toMatchObject({ reason: "overstated experience" });
  });

  it("removes salary talk unless the posting asks, then states the user's expected CTC", () => {
    const withSalary = goodBody.replace("Thank you", "My expected salary is 30 LPA. Thank you");
    const plain = decide(check({ body: withSalary }));
    expect(plain.kind).toBe("draft");
    if (plain.kind === "draft") expect(plain.body).not.toMatch(/LPA|salary|CTC/i);

    const asks = { ...job, description: `${job.description} Please mention your current and expected CTC.` };
    const d = decide(check({ body: withSalary }), asks);
    expect(d.kind).toBe("draft");
    if (d.kind === "draft") {
      expect(d.body).toContain("my expected CTC is 14 LPA");
      expect(d.body).not.toContain("30 LPA");
    }
  });

  it("adds the greeting when the model forgot it", () => {
    const d = decide(check({ body: goodBody.replace("Dear Hiring Team,\n\n", "") }));
    expect(d.kind === "draft" && d.body.startsWith("Dear Hiring Team,")).toBe(true);
  });
});

describe("excluded companies in the safety checks", () => {
  it("never drafts to a past employer — by name, real employer, email domain or URL", () => {
    expect(decide(check(), { ...job, company: "Acme Retail Tech Pvt Ltd" })).toMatchObject({ kind: "skip", reason: expect.stringMatching(/excluded/) });
    expect(decide(check({ real_employer_name: "Blue Ocean Systems" }), { ...job, company: "Workline Careers" })).toMatchObject({ kind: "skip" });
    const viaEmail = { ...job, company: "Retail Hub", description: "Send CV to jobs@acmeretailtech.com" };
    expect(decide(check({ application_email: "jobs@acmeretailtech.com" }), viaEmail)).toMatchObject({ kind: "skip" });
    expect(decide(check(), { ...job, url: "https://careers.blueocean.in/1" })).toMatchObject({ kind: "skip" });
  });
  it("returns the model's confidence for drafts", () => {
    expect(decide(check({ confidence: 88 }))).toMatchObject({ kind: "draft", confidence: 88 });
  });
});

describe("style checks", () => {
  it("rejects hype words, emojis, shouting and !!", () => {
    expect(styleProblem("I am a rockstar developer")).toBe("hype words");
    expect(styleProblem("Excited to apply 🚀")).toBe("emoji");
    expect(styleProblem("I am VERY EXCITED about this")).toBe("ALL CAPS");
    expect(styleProblem("Thanks!!")).toBe("exclamation marks");
    expect(styleProblem("I have used AWS, MySQL and REACT daily", ["REACT"])).toBeNull();
    expect(decide(check({ body: goodBody.replace("I enjoy", "I am a world-class engineer. I enjoy") }))).toMatchObject({ kind: "link_only", reason: "style: hype words" });
  });
});

describe("auto-send classification (fixed policy)", () => {
  const ok = { confidence: 90, scam: false, agency: false, automationOn: true, gmailConnected: true, autoSendsThisRun: 0, autoSendsToday: 0 };
  it("auto-sends only confident, clean matches", () => {
    expect(classifyAutoSend(ok)).toBe("auto_send");
    expect(classifyAutoSend({ ...ok, confidence: 85 })).toBe("auto_send");
    expect(classifyAutoSend({ ...ok, confidence: 84 })).toBe("draft");
    expect(classifyAutoSend({ ...ok, scam: true })).toBe("draft");
    expect(classifyAutoSend({ ...ok, agency: true })).toBe("draft");
    expect(classifyAutoSend({ ...ok, automationOn: false })).toBe("draft");
    expect(classifyAutoSend({ ...ok, gmailConnected: false })).toBe("draft");
  });
  it("caps auto-sends at 5 per run and 8 per day; the rest stay drafts", () => {
    expect(classifyAutoSend({ ...ok, autoSendsThisRun: 4 })).toBe("auto_send");
    expect(classifyAutoSend({ ...ok, autoSendsThisRun: 5 })).toBe("draft");
    expect(classifyAutoSend({ ...ok, autoSendsToday: 7 })).toBe("auto_send");
    expect(classifyAutoSend({ ...ok, autoSendsToday: 8 })).toBe("draft");
  });
});

describe("follow-up bodies", () => {
  const base = { company: "Nimbus Analytics Pvt Ltd", jobTitle: "Software Engineer", resume };
  const fu1 =
    "Dear Hiring Team,\n\nI am following up on my application for the Software Engineer role at Nimbus Analytics, sent last week. I remain interested, and my work with React and Node.js at Acme Retail Tech matches what your team described in the posting. Have you had a chance to review my application, or is there a next step I could prepare for? Thank you for your time and consideration.";
  it("accepts a polite follow-up 1 and appends the signature in code", () => {
    const r = prepareFollowUpBody({ ...base, body: fu1, sequence: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.endsWith(buildSignature(resume))).toBe(true);
  });
  it("rejects wrong length, pressure language, placeholders and missing company", () => {
    const tooLong = `${fu1} ${fu1.replace("Dear Hiring Team,", "")}`;
    expect(prepareFollowUpBody({ ...base, body: tooLong, sequence: 1 })).toMatchObject({ ok: false, reason: expect.stringMatching(/length/) });
    expect(prepareFollowUpBody({ ...base, body: "Dear Hiring Team,\n\nStill keen on the Software Engineer role at Nimbus Analytics.", sequence: 2 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/length/),
    });
    expect(prepareFollowUpBody({ ...base, body: fu1.replace("I remain interested", "I haven't heard back yet"), sequence: 1 })).toMatchObject({ ok: false, reason: "pressure language" });
    expect(prepareFollowUpBody({ ...base, body: fu1.replace("last week", "[date]"), sequence: 1 })).toMatchObject({ ok: false, reason: "placeholder" });
    expect(prepareFollowUpBody({ ...base, body: fu1.replaceAll("Nimbus Analytics", "your company"), sequence: 1 })).toMatchObject({ ok: false, reason: "company not named" });
  });
  it("has factual templates within the word limits", () => {
    for (const sequence of [1, 2] as const) {
      const t = templateFollowUp({ ...base, sequence });
      const body = t.slice(0, t.indexOf("\n\nRegards,"));
      const words = wordCount(body);
      expect(words).toBeGreaterThanOrEqual(sequence === 1 ? 50 : 32);
      expect(words).toBeLessThanOrEqual(sequence === 1 ? 105 : 85);
      expect(t).toContain("Nimbus Analytics Pvt Ltd");
      expect(t).not.toMatch(/[[\]{}<>]/);
    }
  });
});

describe("human-sounding emails", () => {
  it("replaces dashes used as punctuation, keeps hyphenated words", () => {
    expect(humanize("I build APIs — mostly in Node.js – for a full-stack team")).toBe("I build APIs, mostly in Node.js, for a full-stack team");
    expect(humanize("Backend Engineer - Payments")).toBe("Backend Engineer, Payments");
    expect(humanize("From 2019–2021 and 2022 - 2024")).toBe("From 2019 to 2021 and 2022 to 2024");
    expect(humanize("Node.js-based services")).toBe("Node.js-based services");
  });

  it("uses plain words and drops stock AI lines", () => {
    expect(humanize("I leveraged React and utilized Redis to build seamless flows.")).toBe("I used React and used Redis to build smooth flows.");
    expect(humanize("I spearheaded the migration. Furthermore, I mentored two juniors.")).toBe("I led the migration. Also, I mentored two juniors.");
    expect(humanize("Dear Hiring Team,\n\nI hope this email finds you well. I am applying for the role.")).toBe("Dear Hiring Team,\n\nI am applying for the role.");
    expect(humanize("I like clean code; I write tests.")).toBe("I like clean code. I write tests.");
    expect(humanize("“Quoted” and it’s fine…")).toBe('"Quoted" and it\'s fine...');
  });

  it("cleans the subject and body of a draft", () => {
    const d = decide(check({ subject: "Application for Software Engineer – Priya Sharma", body: goodBody.replace("I enjoy", "I hope this email finds you well. I enjoy").replace("where I build", "where — day to day — I build") }));
    expect(d.kind).toBe("draft");
    if (d.kind !== "draft") return;
    expect(d.subject).toBe("Application for Software Engineer, Priya Sharma");
    expect(d.body).not.toMatch(/[–—]| - /);
    expect(d.body).not.toContain("finds you well");
  });

  it("the plain follow-up template has no dashes or stiff phrases", () => {
    for (const sequence of [1, 2] as const) {
      const t = templateFollowUp({ sequence, company: "Nimbus Analytics", jobTitle: "Software Engineer", resume });
      expect(t).not.toMatch(/[–—]| - |I am writing to|keen/);
    }
  });
});

describe("email layout", () => {
  it("puts the greeting and the closing line on their own paragraphs when the model returns one block", () => {
    expect(layoutEmail("Dear Hiring Team, I am applying for the role. I build APIs. My resume is attached. Happy to talk if it looks like a fit.")).toBe(
      "Dear Hiring Team,\n\nI am applying for the role. I build APIs.\n\nMy resume is attached. Happy to talk if it looks like a fit.",
    );
  });

  it("leaves well-formed emails alone and adds a greeting when missing", () => {
    const ok = "Hi Anita,\n\nI am applying for the role.\n\nThanks for your time.";
    expect(layoutEmail(ok)).toBe(ok);
    expect(layoutEmail("I am applying for the role.")).toBe("Dear Hiring Team,\n\nI am applying for the role.");
  });
});

describe("sending modes (auto-send classification)", () => {
  const ok = { confidence: 90, scam: false, agency: false, automationOn: true, gmailConnected: true, autoSendsThisRun: 0, autoSendsToday: 0 };

  it("Drafts only never auto-sends", () => {
    expect(classifyAutoSend({ ...ok, confidence: 100, mode: "drafts_only" })).toBe("draft");
  });

  it("Smart send: confidence ≥ 85, 5 per run, 8 per day (the default)", () => {
    expect(classifyAutoSend({ ...ok, mode: "smart" })).toBe("auto_send");
    expect(classifyAutoSend({ ...ok, mode: "smart", confidence: 84 })).toBe("draft");
    expect(classifyAutoSend({ ...ok, mode: "smart", autoSendsThisRun: 5 })).toBe("draft");
    expect(classifyAutoSend({ ...ok, mode: "smart", autoSendsToday: 8 })).toBe("draft");
    expect(classifyAutoSend({ ...ok, confidence: 84 })).toBe("draft"); // no mode = smart
  });

  it.each(["send_all", "send_all_instant"] as const)("%s: any confidence, up to 15 per day, never flagged items", (mode) => {
    expect(classifyAutoSend({ ...ok, mode, confidence: 40 })).toBe("auto_send");
    expect(classifyAutoSend({ ...ok, mode, autoSendsThisRun: 9, autoSendsToday: 14 })).toBe("auto_send");
    expect(classifyAutoSend({ ...ok, mode, autoSendsToday: 15 })).toBe("draft");
    expect(classifyAutoSend({ ...ok, mode, scam: true })).toBe("draft");
    expect(classifyAutoSend({ ...ok, mode, agency: true })).toBe("draft");
    expect(classifyAutoSend({ ...ok, mode, automationOn: false })).toBe("draft");
  });

  it("cancel windows: 30 minutes except Send all instantly", () => {
    expect([SEND_MODES.smart, SEND_MODES.send_all, SEND_MODES.send_all_instant].map((m) => m.cancelWindowMinutes)).toEqual([30, 30, 0]);
  });

  it("follow-ups are auto only if the original was sent automatically, and never in Drafts only", () => {
    expect(followUpMode({ followup_mode: "auto", sent_by: "auto" }, "smart")).toBe("auto");
    expect(followUpMode({ followup_mode: "auto", sent_by: "user" }, "send_all")).toBe("draft");
    expect(followUpMode({ followup_mode: "draft", sent_by: "user" }, "send_all_instant")).toBe("draft");
    expect(followUpMode({ followup_mode: "auto", sent_by: "auto" }, "drafts_only")).toBe("draft");
  });
});
