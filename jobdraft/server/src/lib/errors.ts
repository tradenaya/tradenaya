/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class NotConfiguredError extends HttpError {
  constructor(what: string) {
    super(503, `${what} is not configured on the server yet.`, "not_configured");
    this.name = "NotConfiguredError";
  }
}

/** Google refused the stored refresh token (revoked, expired, or app in testing mode). */
export class GmailAuthError extends Error {
  constructor(message = "Gmail access expired — please reconnect") {
    super(message);
    this.name = "GmailAuthError";
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
