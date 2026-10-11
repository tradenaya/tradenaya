/**
 * Shared API error responses.
 *
 * Every failed API call returns:
 *   { success: false, message: "<readable message>", error: { ...technical details } }
 *
 * `message` is what the screen shows; `error` carries the real cause (MySQL
 * code + SQL message, exchange error text, error type, cause chain, top of the
 * stack, which endpoint) so a developer can see exactly what broke — e.g.
 * "ER_NO_SUCH_TABLE: Table 'tradenaya.automation_x' doesn't exist" instead of
 * "something went wrong".
 *
 * Set API_ERROR_DETAILS=off to stop sending technical details to browsers
 * (they are always logged on the server either way).
 */

export interface ApiErrorDetails {
  /** Error class / type, e.g. "Error", "TypeError", "AbortError". */
  name?: string;
  /** Raw technical message of the underlying error. */
  detail?: string;
  /** Machine code, e.g. MySQL "ER_NO_SUCH_TABLE", Node "ECONNREFUSED". */
  code?: string;
  errno?: number;
  sqlState?: string;
  /** Exact MySQL message, e.g. "Unknown column 'x' in 'field list'". */
  sqlMessage?: string;
  /** Beginning of the failing SQL statement (truncated). */
  sql?: string;
  /** Messages of nested `cause` errors, outermost first. */
  causes?: string[];
  /** First lines of the stack trace. */
  stack?: string[];
  /** API route / operation that failed. */
  endpoint?: string;
  /** HTTP status returned. */
  status?: number;
  /** ISO time of the failure, to match against server logs. */
  timestamp?: string;
}

/**
 * An expected, typed API failure (e.g. not signed in, account not connected).
 * errorResponse() answers with its own status and code instead of a 500.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function detailsEnabled(): boolean {
  return String(process.env.API_ERROR_DETAILS ?? "on").toLowerCase() !== "off";
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Extract every useful technical field from an unknown thrown value. */
export function describeError(error: unknown): { message: string; details: ApiErrorDetails } {
  if (error == null) return { message: "Unknown error (nothing was thrown)", details: {} };
  if (typeof error === "string") return { message: error, details: { detail: error } };
  if (typeof error !== "object") return { message: String(error), details: { detail: String(error) } };

  const e = error as Record<string, unknown> & { message?: unknown; stack?: unknown; cause?: unknown; name?: unknown };
  const details: ApiErrorDetails = {};
  details.name = str(e.name) ?? (error as object).constructor?.name;
  details.detail = str(e.message);
  if (str(e.code) || typeof e.code === "number") details.code = String(e.code);
  if (typeof e.errno === "number") details.errno = e.errno;
  details.sqlState = str(e.sqlState);
  details.sqlMessage = str(e.sqlMessage);
  const sql = str(e.sql);
  if (sql) details.sql = sql.length > 300 ? `${sql.slice(0, 300)}…` : sql;

  const causes: string[] = [];
  let cause = e.cause;
  for (let depth = 0; cause != null && depth < 5; depth++) {
    if (typeof cause === "object") {
      const c = cause as Record<string, unknown>;
      const text = [str(c.code as string), str(c.message as string)].filter(Boolean).join(": ");
      if (text) causes.push(text);
      cause = c.cause;
    } else {
      causes.push(String(cause));
      break;
    }
  }
  if (causes.length) details.causes = causes;

  const stack = str(e.stack);
  if (stack) details.stack = stack.split("\n").slice(1, 6).map((line) => line.trim()).filter(Boolean);

  // mysql2 marks connection-level failures as fatal; "connect ETIMEDOUT" alone
  // doesn't tell anyone the database is the thing that's unreachable.
  const dbUnreachable = e.fatal === true && /^(ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|PROTOCOL_CONNECTION_LOST)$/.test(details.code ?? "");
  const message = details.sqlMessage
    ? `Database error${details.code ? ` (${details.code})` : ""}: ${details.sqlMessage}`
    : dbUnreachable
      ? `The server can't reach its database (${details.code}). Check that the database is running and reachable from the server, then try again.`
      : details.detail ?? (details.code ? `Error ${details.code}` : "Unknown error");
  return { message, details };
}

/**
 * Build the JSON error response for a caught error. `fallback` is used only
 * when the error carries no message of its own.
 */
export function errorResponse(error: unknown, status = 500, fallback = "Request failed", endpoint?: string): Response {
  const { message, details } = describeError(error);
  // Expected failures carry their own status (401 not signed in, 400 not connected…).
  if (error instanceof HttpError) status = error.status;
  if (error instanceof HttpError && status < 500) console.warn(`[api-error]${endpoint ? ` ${endpoint}` : ""} ${status} ${error.code}: ${error.message}`);
  else console.error(`[api-error]${endpoint ? ` ${endpoint}` : ""}`, error);
  const readable = message && message !== "Unknown error" ? message : fallback;
  const body: Record<string, unknown> = { success: false, message: readable };
  if (detailsEnabled()) {
    body.error = { ...details, endpoint, status, timestamp: new Date().toISOString() } satisfies ApiErrorDetails;
  }
  return Response.json(body, { status });
}
