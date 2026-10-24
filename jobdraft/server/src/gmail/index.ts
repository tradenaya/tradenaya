import { google } from "googleapis";
import { config, features } from "../config/env.js";
import { GmailAuthError, NotConfiguredError, sleep } from "../lib/errors.js";
import { mockProvider } from "./mock.js";
import { GMAIL_SCOPES, GmailNotFoundError, GmailRateLimitError, type GmailProvider, type ThreadMessage } from "./types.js";

export * from "./types.js";
export { mockGmail } from "./mock.js";

// googleapis has no request timeout by default: a stalled connection could hang
// a run (and the scheduler) forever.
google.options({ timeout: 60_000 });

const METADATA_HEADERS = ["From", "Date", "Message-ID", "In-Reply-To", "Subject"];
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded"]);

function oauthClient() {
  const g = config().google;
  return new google.auth.OAuth2(g.clientId, g.clientSecret, g.redirectUri);
}

function gmailFor(refreshToken: string) {
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

interface ApiErr {
  message?: string;
  status?: number;
  code?: number | string;
  response?: { status?: number; data?: { error?: string | { errors?: { reason?: string }[] } } };
  errors?: { reason?: string }[];
}

function statusOf(err: unknown): number {
  const e = err as ApiErr;
  return e?.response?.status ?? e?.status ?? (typeof e?.code === "number" ? e.code : 0);
}

/** Maps googleapis errors onto the few cases JobDraft handles differently. */
function classify(err: unknown): Error {
  const e = err as ApiErr;
  const data = e?.response?.data?.error;
  if (data === "invalid_grant" || /invalid_grant|Token has been expired or revoked|unauthorized_client/i.test(e?.message ?? "")) return new GmailAuthError();
  const reasons = [...(e?.errors ?? []), ...(typeof data === "object" ? (data?.errors ?? []) : [])].map((r) => r?.reason ?? "");
  const status = statusOf(err);
  if (status === 429 || reasons.some((r) => RATE_REASONS.has(r))) return new GmailRateLimitError();
  if (status === 401) return new GmailAuthError();
  if (status === 404) return new GmailNotFoundError();
  return err instanceof Error ? err : new Error(String(err));
}

async function call<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (raw) {
      const err = classify(raw);
      // Retry transient server errors only; never auth, rate-limit or not-found.
      if (!(err instanceof GmailAuthError || err instanceof GmailRateLimitError || err instanceof GmailNotFoundError) && statusOf(raw) >= 500 && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

const googleGmail: GmailProvider = {
  authUrl(state) {
    return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GMAIL_SCOPES, state, include_granted_scopes: false });
  },
  async exchangeCode(code) {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new Error("Google did not return an ID token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config().google.clientId });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified === false) throw new Error("Google account email is not verified");
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token");
    return { refreshToken: tokens.refresh_token, email: payload.email.toLowerCase(), scopes: (tokens.scope ?? "").split(" ").filter(Boolean) };
  },
  async createDraft(token, raw, threadId) {
    const res = await call(() => gmailFor(token).users.drafts.create({ userId: "me", requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } } }));
    const d = res.data;
    if (!d.id || !d.message?.id || !d.message.threadId) throw new Error("Gmail returned an incomplete draft");
    return { draftId: d.id, messageId: d.message.id, threadId: d.message.threadId };
  },
  async sendDraft(token, draftId) {
    // No automatic retry here: a timeout could mean it was sent. The queue decides.
    const res = await call(() => gmailFor(token).users.drafts.send({ userId: "me", requestBody: { id: draftId } }), 0);
    if (!res.data.id || !res.data.threadId) throw new Error("Gmail returned no message id");
    return { messageId: res.data.id, threadId: res.data.threadId };
  },
  async draftExists(token, draftId) {
    try {
      await call(() => gmailFor(token).users.drafts.get({ userId: "me", id: draftId, format: "minimal" }));
      return true;
    } catch (err) {
      if (err instanceof GmailNotFoundError) return false;
      throw err;
    }
  },
  async deleteDraft(token, draftId) {
    try {
      await call(() => gmailFor(token).users.drafts.delete({ userId: "me", id: draftId }));
    } catch (err) {
      if (!(err instanceof GmailNotFoundError)) throw err;
    }
  },
  async getThread(token, threadId): Promise<ThreadMessage[] | null> {
    try {
      // Headers only — gmail.metadata never exposes bodies (and doesn't allow search).
      const res = await call(() => gmailFor(token).users.threads.get({ userId: "me", id: threadId, format: "metadata", metadataHeaders: METADATA_HEADERS }));
      return (res.data.messages ?? []).map((m) => ({
        id: m.id ?? "",
        labelIds: m.labelIds ?? [],
        internalDate: Number(m.internalDate ?? 0),
        headers: Object.fromEntries((m.payload?.headers ?? []).map((h) => [String(h.name).toLowerCase(), String(h.value ?? "")])),
      }));
    } catch (err) {
      if (err instanceof GmailNotFoundError) return null;
      throw err;
    }
  },
  async revoke(token) {
    await oauthClient().revokeToken(token);
  },
};

export function gmail(): GmailProvider {
  if (config().mockExternal) return mockProvider;
  if (!features().gmail) throw new NotConfiguredError("Google sign-in (Gmail)");
  return googleGmail;
}
