// Deterministic stand-in for Gemini (MOCK_EXTERNAL=true). It reads the same
// inputs the real model gets and returns output in the same JSON shape.
import { extractEmails } from "../matching/emails.js";
import { isStaffingAgencyName } from "../matching/filters.js";
import type { ResumeData } from "./schemas.js";

type Req = { task: "resume" | "job_check" | "followup"; input: unknown };

interface MockCandidate {
  name: string;
  current_title: string;
  total_experience_years: number;
  skills: string[];
  roles: { title: string; company: string }[];
  projects: { name: string; description: string }[];
  education: { degree: string; institution: string }[];
  target_roles?: string[];
}

export async function mockGenerateJson(req: Req): Promise<unknown> {
  if (req.task === "resume") return mockResume((req.input as { text: string }).text);
  if (req.task === "followup") return mockFollowUp(req.input as { sequence: 1 | 2; company: string; job_title: string; candidate: MockCandidate });
  const { candidate, posting } = req.input as { candidate: MockCandidate; posting: { title: string; company: string; location: string; description: string } };
  return mockJobCheck(candidate, posting);
}

function mockFollowUp({ sequence, company, job_title, candidate }: { sequence: 1 | 2; company: string; job_title: string; candidate: MockCandidate }) {
  const strength = candidate.skills.slice(0, 2).join(" and ") || "my core skills";
  const body =
    sequence === 1
      ? `Dear Hiring Team,

I am following up on my application for the ${job_title} role at ${company}, which I sent last week. I remain very interested in the position, and my experience with ${strength} in my current role as ${candidate.current_title} matches what your team described. Have you had a chance to review my application, or is there a next step I can prepare for? Thank you for considering it.`
      : `Dear Hiring Team,

I wanted to close the loop on my application for the ${job_title} role at ${company}. I am still interested and would be glad to share anything else that helps your decision. Thank you for your time and consideration, and I wish your team the very best.`;
  return { body };
}

const DATE = String.raw`((?:[A-Za-z]{3,9}\.?\s+)?\d{4}(?:[-/]\d{1,2})?|Present|Current)`;
const ROLE_LINE = new RegExp(String.raw`^(.+?)\s*[|,@–-]\s*(.+?)\s*[|(]\s*${DATE}\s*(?:-|–|to)\s*${DATE}\s*\)?$`, "i");

export function mockResume(text: string): ResumeData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = extractEmails(text)[0] ?? "";
  const phone = /(\+?\d[\d\s-]{8,14}\d)/.exec(text)?.[1]?.trim() ?? "";
  const linkedin = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i.exec(text)?.[0] ?? "";
  const roles: ResumeData["roles"] = [];
  let current: ResumeData["roles"][number] | null = null;
  let section = "";
  const skills: string[] = [];
  const education: ResumeData["education"] = [];
  const projects: ResumeData["projects"] = [];
  for (const line of lines) {
    const heading = line.replace(/[:\s]+$/, "").toLowerCase();
    if (["experience", "work experience", "professional experience", "skills", "technical skills", "education", "projects"].includes(heading)) {
      section = heading.includes("skill") ? "skills" : heading.includes("experience") ? "experience" : heading;
      continue;
    }
    if (section === "experience") {
      const m = ROLE_LINE.exec(line);
      if (m) {
        const end = m[4]!.trim();
        current = { title: m[1]!.trim(), company: m[2]!.trim(), start: m[3]!.trim(), end, is_current: /present|current/i.test(end), bullets: [] };
        roles.push(current);
      } else if (current && /^[-•*]/.test(line)) {
        current.bullets.push(line.replace(/^[-•*]\s*/, ""));
      }
    } else if (section === "skills") {
      skills.push(...line.split(/[,;|•]/).map((s) => s.replace(/^[-*]\s*/, "").trim()).filter((s) => s && s.length < 60));
    } else if (section === "education") {
      const [degree, institution = "", year = ""] = line.split(/\s*[|,–-]\s*/);
      if (degree) education.push({ degree, institution, year: /\d{4}/.exec(year || line)?.[0] ?? "" });
    } else if (section === "projects") {
      const [name, ...rest] = line.replace(/^[-•*]\s*/, "").split(/\s*[:–-]\s*/);
      if (name) projects.push({ name, description: rest.join(" - ") });
    }
  }
  const currentTitle = roles[0]?.title ?? lines.find((l) => /engineer|developer|manager|analyst|designer|consultant|specialist/i.test(l)) ?? "";
  const lower = skills.join(" ").toLowerCase();
  const suggestions = [currentTitle];
  if (/react|angular|vue|frontend/.test(lower)) suggestions.push("Frontend Developer");
  if (/node|java|python|go|backend|sql/.test(lower)) suggestions.push("Backend Developer");
  if (/react/.test(lower) && /node/.test(lower)) suggestions.push("Full Stack Developer");
  suggestions.push("Software Engineer", "Software Developer");
  return {
    full_name: lines[0] ?? "Candidate",
    email,
    phone,
    linkedin,
    location: lines.slice(0, 5).find((l) => /,\s*(india|karnataka|maharashtra|delhi|tamil nadu|telangana)/i.test(l)) ?? "",
    current_title: currentTitle,
    roles,
    projects,
    skills: [...new Set(skills)].slice(0, 30),
    education,
    suggested_target_roles: [...new Set(suggestions.filter(Boolean))].slice(0, 8),
  };
}

function mockJobCheck(candidate: MockCandidate, posting: { title: string; company: string; description: string }) {
  const text = posting.description;
  const scam = /registration fee|security deposit|pay .{0,20}fee|whatsapp only|telegram only/i.test(text);
  const agency = isStaffingAgencyName(posting.company) || /\bour client\b/i.test(text);
  // An address in a sentence that talks about applying/CVs.
  let applicationEmail = "";
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    if (/\b(cv|cvs|resume|apply|application|applications)\b/i.test(sentence)) {
      const e = extractEmails(sentence)[0];
      if (e) {
        applicationEmail = e;
        break;
      }
    }
  }
  const suitable = !scam;
  // Exact target-role titles are "strong" matches (auto-send); the rest become drafts.
  const exact = (candidate.target_roles ?? []).some((r) => r.trim().toLowerCase() === posting.title.trim().toLowerCase());
  const confidence = suitable ? (exact ? 90 : 75) : 0;
  // "Our client Blue Ocean Systems is hiring…" → "Blue Ocean Systems"
  const realEmployer = /\b[Oo]ur client,?\s+([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,4})/.exec(text)?.[1]?.trim() ?? "";
  const recent = candidate.roles[0];
  const skills = candidate.skills.slice(0, 5).join(", ") || "my core skills";
  const project = candidate.projects[0];
  const edu = candidate.education[0];
  const years = candidate.total_experience_years;
  const body = [
    "Dear Hiring Team,",
    "",
    `I am writing to apply for the ${posting.title} role at ${posting.company}. I am currently working as ${candidate.current_title || "a professional"}${recent ? ` at ${recent.company}` : ""}, with ${years} years of professional experience, and the responsibilities described in your posting closely match the work I do every day.`,
    "",
    `In my recent roles I have worked extensively with ${skills}. I enjoy taking features from an idea to production, collaborating with product and design colleagues, and keeping quality high through careful reviews and testing.${project ? ` One project I am proud of is ${project.name}, where ${project.description ? project.description.replace(/\.$/, "").toLowerCase() : "I delivered the work end to end"}.` : ""}`,
    "",
    `${edu ? `I hold a ${edu.degree}${edu.institution ? ` from ${edu.institution}` : ""}. ` : ""}I would welcome the opportunity to discuss how my experience can help ${posting.company} as your next ${posting.title}. My resume is attached for your review, and I am happy to share any further details you need.`,
    "",
    "Thank you for your time and consideration.",
  ].join("\n");
  return {
    suitable,
    reason: suitable ? "Experience and skills match the role." : "Posting shows scam signals.",
    confidence,
    real_employer_name: realEmployer,
    scam_or_spam_signals: scam,
    is_staffing_agency: agency,
    application_email: applicationEmail,
    contact_name: "",
    subject: suitable ? `Application for ${posting.title} – ${candidate.name}` : "",
    body: suitable ? body : "",
  };
}
