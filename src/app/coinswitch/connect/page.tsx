"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { KeyRound, ShieldCheck, AlertTriangle, ArrowLeft } from "lucide-react";

type MessageState = {
  text: string;
  type: "success" | "error";
} | null;

interface KeyStatus {
  connected: boolean;
  apiKeyMasked?: string;
  createdAt?: string;
  validUntil?: string | null;
  daysLeft?: number | null;
  status?: string;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    return `${date}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "—";
  }
}

export default function ConnectPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coinswitch/keys/status")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.success) setKeyStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/coinswitch/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, validUntil: validUntil || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Connection failed");
      setMessage({ text: "Connected successfully. Your CoinSwitch account is now linked.", type: "success" });
      setApiKey("");
      setApiSecret("");
      setValidUntil(null);
      refreshStatus();
      setTimeout(() => router.push("/dashboard"), 800);
    } catch (err: any) {
      setMessage({ text: err.message || "Unable to connect right now.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function saveExpiry() {
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
      refreshStatus();
    } catch (err: any) {
      setMessage({ text: err.message || "Unable to save expiry.", type: "error" });
    } finally {
      setSavingExpiry(false);
    }
  }

  function refreshStatus() {
    fetch("/api/coinswitch/keys/status")
      .then((r) => r.json())
      .then((d) => { if (d.success) setKeyStatus(d); })
      .catch(() => {});
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
    } catch (err: any) {
      setMessage({ text: err.message || "Unable to disconnect right now.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  const renewWarning =
    keyStatus?.connected &&
    keyStatus.validUntil &&
    typeof keyStatus.daysLeft === "number"
      ? keyStatus.daysLeft <= 0
        ? "overdue"
        : keyStatus.daysLeft <= 14
          ? "soon"
          : null
      : null;

  return (
    <div className="min-h-screen px-3 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm font-medium self-start cursor-pointer rounded-lg px-3 py-2 transition"
          style={{ color: "#a89880", fontFamily: "var(--font-cinzel), serif" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(201,154,88,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div
          className="rounded-2xl p-5 sm:p-8"
          style={{
            background: "linear-gradient(160deg, rgba(201,154,88,0.06), #0a0907)",
            border: "1px solid rgba(201,154,88,0.16)",
          }}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p
                className="text-sm font-medium"
                style={{
                  fontFamily: "var(--font-cinzel), serif",
                  letterSpacing: "0.2em",
                  color: "#a89880",
                }}
              >
                CoinSwitch
              </p>
              <h2
                className="mt-2 text-xl sm:text-2xl font-semibold"
                style={{
                  fontFamily: "var(--font-cinzel), serif",
                  background: "linear-gradient(100deg, #f4e6cd 0%, #eee5d8 35%, #c99a58 75%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {keyStatus?.connected ? "Update your API keys" : "Connect your account"}
              </h2>
              <p className="mt-2 text-sm leading-6" style={{ color: "#a89880" }}>
                {keyStatus?.connected
                  ? "Paste your new CoinSwitch API key and secret below to replace the existing ones. Your old keys are no longer used."
                  : "Add your CoinSwitch API credentials to enable trading actions for this account."}
              </p>
            </div>
            <div
              className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
              style={{
                border: "1px solid rgba(201,154,88,0.25)",
                background: "rgba(201,154,88,0.1)",
                color: "#c99a58",
              }}
            >
              Secure
            </div>
          </div>

          {keyStatus?.connected && (
            <div
              className="mb-5 rounded-xl border p-4"
              style={{
                borderColor:
                  renewWarning === "overdue" ? "rgba(239,68,68,0.35)" : renewWarning === "soon" ? "rgba(245,158,11,0.35)" : "rgba(201,154,88,0.12)",
                background:
                  renewWarning === "overdue"
                    ? "rgba(239,68,68,0.08)"
                    : renewWarning === "soon"
                      ? "rgba(245,158,11,0.08)"
                      : "rgba(201,154,88,0.04)",
              }}
            >
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#eee5d8", fontFamily: "var(--font-cinzel), serif" }}>
                {renewWarning ? <AlertTriangle size={15} style={{ color: renewWarning === "overdue" ? "#ef4444" : "#f59e0b" }} /> : <KeyRound size={15} style={{ color: "#c99a58" }} />}
                {renewWarning === "overdue"
                  ? "API key has expired"
                  : renewWarning === "soon"
                    ? `API key expires in ${keyStatus.daysLeft} day${keyStatus.daysLeft === 1 ? "" : "s"}`
                    : "API keys linked"}
              </div>
              <div className="mt-2 space-y-1 text-xs" style={{ color: "#a89880" }}>
                <div className="tabular-nums">Key: <span className="font-mono" style={{ color: "#dfb978" }}>{keyStatus.apiKeyMasked}</span></div>
                <div className="tabular-nums">Linked on: {formatDateTime(keyStatus.createdAt)}</div>
                <div className="tabular-nums" style={{ color: renewWarning !== null ? (renewWarning === "overdue" ? "#ef4444" : "#f59e0b") : "#a89880" }}>
                  {keyStatus.validUntil
                    ? `Expires on: ${formatDateTime(keyStatus.validUntil)}${typeof keyStatus.daysLeft === "number" ? ` (${keyStatus.daysLeft} day${keyStatus.daysLeft === 1 ? "" : "s"} left)` : ""}`
                    : "Expiry date not set."}
                </div>
              </div>
              {!keyStatus.validUntil && (
                <p className="mt-2 text-[11px] leading-5" style={{ color: "#a89880" }}>
                  CoinSwitch shows your key expiry on the{" "}
                  <a
                    href="https://coinswitch.co/pro/profile?section=api-trading"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                    style={{ color: "#c99a58" }}
                  >
                    API Trading page
                  </a>
                  . Enter that date below so the app can remind you to renew.
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleConnect} className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="apiKey"
                className="block text-sm font-medium"
                style={{ color: "#eee5d8", fontFamily: "var(--font-cinzel), serif" }}
              >
                API Key
              </label>
              <Input
                id="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyStatus?.connected ? "Paste your new API key" : "Paste your CoinSwitch API key"}
                className="h-10 rounded-xl px-3 text-sm shadow-sm"
                style={{
                  backgroundColor: "rgba(7,6,5,0.8)",
                  borderColor: "rgba(201,154,88,0.16)",
                  color: "#eee5d8",
                }}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="apiSecret"
                className="block text-sm font-medium"
                style={{ color: "#eee5d8", fontFamily: "var(--font-cinzel), serif" }}
              >
                API Secret
              </label>
              <Input
                id="apiSecret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder={keyStatus?.connected ? "Paste your new API secret" : "Paste your CoinSwitch API secret"}
                className="h-10 rounded-xl px-3 text-sm shadow-sm"
                style={{
                  backgroundColor: "rgba(7,6,5,0.8)",
                  borderColor: "rgba(201,154,88,0.16)",
                  color: "#eee5d8",
                }}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="validUntil"
                className="block text-sm font-medium"
                style={{ color: "#eee5d8", fontFamily: "var(--font-cinzel), serif" }}
              >
                Key expiry date & time <span className="font-normal" style={{ color: "#a89880" }}>(shown in CoinSwitch PRO)</span>
              </label>
              <DateTimePicker
                value={validUntil ?? keyStatus?.validUntil ?? null}
                onChange={setValidUntil}
                placeholder="Select expiry date & time"
              />
              <p className="text-[11px]" style={{ color: "#a89880" }}>
                Find it under{" "}
                <a
                  href="https://coinswitch.co/pro/profile?section=api-trading"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: "#c99a58" }}
                >
                  coinswitch.co/pro/profile → API Trading
                </a>
                . The expiry includes the exact time, e.g. "18 October 2026 at 8:54 pm".
              </p>
            </div>

            <div
              className="rounded-xl p-4 text-sm flex items-start gap-2"
              style={{
                border: "1px solid rgba(201,154,88,0.12)",
                background: "rgba(201,154,88,0.04)",
                color: "#a89880",
              }}
            >
              <ShieldCheck size={16} className="mt-0.5 shrink-0" style={{ color: "#c99a58" }} />
              Your credentials are stored securely for this account and used only for CoinSwitch requests. They are never shown again after connecting.
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={loading} className="h-10 flex-1 rounded-xl">
                {loading ? "Connecting..." : keyStatus?.connected ? "Save new keys" : "Connect"}
              </Button>
              {keyStatus?.connected && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="h-10 rounded-xl"
                >
                  {loading ? "Working..." : "Disconnect"}
                </Button>
              )}
            </div>

            {keyStatus?.connected && validUntil && validUntil !== keyStatus.validUntil && (
              <Button
                type="button"
                variant="outline"
                onClick={saveExpiry}
                disabled={savingExpiry}
                className="h-10 rounded-xl"
              >
                {savingExpiry ? "Saving..." : "Update expiry date only"}
              </Button>
            )}

            {message && (
              <div
                role="status"
                className={`rounded-xl border px-4 py-3 text-sm ${
                  message.type === "success"
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
                }`}
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