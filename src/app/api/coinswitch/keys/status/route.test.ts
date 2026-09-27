import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setExpiryForUserMock, getKeyMetaForUserMock, getCustomerFromRequestMock } = vi.hoisted(() => ({
  setExpiryForUserMock: vi.fn(),
  getKeyMetaForUserMock: vi.fn(),
  getCustomerFromRequestMock: vi.fn(),
}));

vi.mock("@/lib/coinswitch.store", () => ({
  setExpiryForUser: setExpiryForUserMock,
  getKeyMetaForUser: getKeyMetaForUserMock,
}));

vi.mock("@/lib/auth", () => ({ getCustomerFromRequest: getCustomerFromRequestMock }));

import { PATCH } from "./route";

const req = (body: unknown) =>
  new Request("http://localhost/api/coinswitch/keys/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

beforeEach(() => {
  getCustomerFromRequestMock.mockReturnValue({ customerId: 42 });
  setExpiryForUserMock.mockResolvedValue(undefined);
  getKeyMetaForUserMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/coinswitch/keys/status", () => {
  it("saves the exact 24h datetime-local literal the picker produced", async () => {
    const res = await PATCH(req({ validUntil: "2026-10-18T20:54" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(setExpiryForUserMock).toHaveBeenCalledOnce();
    expect(setExpiryForUserMock).toHaveBeenCalledWith(42, "2026-10-18T20:54");
  });

  it("rejects a half-typed time instead of silently saving a wrong value", async () => {
    const res = await PATCH(req({ validUntil: "2026-10-18T20" }));

    expect(res.status).toBe(400);
    expect(setExpiryForUserMock).not.toHaveBeenCalled();
  });

  it("rejects a non-padded literal that the picker would never emit", async () => {
    const res = await PATCH(req({ validUntil: "2026-1-5T6:07" }));

    expect(res.status).toBe(400);
    expect(setExpiryForUserMock).not.toHaveBeenCalled();
  });

  it("rejects a missing expiry without touching the database", async () => {
    const res = await PATCH(req({}));

    expect(res.status).toBe(400);
    expect(setExpiryForUserMock).not.toHaveBeenCalled();
  });

  it("rejects an unparseable expiry without touching the database", async () => {
    const res = await PATCH(req({ validUntil: "not-a-time" }));

    expect(res.status).toBe(400);
    expect(setExpiryForUserMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range hour instead of silently shifting it", async () => {
    const res = await PATCH(req({ validUntil: "2026-10-18T29:54" }));

    expect(res.status).toBe(400);
    expect(setExpiryForUserMock).not.toHaveBeenCalled();
  });

  it("never saves for an unauthenticated request", async () => {
    getCustomerFromRequestMock.mockReturnValue(null);

    const res = await PATCH(req({ validUntil: "2026-10-18T20:54" }));

    expect(res.status).toBe(401);
    expect(setExpiryForUserMock).not.toHaveBeenCalled();
  });
});
