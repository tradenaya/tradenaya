export const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
export const GMAIL_METADATA = "https://www.googleapis.com/auth/gmail.metadata";
export const GMAIL_SCOPES = ["openid", "email", GMAIL_COMPOSE, GMAIL_METADATA];
/** Both are needed: compose creates/sends drafts, metadata reads headers to track replies. */
export const REQUIRED_SCOPES = [GMAIL_COMPOSE, GMAIL_METADATA];

export interface DraftRef {
  draftId: string;
  messageId: string;
  threadId: string;
}

/** One message of a thread, headers only (format: "metadata"). */
export interface ThreadMessage {
  id: string;
  labelIds: string[];
  internalDate: number;
  /** lowercased header names: from, date, message-id, in-reply-to, subject */
  headers: Record<string, string>;
}

export interface GmailProvider {
  authUrl(state: string): string;
  /** Exchanges the OAuth code. Scopes are returned (not enforced) so missing ones can be reported. */
  exchangeCode(code: string): Promise<{ refreshToken: string; email: string; scopes: string[] }>;
  createDraft(refreshToken: string, rawBase64Url: string, threadId?: string): Promise<DraftRef>;
  /** Sends an existing draft exactly as it is. */
  sendDraft(refreshToken: string, draftId: string): Promise<{ messageId: string; threadId: string }>;
  draftExists(refreshToken: string, draftId: string): Promise<boolean>;
  deleteDraft(refreshToken: string, draftId: string): Promise<void>;
  /** Thread messages (headers only), or null if the thread no longer exists. */
  getThread(refreshToken: string, threadId: string): Promise<ThreadMessage[] | null>;
  revoke(refreshToken: string): Promise<void>;
}

/** Gmail said "slow down" (429 / rateLimitExceeded / userRateLimitExceeded / dailyLimitExceeded). */
export class GmailRateLimitError extends Error {
  constructor(message = "Gmail sending limit reached") {
    super(message);
    this.name = "GmailRateLimitError";
  }
}

/** The draft doesn't exist any more (sent or deleted by the user). */
export class GmailNotFoundError extends Error {
  constructor(message = "Not found in Gmail") {
    super(message);
    this.name = "GmailNotFoundError";
  }
}
