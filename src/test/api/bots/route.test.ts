import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduler = vi.hoisted(() => ({
  bots: [] as Array<{ capitalMode: "fixed" | "percent"; walletPercent?: number }>,
  startBot: vi.fn(async () => ({ botId: 42 })),
}));

vi.mock("@/lib/auth", () => ({ getCustomerFromRequest: () => ({ customerId: 7, email: null }) }));
vi.mock("@/automation/scheduler/BotScheduler", () => ({
  botScheduler: {
    listBots: async () => scheduler.bots,
    startBot: scheduler.startBot,
    ensureStarted: async () => undefined,
    isRunning: () => true,
  },
}));

import { POST } from "@/app/api/bots/route";

function create(walletPercent: number) {
  const req = new Request("http://test/api/bots", {
    method: "POST",
    body: JSON.stringify({ symbol: "BTCUSDT", timeframe: "1h", leverage: 5, capitalMode: "percent", walletPercent }),
  });
  return POST(req as never);
}

beforeEach(() => {
  scheduler.bots = [];
  scheduler.startBot.mockClear();
});

describe("POST /api/bots wallet %", () => {
  it("accepts 100% when no other bot uses the wallet (scheduler caps it to the safe share)", async () => {
    const res = await create(100);
    expect(res.status).toBe(200);
    expect(scheduler.startBot).toHaveBeenCalledOnce();
  });

  it("accepts exactly the remaining share", async () => {
    scheduler.bots = [{ capitalMode: "percent", walletPercent: 40 }, { capitalMode: "fixed" }];
    expect((await create(60)).status).toBe(200);
  });

  it("rejects going over 100% and says how much is left", async () => {
    scheduler.bots = [{ capitalMode: "percent", walletPercent: 40 }];
    const res = await create(70);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/at most 60% is left/);
    expect(scheduler.startBot).not.toHaveBeenCalled();
  });

  it("rejects when other bots already use the whole wallet", async () => {
    scheduler.bots = [{ capitalMode: "percent", walletPercent: 100 }];
    const res = await create(10);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/already use 100%/);
  });
});
