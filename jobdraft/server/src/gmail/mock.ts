// In-memory Gmail for MOCK_EXTERNAL=true and tests: drafts, threads, sending,
// replies and bounces. It never contacts Google and never sends real email.
import crypto from "node:crypto";
import { config } from "../config/env.js";
import { clock } from "../lib/clock.js";
import { GmailAuthError } from "../lib/errors.js";
import { GMAIL_SCOPES, GmailNotFoundError, GmailRateLimitError, type GmailProvider, type ThreadMessage } from "./types.js";

interface MockMessage {
  id: string;
  threadId: string;
  token: string;
  labels: Set<string>;
  internalDate: number;
  headers: Record<string, string>;
  raw: string;
}

const id = (p: string) => `${p}${crypto.randomBytes(6).toString("hex")}`;

function headersOf(rawBase64Url: string): Record<string, string> {
  const text = Buffer.from(rawBase64Url, "base64url").toString("utf8");
  const head = text.split("\r\n\r\n")[0] ?? "";
  const out: Record<string, string> = {};
  for (const line of head.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

export const mockGmail = {
  messages: new Map<string, MockMessage>(),
  drafts: new Map<string, { messageId: string; token: string }>(),
  revoked: new Set<string>(),
  invalidTokens: new Set<string>(),
  rateLimitedTokens: new Set<string>(),
  /** Number of upcoming sendDraft calls that fail with a server error. */
  failSends: 0,
  sendCalls: 0,
  nextEmail: "mock.user@gmail.com",
  nextScopes: GMAIL_SCOPES as string[],

  reset() {
    this.messages.clear();
    this.drafts.clear();
    this.revoked.clear();
    this.invalidTokens.clear();
    this.rateLimitedTokens.clear();
    this.failSends = 0;
    this.sendCalls = 0;
    this.nextEmail = "mock.user@gmail.com";
    this.nextScopes = GMAIL_SCOPES;
  },

  thread(threadId: string): MockMessage[] {
    return [...this.messages.values()].filter((m) => m.threadId === threadId).sort((a, b) => a.internalDate - b.internalDate);
  },

  sentCount(token?: string): number {
    return [...this.messages.values()].filter((m) => m.labels.has("SENT") && (!token || m.token === token)).length;
  },

  /** Simulates the user pressing Send on a draft in Gmail. */
  userSendsDraft(draftId: string) {
    const d = this.drafts.get(draftId);
    if (!d) throw new Error("no such draft");
    const m = this.messages.get(d.messageId)!;
    m.labels = new Set(["SENT"]);
    m.internalDate = clock.now().getTime();
    this.drafts.delete(draftId);
  },

  /** Simulates the user deleting a draft in Gmail. */
  userDeletesDraft(draftId: string) {
    const d = this.drafts.get(draftId);
    if (!d) return;
    this.messages.delete(d.messageId);
    this.drafts.delete(draftId);
  },

  /** An incoming message in the thread (a reply, or a bounce from mailer-daemon). */
  receive(threadId: string, from: string, subject = "Re: your application") {
    const first = this.thread(threadId)[0];
    if (!first) throw new Error("no such thread");
    const msgId = id("m");
    this.messages.set(msgId, {
      id: msgId,
      threadId,
      token: first.token,
      labels: new Set(["INBOX", "UNREAD"]),
      internalDate: clock.now().getTime(),
      headers: { from, subject, "message-id": `<${msgId}@mail.example-sender.net>`, "in-reply-to": first.headers["message-id"] ?? "" },
      raw: "",
    });
  },

  reply(threadId: string, from = "Priya HR <hr@company.in>") {
    this.receive(threadId, from, "Re: Application");
  },

  bounce(threadId: string) {
    this.receive(threadId, "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "Delivery Status Notification (Failure)");
  },
};

function guard(token: string) {
  if (mockGmail.invalidTokens.has(token) || mockGmail.revoked.has(token)) throw new GmailAuthError();
}

export const mockProvider: GmailProvider = {
  authUrl(state) {
    const redirect = new URL(config().google.redirectUri);
    redirect.searchParams.set("code", "mock-auth-code");
    redirect.searchParams.set("state", state);
    return redirect.toString();
  },
  async exchangeCode(code) {
    if (code !== "mock-auth-code") throw new Error("invalid code");
    return { refreshToken: `mock-refresh-${crypto.randomBytes(8).toString("hex")}`, email: mockGmail.nextEmail, scopes: [...mockGmail.nextScopes] };
  },
  async createDraft(token, raw, threadId) {
    guard(token);
    const messageId = id("m");
    const thread = threadId ?? id("t");
    mockGmail.messages.set(messageId, { id: messageId, threadId: thread, token, labels: new Set(["DRAFT"]), internalDate: clock.now().getTime(), headers: headersOf(raw), raw });
    const draftId = id("r-");
    mockGmail.drafts.set(draftId, { messageId, token });
    return { draftId, messageId, threadId: thread };
  },
  async sendDraft(token, draftId) {
    guard(token);
    mockGmail.sendCalls++;
    if (mockGmail.rateLimitedTokens.has(token)) throw new GmailRateLimitError();
    if (mockGmail.failSends > 0) {
      mockGmail.failSends--;
      throw Object.assign(new Error("Backend Error"), { status: 500 });
    }
    const d = mockGmail.drafts.get(draftId);
    if (!d || d.token !== token) throw new GmailNotFoundError();
    mockGmail.userSendsDraft(draftId);
    const m = mockGmail.messages.get(d.messageId)!;
    return { messageId: m.id, threadId: m.threadId };
  },
  async draftExists(token, draftId) {
    guard(token);
    return mockGmail.drafts.get(draftId)?.token === token;
  },
  async deleteDraft(token, draftId) {
    guard(token);
    if (mockGmail.drafts.get(draftId)?.token === token) mockGmail.userDeletesDraft(draftId);
  },
  async getThread(token, threadId): Promise<ThreadMessage[] | null> {
    guard(token);
    const msgs = mockGmail.thread(threadId).filter((m) => m.token === token);
    if (!msgs.length) return null;
    return msgs.map((m) => ({ id: m.id, labelIds: [...m.labels], internalDate: m.internalDate, headers: { ...m.headers } }));
  },
  async revoke(token) {
    mockGmail.revoked.add(token);
  },
};
