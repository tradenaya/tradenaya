"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound, ShieldCheck, AlertTriangle, ArrowLeft } from "lucide-react";
import DatePicker from "react-datepicker";
import { TimePicker24 } from "@/components/ui/time-picker";
import { buildExpiryLiteral } from "@/lib/time-literal";

type MessageState = {
  text: string;
  type: "success" | "error";
} | null;

interface KeyStatus {
  connected: boolean;
  apiKeyMasked?: string | null;
  createdAt?: string;
  validUntil?: string | null;
  daysLeft?: number | null;
  status?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${date}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local calendar day of a Date, as a "YYYY-MM-DD" literal. */
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local wall-clock time of a Date, as a 24-hour "HH:mm" literal. */
function toTimeInputValue(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Extract a human-readable message from a thrown value, never logging payload contents. */
function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function ConnectPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [expiryTime, setExpiryTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  // The stored expiry is only ever used to pre-fill the inputs once. Opening the
  // page must never write to it — nothing is persisted until the user saves.
  const prefillDone = useRef(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    refreshStatus();
  }, []);

  function refreshStatus() {
    return fetch("/api/coinswitch/keys/status")
      .then((r) => r.json())
      .then((d) => {
        if (!mounted.current || !d?.success) return;
        setKeyStatus(d);
        if (prefillDone.current) return;
        prefillDone.current = true;
        // Show the currently stored expiry without modifying it.
        if (d.validUntil) {
          const parsed = new Date(d.validUntil);
          if (!Number.isNaN(parsed.getTime())) {
            // Keep only the calendar day — the time comes from its own picker.
            setExpiryDate(new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
            setExpiryTime(toTimeInputValue(parsed));
          }
        }
      })
      .catch(() => {});
  }

  /**
   * The exact datetime-local literal to send, or null when the date or time is
   * unusable. Validated centrally so the save button can never fire a request
   * the server would reject.
   */
  function expiryLiteral(): string | null {
    return buildExpiryLiteral(expiryDate, expiryTime);
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/coinswitch/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, validUntil: expiryLiteral() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Connection failed");
      setMessage({ text: "Connected successfully. Your CoinSwitch account is now linked.", type: "success" });
      setApiKey("");
      setApiSecret("");
      prefillDone.current = false;
      await refreshStatus();
    } catch (err: unknown) {
      setMessage({ text: messageOf(err, "Unable to connect right now."), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function saveExpiry() {
    const validUntil = expiryLiteral();
    if (!validUntil) return;
    setSavingExpiry(true);
    setMessage(null);
    try {
      const res = await fetch("/api/coinswitch/keys/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validUntil }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save expiry");
      setMessage({ text: "Expiry date saved.", type: "success" });
      await refreshStatus();
    } catch (err: unknown) {
      setMessage({ text: messageOf(err, "Unable to save expiry."), type: "error" });
    } finally {
      setSavingExpiry(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/coinswitch/disconnect", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Disconnect failed");
      setMessage({ text: "Disconnected successfully.", type: "success" });
      setKeyStatus({ connected: false });
    } catch (err: unknown) {
      setMessage({ text: messageOf(err, "Unable to disconnect right now."), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  const renewWarning =
    keyStatus?.connected && keyStatus.validUntil && typeof keyStatus.daysLeft === "number"
      ? keyStatus.daysLeft <= 0
        ? "overdue"
        : keyStatus.daysLeft <= 14
          ? "soon"
          : null
      : null;

  const expiryDirty =
    keyStatus?.connected === true &&
    Boolean(expiryLiteral()) &&
    expiryLiteral() !== toSavedLiteral(keyStatus.validUntil);

  return (
    <div className="min-h-screen px-3 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-medium transition cursor-pointer"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div
          className="rounded-2xl p-5 sm:p-8"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em]" style={{ color: "var(--text-muted)" }}>
                CoinSwitch
              </p>
              <h2 className="mt-2 text-xl font-semibold sm:text-2xl" style={{ color: "var(--foreground)" }}>
                {keyStatus?.connected ? "Update your API keys" : "Connect your account"}
              </h2>
              <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
                {keyStatus?.connected
                  ? "Paste your new CoinSwitch API key and secret below to replace the existing ones. Your old keys are no longer used."
                  : "Add your CoinSwitch API credentials to enable trading actions for this account."}
              </p>
            </div>
            <div
              className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
              style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--primary)" }}
            >
              Secure
            </div>
          </div>

          {keyStatus?.connected && (
            <div
              className="mb-5 rounded-xl border p-4"
              style={{
                borderColor:
                  renewWarning === "overdue"
                    ? "rgba(239,68,68,0.35)"
                    : renewWarning === "soon"
                      ? "rgba(245,158,11,0.35)"
                      : "var(--border)",
                background:
                  renewWarning === "overdue"
                    ? "rgba(239,68,68,0.08)"
                    : renewWarning === "soon"
                      ? "rgba(245,158,11,0.08)"
                      : "var(--surface)",
              }}
            >
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--foreground)" }}>
                {renewWarning ? (
                  <AlertTriangle size={15} style={{ color: renewWarning === "overdue" ? "#ef4444" : "#f59e0b" }} />
                ) : (
                  <KeyRound size={15} style={{ color: "var(--primary)" }} />
                )}
                {renewWarning === "overdue"
                  ? "API key has expired"
                  : renewWarning === "soon"
                    ? `API key expires in ${keyStatus.daysLeft} day${keyStatus.daysLeft === 1 ? "" : "s"}`
                    : "API keys linked"}
              </div>
              <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
                <div className="tabular-nums">
                  Key: <span className="font-mono" style={{ color: "var(--primary)" }}>{keyStatus.apiKeyMasked}</span>
                </div>
                <div className="tabular-nums">Linked on: {formatDateTime(keyStatus.createdAt)}</div>
                <div
                  className="tabular-nums"
                  style={{ color: renewWarning === "overdue" ? "#ef4444" : renewWarning === "soon" ? "#f59e0b" : "var(--text-muted)" }}
                >
                  {keyStatus.validUntil
                    ? `Expires on: ${formatDateTime(keyStatus.validUntil)}${
                        typeof keyStatus.daysLeft === "number"
                          ? ` (${keyStatus.daysLeft} day${keyStatus.daysLeft === 1 ? "" : "s"} left)`
                          : ""
                      }`
                    : "Expiry date not set."}
                </div>
              </div>
              {!keyStatus.validUntil && (
                <p className="mt-2 text-[11px] leading-5" style={{ color: "var(--text-muted)" }}>
                  CoinSwitch shows your key expiry on the{" "}
                  <a
                    href="https://coinswitch.co/pro/profile?section=api-trading"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                    style={{ color: "var(--primary)" }}
                  >
                    API Trading page
                  </a>
                  . Enter that date and time below so the app can remind you to renew.
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleConnect} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="apiKey" className="block text-sm font-medium" style={{ color: "var(--foreground)" }}>
                API Key
              </label>
              <Input
                id="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyStatus?.connected ? "Paste your new API key" : "Paste your CoinSwitch API key"}
                className="cs-input h-10"
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="apiSecret" className="block text-sm font-medium" style={{ color: "var(--foreground)" }}>
                API Secret
              </label>
              <Input
                id="apiSecret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder={keyStatus?.connected ? "Paste your new API secret" : "Paste your CoinSwitch API secret"}
                className="cs-input h-10"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-medium" style={{ color: "var(--foreground)" }}>
                Key expiry date &amp; time{" "}
                <span className="font-normal" style={{ color: "var(--text-muted)" }}>(shown in CoinSwitch PRO)</span>
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="expiryDate" className="block text-xs" style={{ color: "var(--text-muted)" }}>
                    Expiry date
                  </label>
                  <DatePicker
                    id="expiryDate"
                    selected={expiryDate}
                    onChange={(d: Date | null) => setExpiryDate(d)}
                    dateFormat="dd MMM yyyy"
                    placeholderText="18 Oct 2026"
                    isClearable
                    openToDate={expiryDate ?? undefined}
                    wrapperClassName="cs-date-field w-full"
                    className="h-10 w-full"
                    ariaLabelledBy="expiryDate"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="expiryTime" className="block text-xs" style={{ color: "var(--text-muted)" }}>
                    Expiry time (24h)
                  </label>
                  <TimePicker24
                    id="expiryTime"
                    value={expiryTime}
                    onChange={setExpiryTime}
                    className="cs-time-field w-full"
                    hourAriaLabel="Expiry hour (24-hour)"
                    minuteAriaLabel="Expiry minute"
                  />
                </div>
              </div>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Find it under{" "}
                <a
                  href="https://coinswitch.co/pro/profile?section=api-trading"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: "var(--primary)" }}
                >
                  coinswitch.co/pro/profile → API Trading
                </a>
                . Pick the date from the calendar and the time from the 24-hour clock dial, e.g. 18 Oct 2026 at 20:54.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={saveExpiry}
                  disabled={savingExpiry || !expiryLiteral()}
                  className="cs-expiry-save h-10"
                >
                  {savingExpiry ? "Saving..." : "Save date & time only"}
                </Button>
                {expiryLiteral() && (
                  <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {expiryDirty ? "Not saved yet" : "Saved"}
                  </span>
                )}
              </div>
            </div>

            <div
              className="flex items-start gap-2 rounded-xl p-4 text-sm"
              style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}
            >
              <ShieldCheck size={16} className="mt-0.5 shrink-0" style={{ color: "var(--primary)" }} />
              Your credentials are stored securely for this account and used only for CoinSwitch requests. They are never
              shown again after connecting.
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={loading} className="h-10 flex-1">
                {loading ? "Connecting..." : keyStatus?.connected ? "Save new keys" : "Connect"}
              </Button>
              {keyStatus?.connected && (
                <Button type="button" variant="outline" onClick={handleDisconnect} disabled={loading} className="h-10">
                  {loading ? "Working..." : "Disconnect"}
                </Button>
              )}
            </div>

            {message && (
              <div
                role="status"
                className="rounded-xl border px-4 py-3 text-sm"
                style={
                  message.type === "success"
                    ? { border: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.1)", color: "#34d399" }
                    : { border: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171" }
                }
              >
                {message.text}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

/** Normalise a stored ISO expiry back to the datetime-local literal it came from. */
function toSavedLiteral(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${toDateInputValue(d)}T${toTimeInputValue(d)}`;
}
