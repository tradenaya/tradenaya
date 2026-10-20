// Structured JSON logs. Callers pass ids and counts only — never names, emails,
// tokens, resume text or other personal data.
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "error" : "info")) as Level;
  return order[lvl] ?? order.info;
}

const SECRET_KEYS = /pass|secret|token|key|authorization|cookie|email|phone|resume_text/i;

function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEYS.test(k) && k !== "keys") out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...scrub(fields) });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};

/** Short, safe description of an unknown error for logs (no stack, no payloads). */
export function errInfo(err: unknown): { name: string; message: string; code?: string | number } {
  if (err instanceof Error) {
    const code = (err as { code?: string | number }).code;
    return { name: err.name, message: err.message.slice(0, 300), ...(code !== undefined ? { code } : {}) };
  }
  // Some SDKs (e.g. Cloudinary) reject with plain objects like { message, http_code }.
  if (err && typeof err === "object") {
    const o = err as { name?: unknown; message?: unknown; http_code?: unknown; code?: unknown; error?: { message?: unknown } };
    const message = typeof o.message === "string" ? o.message : typeof o.error?.message === "string" ? o.error.message : safeJson(o);
    const code = [o.http_code, o.code].find((c): c is string | number => typeof c === "string" || typeof c === "number");
    return { name: typeof o.name === "string" ? o.name : "Unknown", message: message.slice(0, 300), ...(code !== undefined ? { code } : {}) };
  }
  return { name: "Unknown", message: String(err).slice(0, 300) };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
