"use client";

import type { ApiErrorDetails } from "@/lib/api-error";
import { localizeUsdtText } from "@/lib/currency/store";

/**
 * Error thrown by every client-side API call. Keeps the readable message for
 * the screen AND the technical cause for developers: HTTP status, endpoint,
 * the server's error details (MySQL code / SQL message / stack…), or the raw
 * response text when the server did not even return JSON (crash page, proxy
 * error, 404 HTML).
 */
export class ApiError extends Error {
  readonly status: number | null;
  readonly endpoint: string;
  readonly method: string;
  readonly details: ApiErrorDetails | null;
  /** Raw body snippet when the response was not JSON. */
  readonly rawBody: string | null;
  /** "http" = server answered with an error, "network" = request never completed, "parse" = bad response body. */
  readonly kind: "http" | "network" | "parse" | "app";

  constructor(init: {
    message: string;
    status?: number | null;
    endpoint: string;
    method?: string;
    details?: ApiErrorDetails | null;
    rawBody?: string | null;
    kind: ApiError["kind"];
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status ?? null;
    this.endpoint = init.endpoint;
    this.method = init.method ?? "GET";
    this.details = init.details ?? null;
    this.rawBody = init.rawBody ?? null;
    this.kind = init.kind;
  }
}

/** Technical lines describing any error — shown in the "Technical details" panel. */
export function technicalLines(error: unknown): string[] {
  if (error instanceof ApiError) {
    const d = error.details ?? {};
    const lines = [
      `Request: ${error.method} ${error.endpoint}`,
      error.status != null ? `HTTP status: ${error.status}` : `Failure type: ${error.kind}`,
      d.code ? `Code: ${d.code}${d.errno != null ? ` (errno ${d.errno})` : ""}${d.sqlState ? ` sqlState ${d.sqlState}` : ""}` : null,
      d.sqlMessage ? `SQL error: ${d.sqlMessage}` : null,
      d.sql ? `SQL: ${d.sql}` : null,
      d.name && d.detail ? `${d.name}: ${d.detail}` : d.detail ? `Detail: ${d.detail}` : null,
      ...(d.causes ?? []).map((cause) => `Caused by: ${cause}`),
      ...(d.stack ?? []).map((frame) => `  ${frame}`),
      d.timestamp ? `Server time: ${d.timestamp}` : null,
      error.rawBody ? `Response body: ${error.rawBody}` : null,
    ];
    return lines.filter((line): line is string => Boolean(line));
  }
  if (error instanceof Error) {
    return [`${error.name}: ${error.message}`, ...(error.stack ? error.stack.split("\n").slice(1, 6).map((l) => `  ${l.trim()}`) : [])];
  }
  return error == null ? [] : [String(error)];
}

/** Readable message for any thrown value. */
/** The error's own message, untouched (for technical details / copy). */
export function rawErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/** User-facing error text, with USDT amounts shown in the chosen display currency. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  return localizeUsdtText(rawErrorMessage(error, fallback));
}

function messageFromBody(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.error === "string" && body.error) return body.error;
  const err = body.error as Record<string, unknown> | undefined;
  if (err && typeof err.detail === "string") return err.detail;
  return null;
}

/**
 * Fetch JSON and throw an ApiError with the real cause on any failure.
 * Treats `{ success: false }` bodies as failures even with HTTP 200.
 */
export async function fetchJson<T = unknown>(input: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const endpoint = input.startsWith("http") ? new URL(input).pathname + new URL(input).search : input;
  let res: Response;
  try {
    res = await fetch(input, { cache: "no-store", ...init });
  } catch (cause) {
    const aborted = cause instanceof DOMException && cause.name === "AbortError";
    throw new ApiError({
      message: aborted
        ? `Request to ${endpoint} was cancelled or timed out`
        : `Could not reach the server (${errorMessage(cause, "network error")}). Check your connection or whether the server is running.`,
      endpoint,
      method,
      kind: "network",
      details: { name: cause instanceof Error ? cause.name : undefined, detail: errorMessage(cause, "network error") },
    });
  }

  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ApiError({
        message: res.ok
          ? `${endpoint} returned an invalid (non-JSON) response`
          : `${endpoint} failed with HTTP ${res.status} ${res.statusText} and returned a non-JSON page (the server likely crashed or the route does not exist)`,
        status: res.status,
        endpoint,
        method,
        kind: "parse",
        rawBody: text.replace(/\s+/g, " ").slice(0, 400),
      });
    }
  }

  if (!res.ok || body?.success === false) {
    const details = body && typeof body.error === "object" && body.error ? (body.error as ApiErrorDetails) : null;
    throw new ApiError({
      message: messageFromBody(body) ?? `${endpoint} failed with HTTP ${res.status} ${res.statusText}`,
      status: res.status,
      endpoint,
      method,
      kind: res.ok ? "app" : "http",
      details,
    });
  }
  return body as T;
}

/** fetchJson for the `{ success, data }` envelope used by this app's APIs: returns `data`. */
export async function fetchData<T = unknown>(input: string, init: RequestInit = {}): Promise<T> {
  const body = await fetchJson<{ data?: T } | null>(input, init);
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as unknown as T;
}
