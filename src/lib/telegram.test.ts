import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTelegramConfigured, sendTelegram, sendTelegramAsync } from "./telegram";

interface MockOptions extends Record<string, unknown> {
  hostname?: string;
  port?: number;
  path?: string;
  method?: string;
  servername?: string;
  rejectUnauthorized?: boolean;
  agent?: { options?: { family?: number } };
}

interface HttpCall {
  options: MockOptions;
  body: string;
  respond: (status: number, payload: unknown) => void;
  triggerTimeout: () => void;
}

type ResponseDef = { status: number; body: unknown };

const state = vi.hoisted(() => {
  const calls: HttpCall[] = [];
  let queue: ResponseDef[] = [];
  return {
    calls,
    reset(): void {
      calls.length = 0;
      queue = [];
    },
    queueResponses(...responses: ResponseDef[]): void {
      queue = responses;
    },
    consume(): ResponseDef | undefined {
      return queue.shift();
    },
  };
});

vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();

  function makeEmitter() {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
      on(event: string, cb: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(cb);
        return this;
      },
      emit(event: string, ...args: unknown[]) {
        for (const cb of listeners[event] ?? []) cb(...args);
        return true;
      },
    };
  }

  const request = vi.fn((options: MockOptions, onResponse: (res: unknown) => void) => {
    const res = makeEmitter();

    const call: HttpCall = {
      options,
      body: "",
      respond: () => {
        /* assigned below */
      },
      triggerTimeout: () => {
        /* assigned below */
      },
    };

    let responded = false;
    call.respond = (status, payload) => {
      if (responded) return;
      responded = true;
      (res as { statusCode?: number }).statusCode = status;
      onResponse(res);
      setImmediate(() => {
        res.emit("data", Buffer.from(JSON.stringify(payload)));
        res.emit("end");
      });
    };

    const req = makeEmitter();
    let timeoutCb: (() => void) | null = null;
    (req as { setTimeout?: unknown }).setTimeout = (_ms: number, cb: () => void) => {
      timeoutCb = cb;
      return req;
    };
    (req as { write?: unknown }).write = (chunk: string) => {
      call.body += chunk;
    };
    (req as { end?: unknown }).end = () => {
      /* no-op */
    };
    (req as { destroy?: unknown }).destroy = (err?: Error) => {
      req.emit("error", err ?? new Error("destroyed"));
    };
    call.triggerTimeout = () => {
      timeoutCb?.();
    };

    state.calls.push(call);

    const queued = state.consume();
    if (queued) call.respond(queued.status, queued.body);
    return req;
  });

  const mockModule = {
    ...actual,
    request,
    Agent: actual.Agent,
  };
  return {
    ...mockModule,
    default: mockModule,
  };
});

describe("telegram IPv4 HTTPS delivery", () => {
  beforeEach(() => {
    state.reset();
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it("posts to api.telegram.org over an IPv4-only agent without disabling TLS verification", async () => {
    state.queueResponses({ status: 200, body: { ok: true, result: { message_id: 1 } } });

    const result = await sendTelegram("hello");

    expect(result).toEqual({ ok: true });
    expect(state.calls).toHaveLength(1);
    const call = state.calls[0]!;
    expect(call.options.hostname).toBe("api.telegram.org");
    expect(call.options.port).toBe(443);
    expect(call.options.method).toBe("POST");
    expect(call.options.path).toContain("/bot");
    expect(call.options.path).toContain("/sendMessage");
    expect(call.options.servername).toBe("api.telegram.org");
    expect(call.options.rejectUnauthorized).toBeUndefined();
    expect(call.options.agent?.options?.family).toBe(4);

    const body = JSON.parse(call.body) as Record<string, unknown>;
    expect(body.chat_id).toBe("12345");
    expect(body.text).toBe("hello");
    expect(body.parse_mode).toBe("HTML");
    expect(JSON.stringify(body)).not.toContain("test-token");
  });

  it("retries HTTP 429 once respecting retry_after and succeeds", async () => {
    state.queueResponses(
      { status: 429, body: { ok: false, retry_after: 0, description: "Too Many Requests" } },
      { status: 200, body: { ok: true } },
    );

    const result = await sendTelegram("hello");

    expect(result).toEqual({ ok: true });
    expect(state.calls).toHaveLength(2);
  });

  it("retries HTTP 500 up to 4 attempts then gives up", async () => {
    state.queueResponses(
      { status: 500, body: { ok: false, retry_after: 0, description: "Internal Server Error" } },
      { status: 500, body: { ok: false, retry_after: 0, description: "Internal Server Error" } },
      { status: 500, body: { ok: false, retry_after: 0, description: "Internal Server Error" } },
      { status: 500, body: { ok: false, retry_after: 0, description: "Internal Server Error" } },
    );

    const result = await sendTelegram("hello");

    expect(result).toEqual({ ok: false, error: "max_attempts" });
    expect(state.calls).toHaveLength(4);
  });

  it("retries HTTP 400 once without parse_mode and succeeds as plain text", async () => {
    state.queueResponses(
      { status: 400, body: { ok: false, error_code: 400, description: "can't parse entities" } },
      { status: 200, body: { ok: true } },
    );

    const result = await sendTelegram("hello");

    expect(result).toEqual({ ok: true });
    expect(state.calls).toHaveLength(2);
    const retryBody = JSON.parse(state.calls[1]!.body) as Record<string, unknown>;
    expect(retryBody.parse_mode).toBeUndefined();
  });

  it("returns a useful error for API failures with ok=false", async () => {
    state.queueResponses({ status: 200, body: { ok: false, description: "chat not found" } });

    const result = await sendTelegram("hello");

    expect(result).toEqual({ ok: false, error: "chat not found" });
  });

  it("aborts cleanly on socket timeout with a non-throwing error result", async () => {
    const pending = sendTelegram("hello");

    state.calls[0]!.triggerTimeout();
    const result = await pending;

    expect(state.calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("is a silent no-op when not configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    expect(isTelegramConfigured()).toBe(false);

    const result = await sendTelegram("hello");
    expect(result).toEqual({ ok: false, error: "not_configured" });
    expect(state.calls).toHaveLength(0);
  });

  it("sendTelegramAsync never rethrows into the trading path", async () => {
    state.queueResponses({ status: 200, body: { ok: false, description: "chat not found" } });

    sendTelegramAsync("hello");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(state.calls).toHaveLength(1);
  });
});