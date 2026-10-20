import { describe, expect, it } from "vitest";
import { domainContainsKey, exclusionKey, findExcluded, sameCompany } from "../../src/matching/exclusions.js";

const excluded = ["Mograsys", "Acme Retail Tech", "Blue Ocean Systems"].map((n) => ({ company_name: n, company_key: exclusionKey(n) }));

describe("excluded-company matching", () => {
  it("normalises suffixes and punctuation", () => {
    expect(exclusionKey("Mograsys Technologies Pvt. Ltd.")).toBe("mograsys");
    expect(exclusionKey("Blue Ocean Systems India Private Limited")).toBe("blue ocean");
    expect(exclusionKey("Software Solutions")).toBe("software solutions"); // only suffixes → keep the name
  });

  it.each([
    ["Mograsys", "Mograsys Technologies Pvt Ltd"],
    ["Mograsys", "MOGRASYS"],
    ["Mograsys", "Mograsis"], // typo
    ["Mograsys", "Mogrsays Technologies"], // transposition
    ["Acme Retail Tech", "ACME Retail Tech Pvt. Ltd."],
    ["Blue Ocean Systems", "Blue Ocean"],
    ["Wipro", "Wipro Limited"],
  ])("%s ≈ %s", (a, b) => {
    expect(sameCompany(a, b)).toBe(true);
  });

  it.each([
    ["Nimbus Analytics", "Nimbus Logistics"],
    ["Infosys", "Infoedge"],
    ["Tata Consultancy Services", "Tata Motors"],
    ["Zoho", "Zomato"],
    ["Acme Retail Tech", "Acme Healthcare"],
  ])("%s is NOT %s", (a, b) => {
    expect(sameCompany(a, b)).toBe(false);
  });

  it("matches the application email's domain and the job URL's domain", () => {
    expect(domainContainsKey("hr@mograsys.com", "mograsys")).toBe(true);
    expect(domainContainsKey("https://careers.mograsys.in/jobs/1", "mograsys")).toBe(true);
    expect(domainContainsKey("jobs@acme-retail-tech.in", "acme retail tech")).toBe(true);
    expect(domainContainsKey("hr@kestrel.io", "mograsys")).toBe(false);
    expect(domainContainsKey("hr@abc.com", "ab")).toBe(false); // keys under 4 letters never match domains
  });

  it("finds exclusions by company, real employer, email or URL", () => {
    expect(findExcluded({ company: "Mograsys Tech Pvt Ltd" }, excluded)).toMatchObject({ company: "Mograsys", via: "company" });
    expect(findExcluded({ company: "Workline Careers", realEmployer: "Blue Ocean Systems" }, excluded)).toMatchObject({ company: "Blue Ocean Systems", via: "real_employer" });
    expect(findExcluded({ company: "Retail Careers Hub", email: "jobs@acmeretailtech.com" }, excluded)).toMatchObject({ via: "email" });
    expect(findExcluded({ company: "Hiring Desk", url: "https://careers.mograsys.in/x" }, excluded)).toMatchObject({ via: "url" });
    expect(findExcluded({ company: "Nimbus Analytics", email: "careers@nimbus.in", url: "https://nimbus.in" }, excluded)).toBeNull();
  });
});
