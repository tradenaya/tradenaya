import { describe, expect, it } from "vitest";
import { adzunaParams, keepForQuery, normalizeAdzuna } from "../../src/jobs/adzuna.js";
import { isIndiaJob, jsearchParams, parseJSearchResponse, postedAtOf, preferredApplyLink, type JSearchResponse } from "../../src/jobs/jsearch.js";
import { adzunaLabel, adzunaQueries, jsearchCombos, jsearchQueryText, searchAreas } from "../../src/jobs/queries.js";
import type { Job } from "../../src/jobs/types.js";
import { rejectReason, type FilterContext } from "../../src/matching/filters.js";
import { industryProblem } from "../../src/matching/industry.js";
import { locationMatches } from "../../src/matching/locations.js";
import { parseMinExperience } from "../../src/matching/parse.js";
import { roleFamilies, titleMatchesAny, titleMatchesRole } from "../../src/matching/titles.js";
import { stepOf, zeroFetchReason } from "../../src/runs/funnel.js";

const job = (over: Partial<Job> = {}): Job => ({
  key: "jsearch:1",
  source: "jsearch",
  title: "Product Manager",
  company: "Kite Labs",
  location: "Pune, Maharashtra, India",
  isRemote: false,
  description: "Own the roadmap for our SaaS platform. Work with engineering on sprints.",
  url: "https://kitelabs.in/jobs/1",
  postedAt: null,
  salaryMinLpa: null,
  salaryMaxLpa: null,
  ...over,
});

const ctx = (over: Partial<FilterContext> = {}): FilterContext => ({
  targetRoles: ["Product Manager", "Project Manager"],
  locations: ["Pune, Maharashtra", "Mumbai, Maharashtra", "Remote (India)", "Hyderabad, Telangana", "Bengaluru, Karnataka"],
  experienceYears: 2,
  expectedSalaryLpa: 0,
  seenJobKeys: new Set(),
  recentCompanyKeys: new Set(),
  ...over,
});

describe("title synonyms (role families)", () => {
  it.each([
    ["Product Manager – Platform", "Product Manager"],
    ["PM", "Product Manager"],
    ["Associate PM", "Product Manager"],
    ["Associate Product Manager", "Product Manager"],
    ["Product Owner", "Product Manager"],
    ["Project Manager – IT", "Project Manager"],
    ["Technical Program Manager", "Project Manager"],
    ["Associate Project Manager", "Project Manager"],
    ["Project Coordinator", "Project Manager"],
    ["Delivery Lead", "Delivery Manager"],
    ["Business Systems Analyst", "Business Analyst"],
    ["Implementation Specialist", "Implementation Consultant"],
    ["Customer Success Associate", "Customer Success Manager"],
    ["Technical Account Manager", "Customer Success Manager"],
    ["Agile Coach", "Scrum Master"],
    ["Tech Lead", "Team Lead"],
  ])("%s matches %s", (title, role) => {
    expect(titleMatchesRole(title, role)).toBe(true);
  });

  it.each([
    ["Sales Manager", "Product Manager"],
    ["Sales Manager", "Project Manager"],
    ["Civil Project Manager", "Project Manager"],
    ["Construction Project Manager", "Project Manager"],
    ["Product Manager - Ruminant (veterinary)", "Product Manager"],
    ["Project Manager (PM)", "Product Manager"],
    ["Project Manager", "Product Manager"],
    ["Mechanical Design Engineer", "Software Engineer"],
  ])("%s does NOT match %s", (title, role) => {
    expect(titleMatchesRole(title, role)).toBe(false);
  });

  it("detects families and keeps existing token matching", () => {
    expect([...roleFamilies("Senior Technical Program Manager")]).toEqual(["project"]);
    expect(titleMatchesAny("Full Stack Developer - MERN", ["Full-Stack Engineer"])).toBe(true);
  });
});

describe("industry check for generic titles", () => {
  it("rejects clearly non-software domains", () => {
    expect(industryProblem({ title: "Product Manager", description: "Launch veterinary formulations for livestock farmers and our pharma distributors." })).toMatch(/industry/);
    expect(industryProblem({ title: "Project Manager", description: "Site execution for residential construction with civil contractors and BOQ tracking." })).toMatch(/industry/);
  });
  it("keeps software postings and software titles", () => {
    expect(industryProblem({ title: "Project Manager", description: "Run agile sprints in Jira for our SaaS platform; work with developers." })).toBeNull();
    expect(industryProblem({ title: "IT Project Manager", description: "Construction company digitising with civil contractors." })).toBeNull();
  });
  it("counts as an 'industry' rejection in the funnel", () => {
    const reason = rejectReason(job({ description: "Promote veterinary formulations to livestock farmers with pharma distributors." }), ctx())!;
    expect(stepOf(reason)).toBe("industry");
  });
});

describe("experience parsing and the relaxed filter", () => {
  it.each([
    ["7+ years of experience", 7],
    ["10+ years in product", 10],
    ["3-5 years", 3],
    ["3 to 5 yrs experience", 3],
    ["Senior Product Manager | 15+ Years", 15],
    ["A company with 25+ years of excellence", null],
  ])("%s → %s", (text, expected) => {
    expect(parseMinExperience(text)).toBe(expected);
  });
  it("keeps a stated minimum up to the user's experience + 2", () => {
    expect(rejectReason(job({ description: "Needs 7+ years of experience" }), ctx())).toBe("experience required too high");
    expect(rejectReason(job({ description: "3-5 years of experience in SaaS platform roles" }), ctx())).toBeNull();
    expect(rejectReason(job({ description: "Experience not stated, SaaS platform" }), ctx())).toBeNull();
  });
  it("only skips director/head/VP/principal for users under 5 years; Senior Associate and Lead are fine", () => {
    expect(rejectReason(job({ title: "Head of Product Management" }), ctx())).toMatch(/too senior/);
    expect(rejectReason(job({ title: "Senior Associate Product Manager" }), ctx())).toBeNull();
    expect(rejectReason(job({ title: "Head of Product Management" }), ctx({ experienceYears: 6 }))).toBeNull();
  });
});

describe("locations: nearby areas", () => {
  it.each([
    ["Navi Mumbai, Maharashtra", "Mumbai, Maharashtra"],
    ["Thane, Maharashtra", "Mumbai, Maharashtra"],
    ["Pimpri-Chinchwad, Maharashtra", "Pune, Maharashtra"],
    ["Secunderabad, Telangana", "Hyderabad, Telangana"],
    ["Bangalore", "Bengaluru, Karnataka"],
    ["Bengaluru, Karnataka", "Bangalore, Karnataka"],
  ])("%s counts as %s", (jobLoc, userLoc) => {
    expect(locationMatches({ location: jobLoc, isRemote: false, title: "x" }, [userLoc])).toBe(true);
  });
});

describe("Adzuna queries", () => {
  const pairs = ["Pune, Maharashtra", "Mumbai, Maharashtra", "Remote (India)", "Hyderabad, Telangana", "Bengaluru, Karnataka"].map((location) => ({ role: "Product Manager", location }));

  it("queries each (role, area) with aliases, and remote as two keyword searches without where", () => {
    const qs = adzunaQueries([...pairs, ...pairs]); // duplicates collapse
    expect(qs.filter((q) => q.where).map((q) => q.where)).toEqual(["Pune", "Pimpri-Chinchwad", "Mumbai", "Navi Mumbai", "Thane", "Hyderabad", "Secunderabad", "Bengaluru", "Bangalore"]);
    const remote = qs.filter((q) => !q.where);
    expect(remote.map((q) => [adzunaLabel(q), q.variant, q.remoteOnly])).toEqual([
      ['Product Manager + "remote"', "remote", true],
      ['Product Manager + "work from home"', "wfh", true],
    ]);
    expect(searchAreas("Bangalore")).toEqual(["Bengaluru", "Bangalore"]);
  });

  it("asks for the role in the title, the last 7 days, 50 per page, newest first", () => {
    const [pune] = adzunaQueries(pairs);
    const p = adzunaParams(pune!, { appId: "id", appKey: "key" });
    expect(Object.fromEntries(p)).toMatchObject({ title_only: "Product Manager", where: "Pune", max_days_old: "7", results_per_page: "50", sort_by: "date" });
    expect(p.has("what")).toBe(false);
    const remote = adzunaParams(adzunaQueries(pairs).find((q) => q.variant === "remote")!, { appId: "id", appKey: "key" });
    expect(remote.has("where")).toBe(false);
    expect([remote.get("title_only"), remote.get("what")]).toEqual(["Product Manager", "remote"]);
  });

  it("remote searches keep only postings that say remote / work from home / WFH", () => {
    const q = { remoteOnly: true };
    expect(keepForQuery(job({ title: "Product Manager (WFH)" }), q)).toBe(true);
    expect(keepForQuery(job({ description: "Fully remote team" }), q)).toBe(true);
    expect(keepForQuery(job({ title: "Product Manager", description: "Office in Pune" }), q)).toBe(false);
    expect(keepForQuery(job(), { remoteOnly: false })).toBe(true);
  });

  it("normalises a result", () => {
    const j = normalizeAdzuna({ id: 7, title: "<b>Product Manager</b>", company: { display_name: "Kite" }, redirect_url: "https://adzuna/7", location: { display_name: "Pune, Maharashtra" }, description: "Remote friendly" })!;
    expect(j).toMatchObject({ key: "adzuna:7", title: "Product Manager", company: "Kite", isRemote: true });
  });
});

describe("JSearch v5", () => {
  // The exact v5 response shape: status, data.jobs, data.cursor.
  const response: JSearchResponse = {
    status: "OK",
    request_id: "req-1",
    data: {
      cursor: "CURSOR-PAGE-2",
      jobs: [
        {
          job_id: "abc123==",
          job_uid: "uid-1",
          job_title: "Senior Product Manager | 7+ Years",
          employer_name: "Mastercard",
          employer_website: "https://www.mastercard.co.in",
          job_publisher: "LinkedIn",
          job_apply_link: "https://www.linkedin.com/jobs/view/1",
          apply_options: [
            { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/1", is_direct: false },
            { publisher: "Mastercard Careers", apply_link: "https://careers.mastercard.com/job/1", is_direct: true },
          ],
          job_description: "We need 7+ years of product experience on our payments platform.",
          job_is_remote: false,
          job_city: "Pune",
          job_state: "Maharashtra",
          job_country: "IN",
          job_location: "Pune, Maharashtra",
          job_posted_at_datetime_utc: null,
          job_posted_at_timestamp: 1761177600,
          job_min_salary: null,
          job_max_salary: null,
          job_salary_period: null,
        },
        {
          job_id: "def456==",
          job_uid: "uid-2",
          job_title: "Associate Product Manager",
          employer_name: "Tealpath Software",
          employer_website: null,
          job_publisher: "Tealpath",
          job_apply_link: "https://tealpath.in/careers/apm",
          apply_options: [],
          job_description: "3-5 years of experience. Startup building a SaaS platform. Send your resume to careers@tealpath.in.",
          job_is_remote: false,
          job_city: "Mumbai",
          job_state: "Maharashtra",
          job_country: "IN",
          job_location: "Mumbai, Maharashtra",
          job_posted_at_datetime_utc: null,
          job_posted_at_timestamp: null,
          job_min_salary: 1200000,
          job_max_salary: 1800000,
          job_salary_period: "YEAR",
        },
        {
          job_id: "us-1",
          job_uid: "uid-3",
          job_title: "Product Manager",
          employer_name: "Acme US",
          job_apply_link: "https://acme.example/jobs/1",
          job_description: "Onsite in Austin, TX.",
          job_is_remote: false,
          job_country: "US",
          job_location: "Austin, TX",
          job_posted_at_datetime_utc: "2026-10-20T00:00:00.000Z",
        },
      ],
    },
  };

  it("always sends country=in, date_posted=week, num_pages=1, language=en (and the cursor for page 2)", () => {
    const p = jsearchParams({ query: "Product Manager in Pune, India" });
    expect(Object.fromEntries(p)).toEqual({ query: "Product Manager in Pune, India", country: "in", date_posted: "week", num_pages: "1", language: "en" });
    expect(jsearchParams({ query: "x" }, "CURSOR-PAGE-2").get("cursor")).toBe("CURSOR-PAGE-2");
  });

  it("parses data.jobs and data.cursor, skips non-India jobs, and maps the fields", () => {
    const page = parseJSearchResponse(response, "startup");
    expect(page).toMatchObject({ total: 3, notIndia: 1, cursor: "CURSOR-PAGE-2" });
    expect(page.jobs).toHaveLength(2);
    const [a, b] = page.jobs;
    expect(a).toMatchObject({
      key: "jsearch:uid-1",
      source: "jsearch",
      title: "Senior Product Manager | 7+ Years",
      company: "Mastercard",
      location: "Pune, Maharashtra",
      isRemote: false,
      url: "https://careers.mastercard.com/job/1", // the direct apply option wins
      employerWebsite: "https://www.mastercard.co.in",
      postedAt: new Date(1761177600 * 1000).toISOString(), // null datetime → timestamp
      variant: "startup",
    });
    expect(b).toMatchObject({ key: "jsearch:uid-2", url: "https://tealpath.in/careers/apm", postedAt: null, salaryMinLpa: 12, salaryMaxLpa: 18 });
    expect(b!.description).toContain("careers@tealpath.in");
  });

  it("experience: '7+ years' is filtered for a 2-year user, '3-5 years' is kept", () => {
    const [a, b] = parseJSearchResponse(response).jobs;
    expect(rejectReason(a!, ctx())).toBe("experience required too high");
    expect(rejectReason(b!, ctx())).toBeNull();
  });

  it("India rule, apply-link preference and date fallback", () => {
    expect(isIndiaJob({ job_country: "IN" })).toBe(true);
    expect(isIndiaJob({ job_country: "US", job_is_remote: false })).toBe(false);
    expect(isIndiaJob({ job_country: "", job_is_remote: true })).toBe(true);
    expect(isIndiaJob({ job_country: "US", job_is_remote: true, job_description: "Remote, open to candidates in India" })).toBe(true);
    expect(preferredApplyLink({ job_apply_link: "https://a", apply_options: [{ apply_link: "https://b", is_direct: false }] })).toBe("https://a");
    expect(postedAtOf({ job_posted_at_datetime_utc: "2026-10-20T10:00:00.000Z", job_posted_at_timestamp: 1 })).toBe("2026-10-20T10:00:00.000Z");
    expect(postedAtOf({})).toBeNull();
  });

  it("a non-OK status is an error, not zero jobs", () => {
    expect(() => parseJSearchResponse({ status: "ERROR", error: { message: "Invalid query" } })).toThrow(/JSearch status ERROR: Invalid query/);
  });

  it("query variants target smaller employers; plain variants come first; no remote walk-ins", () => {
    expect(jsearchQueryText("Product Manager", "Pune, Maharashtra", "plain")).toBe("Product Manager in Pune, India");
    expect(jsearchQueryText("Product Manager", "Pune, Maharashtra", "startup")).toBe("Product Manager startup in Pune, India");
    expect(jsearchQueryText("Product Manager", "Pune, Maharashtra", "immediate")).toBe("Product Manager hiring immediate joiner Pune");
    expect(jsearchQueryText("Product Manager", "Pune, Maharashtra", "send_resume")).toBe("Product Manager send resume Pune");
    expect(jsearchQueryText("Product Manager", "Pune, Maharashtra", "walk_in")).toBe("Product Manager walk-in Pune");
    expect(jsearchQueryText("Product Manager", "Remote (India)", "plain")).toBe("Product Manager remote India");
    expect(jsearchQueryText("Product Manager", "Remote (India)", "walk_in")).toBeNull();
    const combos = jsearchCombos([
      { role: "Product Manager", location: "Pune, Maharashtra" },
      { role: "Product Manager", location: "Remote (India)" },
    ]);
    expect(combos.map((c) => c.variant)).toEqual(["plain", "plain", "startup", "startup", "immediate", "immediate", "send_resume", "send_resume", "walk_in"]);
  });
});

describe("funnel helpers", () => {
  const src = (over: object) => ({ source: "adzuna" as const, configured: true, calls: 1, cached: 0, fetched: 0, errors: [], ...over });
  it("explains a run that fetched nothing", () => {
    expect(zeroFetchReason([src({}), src({ source: "jsearch", configured: false })])).toBe("No jobs were fetched. Adzuna returned 0 jobs · JSearch not configured.");
    expect(zeroFetchReason([src({ errors: [{ status: 401, message: "Adzuna error 401" }] })])).toContain("Adzuna error 401");
    expect(zeroFetchReason([src({ source: "jsearch", note: "Quota exhausted (HTTP 429), skipped until tomorrow" })])).toContain("JSearch: Quota exhausted");
    expect(zeroFetchReason([src({ configured: false }), src({ source: "jsearch", configured: false })])).toMatch(/No job source is configured/);
  });
  it("groups filter reasons into steps", () => {
    expect(["already seen", "location", "title", "too senior (director/head/VP/principal)", "experience required too high", "salary below expectation", "staffing agency", "company contacted recently", "duplicate"].map(stepOf)).toEqual([
      "seen", "location", "title", "seniority", "experience", "salary", "agency", "contacted", "duplicate",
    ]);
  });
});
