import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchData, fetchJson, technicalLines } from "./api-client";

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("throws ApiError carrying the server's technical details", async () => {
    mockFetch(async () =>
      Response.json(
        { success: false, message: "Database error (ER_BAD_FIELD_ERROR): Unknown column 'x'", error: { code: "ER_BAD_FIELD_ERROR", sqlMessage: "Unknown column 'x'" } },
        { status: 500 },
      ),
    );
    const err = await fetchJson<never>("/api/bots").catch((e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toContain("Unknown column 'x'");
    expect(technicalLines(err)).toContain("SQL error: Unknown column 'x'");
  });

  it("explains a non-JSON crash page instead of failing to parse", async () => {
    mockFetch(async () => new Response("<html>Internal Server Error</html>", { status: 502, statusText: "Bad Gateway" }));
    const err = await fetchJson<never>("/api/orders").catch((e: unknown) => e as ApiError);
    expect(err.kind).toBe("parse");
    expect(err.message).toContain("HTTP 502");
    expect(err.rawBody).toContain("Internal Server Error");
  });

  it("reports a network failure clearly", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await fetchJson<never>("/api/bots").catch((e: unknown) => e as ApiError);
    expect(err.kind).toBe("network");
    expect(err.message).toContain("Could not reach the server");
  });

  it("treats success:false with HTTP 200 as a failure", async () => {
    mockFetch(async () => Response.json({ success: false, message: "Daily loss limit reached" }));
    await expect(fetchJson("/api/bots")).rejects.toThrow("Daily loss limit reached");
  });

  it("fetchData returns data, including a legitimate null", async () => {
    mockFetch(async () => Response.json({ success: true, data: null }));
    await expect(fetchData("/api/x")).resolves.toBeNull();
  });
});
