import { z } from "zod";

const str = z.string().trim().max(2000).catch("");
const shortStr = (max: number) => z.string().trim().max(max);

export const resumeDataSchema = z.object({
  full_name: shortStr(120).min(1, "name missing"),
  email: shortStr(254),
  phone: shortStr(40),
  linkedin: shortStr(300),
  location: shortStr(150),
  current_title: shortStr(150),
  roles: z
    .array(
      z.object({
        title: shortStr(150),
        company: shortStr(150),
        start: shortStr(40),
        end: shortStr(40),
        is_current: z.boolean().catch(false),
        bullets: z.array(str).max(15),
      }),
    )
    .max(25),
  projects: z.array(z.object({ name: shortStr(150), description: str })).max(20),
  skills: z.array(shortStr(80)).max(80),
  education: z
    .array(z.object({ degree: shortStr(200), institution: shortStr(200), year: shortStr(40) }))
    .max(10),
  suggested_target_roles: z.array(shortStr(80).min(2)).min(1).max(12),
});

export type ResumeData = z.infer<typeof resumeDataSchema>;

// JSON schema handed to Gemini (structured output). Kept in sync with the zod schema above.
const s = { type: "string" } as const;
export const resumeJsonSchema = {
  type: "object",
  properties: {
    full_name: s,
    email: s,
    phone: s,
    linkedin: s,
    location: s,
    current_title: s,
    roles: {
      type: "array",
      items: {
        type: "object",
        properties: { title: s, company: s, start: s, end: s, is_current: { type: "boolean" }, bullets: { type: "array", items: s } },
        required: ["title", "company", "start", "end", "is_current", "bullets"],
      },
    },
    projects: { type: "array", items: { type: "object", properties: { name: s, description: s }, required: ["name", "description"] } },
    skills: { type: "array", items: s },
    education: {
      type: "array",
      items: { type: "object", properties: { degree: s, institution: s, year: s }, required: ["degree", "institution", "year"] },
    },
    suggested_target_roles: { type: "array", items: s },
  },
  required: ["full_name", "email", "phone", "linkedin", "location", "current_title", "roles", "projects", "skills", "education", "suggested_target_roles"],
};

export const jobCheckSchema = z.object({
  suitable: z.boolean(),
  reason: shortStr(500).catch(""),
  confidence: z.coerce.number().int().min(0).max(100).catch(0),
  real_employer_name: shortStr(200).catch(""),
  scam_or_spam_signals: z.boolean(),
  is_staffing_agency: z.boolean(),
  application_email: shortStr(254).catch(""),
  contact_name: shortStr(120).catch(""),
  subject: shortStr(200).catch(""),
  body: z.string().max(4000).catch(""),
});

export type JobCheck = z.infer<typeof jobCheckSchema>;

export const jobCheckJsonSchema = {
  type: "object",
  properties: {
    suitable: { type: "boolean" },
    reason: s,
    confidence: { type: "integer" },
    real_employer_name: s,
    scam_or_spam_signals: { type: "boolean" },
    is_staffing_agency: { type: "boolean" },
    application_email: s,
    contact_name: s,
    subject: s,
    body: s,
  },
  required: ["suitable", "reason", "confidence", "real_employer_name", "scam_or_spam_signals", "is_staffing_agency", "application_email", "contact_name", "subject", "body"],
};

/** Batch suitability screen: one result per posting, matched back by index. */
export const screenSchema = z.object({
  results: z
    .array(
      z.object({
        index: z.coerce.number().int().min(0).max(20),
        suitable: z.boolean(),
        reason: shortStr(300).catch(""),
        confidence: z.coerce.number().int().min(0).max(100).catch(0),
        real_employer_name: shortStr(200).catch(""),
        scam_or_spam_signals: z.boolean().catch(false),
        is_staffing_agency: z.boolean().catch(false),
      }),
    )
    .max(20),
});

export type ScreenResult = z.infer<typeof screenSchema>["results"][number];

export const screenJsonSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          suitable: { type: "boolean" },
          reason: s,
          confidence: { type: "integer" },
          real_employer_name: s,
          scam_or_spam_signals: { type: "boolean" },
          is_staffing_agency: { type: "boolean" },
        },
        required: ["index", "suitable", "reason", "confidence", "real_employer_name", "scam_or_spam_signals", "is_staffing_agency"],
      },
    },
  },
  required: ["results"],
};

export const followUpSchema = z.object({ body: z.string().trim().min(1).max(3000) });
export type FollowUpText = z.infer<typeof followUpSchema>;
export const followUpJsonSchema = { type: "object", properties: { body: s }, required: ["body"] };
