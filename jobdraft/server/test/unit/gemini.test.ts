import { describe, expect, it } from "vitest";
import { orderModels } from "../../src/ai/gemini.js";

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
