import { describe, expect, it } from "vitest";
import { SourceHttpError } from "../../src/jobs/errors.js";
import { isNetworkError } from "../../src/jobs/fetch.js";
import { dailyAllowance, quotaCycle } from "../../src/jobs/jsearch-budget.js";
import { classifyRapidApiRefusal, cleanJSearchKey } from "../../src/jobs/jsearch-key.js";
import type { Job } from "../../src/jobs/types.js";
import { screeningOrder } from "../../src/runs/runner.js";

const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("JSearch quota cycle", () => {
  it("runs from the reset day to the next one; days left count today", () => {
    expect(quotaCycle(ist("2026-11-02T09:00"), 1)).toEqual({ start: "2026-11-01", daysLeft: 29 });
    expect(quotaCycle(ist("2026-11-30T23:00"), 1)).toEqual({ start: "2026-11-01", daysLeft: 1 });
    expect(quotaCycle(ist("2026-11-21T09:00"), 25)).toEqual({ start: "2026-10-25", daysLeft: 4 });
    expect(quotaCycle(ist("2026-11-25T00:30"), 25)).toEqual({ start: "2026-11-25", daysLeft: 30 });
    // A reset day the month doesn't have falls on its last day.
    expect(quotaCycle(ist("2027-02-10T09:00"), 31)).toEqual({ start: "2027-01-31", daysLeft: 18 });
    expect(quotaCycle(ist("2027-03-01T09:00"), 31)).toEqual({ start: "2027-02-28", daysLeft: 30 });
  });

  it("each day gets what is left divided by the days left, at least 1 while anything is left", () => {
    expect(dailyAllowance(200, 0, 29)).toBe(6);
    expect(dailyAllowance(200, 150, 10)).toBe(5);
    expect(dailyAllowance(200, 199, 29)).toBe(1);
    expect(dailyAllowance(200, 200, 5)).toBe(0);
    expect(dailyAllowance(60, 20, 1)).toBe(40);
  });
});

describe("own RapidAPI key", () => {
  it("is cleaned from what people copy out of RapidAPI's code samples", () => {
    expect(cleanJSearchKey("  'x-rapidapi-key': 'abc123XYZ',")).toBe("abc123XYZ");
    expect(cleanJSearchKey('"X-RapidAPI-Key": "abc123XYZ"')).toBe("abc123XYZ");
    expect(cleanJSearchKey("X-RapidAPI-Key: abc123XYZ")).toBe("abc123XYZ");
    expect(cleanJSearchKey(" abc123XYZ ")).toBe("abc123XYZ");
  });

  it("tells 'not subscribed' apart from a wrong key (RapidAPI answers 403 for both)", () => {
    expect(classifyRapidApiRefusal(403, "JSearch error 403: You are not subscribed to this API.")).toBe("not_subscribed");
    expect(classifyRapidApiRefusal(403, "Invalid API key. Go to https://docs.rapidapi.com/docs/keys for more info.")).toBe("invalid");
    expect(classifyRapidApiRefusal(401, "")).toBe("invalid");
    expect(classifyRapidApiRefusal(500, "")).toBeNull();
  });
});

describe("retries and order", () => {
  it("a dropped connection or timeout counts as a network error; an HTTP answer doesn't", () => {
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkError(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(true);
    expect(isNetworkError(new Error("read ECONNRESET"))).toBe(true);
    expect(isNetworkError(new SourceHttpError("adzuna", 503, "Adzuna error 503"))).toBe(false);
    expect(isNetworkError(new Error("Unexpected token < in JSON"))).toBe(false);
  });

  it("postings with an application email are screened first, then the rest (close titles, then JSearch, within each)", () => {
    const job = (key: string, over: Partial<Job>): Job => ({
      key,
      source: "adzuna",
      title: "Engineer",
      company: key,
      location: "Pune",
      isRemote: false,
      description: "",
      url: "https://x",
      postedAt: null,
      salaryMinLpa: null,
      salaryMaxLpa: null,
      ...over,
    });
    const jobs = [
      job("no-email-close-jsearch", { title: "Product Manager", source: "jsearch" }),
      job("email-far", { description: "Send your CV to careers@far.in" }),
      job("no-email-far", {}),
      job("email-close", { title: "Senior Product Manager", description: "Apply: hr@close.in" }),
      job("email-far-jsearch", { source: "jsearch", description: "Email jobs@far2.in" }),
    ];
    expect(screeningOrder(jobs, ["Product Manager"]).map((j) => j.key)).toEqual([
      "email-close",
      "email-far-jsearch",
      "email-far",
      "no-email-close-jsearch",
      "no-email-far",
    ]);
  });
});
