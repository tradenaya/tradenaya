import { describe, expect, it } from "vitest";
import { isNetworkError, isQuotaError, orderModels, quotaCooldownMs } from "../../src/ai/gemini.js";
import { errInfo } from "../../src/lib/logger.js";

describe("orderModels", () => {
  const models = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.8-flash", "gemini-3.5-flash-lite"];

  it("keeps the configured order for normal requests", () => {
    expect(orderModels(models)).toEqual(models);
  });

  it("puts the lite models first for fast requests, keeping relative order", () => {
    expect(orderModels(models, true)).toEqual(["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.8-flash"]);
  });

  it("works when no lite model is configured", () => {
    expect(orderModels(["gemini-flash-latest"], true)).toEqual(["gemini-flash-latest"]);
  });
});

describe("gemini error kinds", () => {
  const quotaDay = Object.assign(new Error('{"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}'), { status: 429 });
  const quotaMinute = Object.assign(new Error("You exceeded your current quota (GenerateRequestsPerMinutePerProjectPerModel)"), { status: 429 });
  const slowDown = Object.assign(new Error("Resource has been exhausted, try again"), { status: 429 });

  it("tells a used-up quota from a short 'slow down'", () => {
    expect(isQuotaError(quotaDay)).toBe(true);
    expect(isQuotaError(quotaMinute)).toBe(true);
    expect(isQuotaError(slowDown)).toBe(false);
    expect(isQuotaError(Object.assign(new Error("quota"), { status: 503 }))).toBe(false);
  });

  it("skips a model for an hour on a daily limit, a minute on a per-minute one", () => {
    expect(quotaCooldownMs(quotaDay)).toBe(60 * 60_000);
    expect(quotaCooldownMs(quotaMinute)).toBe(60_000);
  });

  it("treats 'fetch failed' as a network blip", () => {
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("boom"), { status: 400 }))).toBe(false);
  });
});

describe("errInfo", () => {
  it("shows plain-object errors (e.g. from Cloudinary) instead of [object Object]", () => {
    expect(errInfo({ message: "Invalid Signature abc", http_code: 401 })).toEqual({ name: "Unknown", message: "Invalid Signature abc", code: 401 });
    expect(errInfo({ error: { message: "Request Timeout" } })).toMatchObject({ message: "Request Timeout" });
    expect(errInfo({ weird: true })).toMatchObject({ message: '{"weird":true}' });
  });
});
