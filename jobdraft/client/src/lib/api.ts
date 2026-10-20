export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5055").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
    public code?: string,
  ) {
    super(message);
  }
}

type Body = Record<string, unknown> | FormData | undefined;

/** Calls the JobDraft API with the session cookie. Throws ApiError with a user-safe message. */
export async function api<T>(path: string, opts: { method?: string; body?: Body; signal?: AbortSignal } = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      credentials: "include",
      headers: opts.body && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the JobDraft server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string>; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.error || proxyMessage(res.status), data.fields ?? {}, data.code);
  return data as T;
}

/** Errors without a JSON body come from the proxy in front of the API, not from JobDraft itself. */
function proxyMessage(status: number): string {
  if (status === 413) return "This file is too large for the server to accept.";
  if (status === 502 || status === 503) return "JobDraft is restarting or unavailable. Please try again in a minute.";
  if (status === 504) return "The server took too long to respond. Please try again in a minute.";
  return "Something went wrong. Please try again.";
}

export const errorMessage =(err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
