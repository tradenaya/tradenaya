import { describe, expect, it } from "vitest";
import type { Job } from "../../src/jobs/types.js";
import { applyRuleFilter, isStaffingAgencyName, rejectReason, type FilterContext } from "../../src/matching/filters.js";
import { locationMatches } from "../../src/matching/locations.js";
import { asksExpectedCtc, parseMinExperience, parseSalaryLpa } from "../../src/matching/parse.js";
import { companyKey } from "../../src/matching/text.js";
import { seniorityMismatch, titleMatchesAny, titleMatchesRole, titleTokens } from "../../src/matching/titles.js";

const job = (over: Partial<Job> = {}): Job => ({
  key: "adzuna:1",
  source: "adzuna",
  title: "Software Engineer",
  company: "Nimbus Analytics Pvt Ltd",
  location: "Bengaluru, Karnataka",
  isRemote: false,
  description: "Build things. Send CV to jobs@nimbus.in",
  url: "https://nimbus.in/jobs/1",
  postedAt: "2026-10-18T03:00:00Z",
  salaryMinLpa: null,
  salaryMaxLpa: null,
  ...over,
});

const ctx = (over: Partial<FilterContext> = {}): FilterContext => ({
  targetRoles: ["Software Engineer", "Backend Developer"],
  locations: ["Bengaluru, Karnataka"],
  experienceYears: 4,
  expectedSalaryLpa: 12,
  seenJobKeys: new Set(),
  recentCompanyKeys: new Set(),
  ...over,
});

describe("title matching", () => {
  it("normalises spelling variants and synonyms", () => {
    expect(titleTokens("Sr. React.js Front-End Developer")).toEqual(["react", "frontend", "dev"]);
    expect(titleMatchesRole("Front End Engineer", "Frontend Developer")).toBe(true);
    expect(titleMatchesRole("Senior Software Developer", "Software Engineer")).toBe(true);
    expect(titleMatchesRole("Backend Engineer (Node.js)", "Backend Developer")).toBe(true);
    expect(titleMatchesRole("Full Stack Developer - MERN", "Full-Stack Engineer")).toBe(true);
  });

  it("rejects different jobs that share only a generic word", () => {
    expect(titleMatchesRole("Project Manager", "Product Manager")).toBe(false);
    expect(titleMatchesRole("Sales Manager", "Engineering Manager")).toBe(false);
    expect(titleMatchesRole("Business Analyst", "Data Analyst")).toBe(false);
    expect(titleMatchesRole("Mechanical Engineer", "Software Engineer")).toBe(false);
  });

  it("matches any of several roles", () => {
    expect(titleMatchesAny("Product Owner", ["Data Analyst", "Product Manager"])).toBe(true);
    expect(titleMatchesAny("Chef", ["Data Analyst", "Product Manager"])).toBe(false);
  });
});

describe("seniority", () => {
  it("excludes senior/principal/director/head/VP titles for juniors", () => {
    expect(seniorityMismatch("Senior Software Engineer", 3)).toBe("too senior");
    expect(seniorityMismatch("Principal Engineer", 4.9)).toBe("too senior");
    expect(seniorityMismatch("Director of Engineering", 6)).toMatch(/executive/);
    expect(seniorityMismatch("Head of Product", 2)).toMatch(/executive/);
    expect(seniorityMismatch("VP Engineering", 7)).toMatch(/executive/);
    expect(seniorityMismatch("Senior Software Engineer", 5)).toBeNull();
  });
  it("excludes internships unless experience is 0", () => {
    expect(seniorityMismatch("Software Engineering Intern", 2)).toBe("internship");
    expect(seniorityMismatch("Software Engineering Intern", 0)).toBeNull();
  });
});

describe("experience parsing", () => {
  it.each([
    ["Requires 5+ years of experience", 5],
    ["3-6 yrs experience in Java", 3],
    ["Experience: 2 to 4 years", 2],
    ["minimum 7 years in backend", 7],
    ["at least 10 years of hands-on experience", 10],
    ["4 years of relevant experience", 4],
    ["Graduated 2019-2021 years ago", null],
    ["No experience requirement mentioned", null],
  ])("%s → %s", (text, expected) => {
    expect(parseMinExperience(text)).toBe(expected);
  });
});

describe("salary parsing", () => {
  it.each([
    ["CTC 8-12 LPA", { minLpa: 8, maxLpa: 12 }],
    ["₹6,00,000 - ₹9,00,000 per annum", { minLpa: 6, maxLpa: 9 }],
    ["Rs. 50,000 per month", { minLpa: 6, maxLpa: 6 }],
    ["₹25,000 - 35,000 per month", { minLpa: 3, maxLpa: 4.2 }],
    ["up to 15 lakhs", { minLpa: null, maxLpa: 15 }],
  ])("%s", (text, expected) => {
    expect(parseSalaryLpa(text)).toEqual(expected);
  });
  it("returns null when no salary is stated", () => {
    expect(parseSalaryLpa("Competitive pay and great culture")).toBeNull();
  });
  it("detects requests for expected CTC", () => {
    expect(asksExpectedCtc("Share your current and expected CTC")).toBe(true);
    expect(asksExpectedCtc("Please mention salary expectations")).toBe(true);
    expect(asksExpectedCtc("Salary: 10-20 LPA")).toBe(false);
  });
});

describe("locations", () => {
  it("matches city aliases and remote", () => {
    expect(locationMatches({ location: "Bangalore, Karnataka", isRemote: false, title: "x" }, ["Bengaluru, Karnataka"])).toBe(true);
    expect(locationMatches({ location: "Gurgaon, Haryana", isRemote: false, title: "x" }, ["Gurugram, Haryana"])).toBe(true);
    expect(locationMatches({ location: "Pune, Maharashtra", isRemote: false, title: "x" }, ["Mumbai, Maharashtra"])).toBe(false);
    expect(locationMatches({ location: "India", isRemote: true, title: "x" }, ["Remote (India)"])).toBe(true);
    expect(locationMatches({ location: "India", isRemote: false, title: "Engineer (Work from home)" }, ["Remote (India)"])).toBe(true);
    expect(locationMatches({ location: "India", isRemote: true, title: "x" }, ["Pune, Maharashtra"])).toBe(false);
  });
});

describe("agencies and company keys", () => {
  it.each(["ABC Consultancy", "QuickHire Placement Services", "TalentBridge Staffing", "Prime Manpower Solutions", "XYZ HR Services", "Hire Recruitment Pvt Ltd"])(
    "%s is an agency",
    (name) => expect(isStaffingAgencyName(name)).toBe(true),
  );
  it("does not flag real employers", () => {
    expect(isStaffingAgencyName("Tata Consultancy Services")).toBe(false);
    expect(isStaffingAgencyName("Nimbus Analytics Pvt Ltd")).toBe(false);
  });
  it("normalises legal suffixes", () => {
    expect(companyKey("Nimbus Analytics Pvt. Ltd.")).toBe(companyKey("nimbus analytics private limited"));
  });
});

describe("rule filter", () => {
  it("applies every rule with a reason", () => {
    expect(rejectReason(job({ location: "Chennai" }), ctx())).toBe("location");
    expect(rejectReason(job({ title: "Graphic Designer" }), ctx())).toBe("title");
    expect(rejectReason(job({ title: "Senior Software Engineer" }), ctx())).toBe("too senior");
    expect(rejectReason(job({ description: "Minimum 8 years of experience" }), ctx())).toBe("experience required too high");
    expect(rejectReason(job({ description: "Minimum 6 years of experience" }), ctx())).toBeNull();
    expect(rejectReason(job({ salaryMaxLpa: 8 }), ctx())).toBe("salary below expectation");
    expect(rejectReason(job({ description: "Salary 4-6 LPA" }), ctx())).toBe("salary below expectation");
    expect(rejectReason(job({ salaryMaxLpa: null }), ctx())).toBeNull(); // unknown salary is kept
    expect(rejectReason(job({ company: "Bright Placement Consultancy" }), ctx())).toBe("staffing agency");
    expect(rejectReason(job(), ctx({ seenJobKeys: new Set(["adzuna:1"]) }))).toBe("already seen");
    expect(rejectReason(job(), ctx({ recentCompanyKeys: new Set([companyKey("Nimbus Analytics")]) }))).toBe("company contacted recently");
  });

  it("dedupes by company + title and sorts newest first", () => {
    const { passed, rejected } = applyRuleFilter(
      [
        job({ key: "a", postedAt: "2026-10-16T00:00:00Z", company: "Kestrel Labs" }),
        job({ key: "b", postedAt: "2026-10-18T00:00:00Z" }),
        job({ key: "c", company: "Nimbus Analytics Private Limited" }),
      ],
      ctx(),
    );
    expect(passed.map((j) => j.key)).toEqual(["b", "a"]);
    expect(rejected).toEqual([expect.objectContaining({ reason: "duplicate" })]);
  });
});
