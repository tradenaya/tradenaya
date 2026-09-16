"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type MessageState = {
  text: string;
  type: "success" | "error";
} | null;

export default function ConnectPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/coinswitch/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Connection failed");
      setMessage({ text: "Connected successfully. Your CoinSwitch account is now linked.", type: "success" });
      router.push("/dashboard");
    } catch (err: any) {
      setMessage({ text: err.message || "Unable to connect right now.", type: "error" });
    } finally {
      setLoading(false);
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
    } catch (err: any) {
      setMessage({ text: err.message || "Unable to disconnect right now.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen px-3 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
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
                Connect your account
              </h2>
              <p className="mt-2 text-sm leading-6" style={{ color: "#a89880" }}>
                Add your CoinSwitch API credentials to enable trading actions for this account.
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
                placeholder="Paste your CoinSwitch API key"
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
                placeholder="Paste your CoinSwitch API secret"
                className="h-10 rounded-xl px-3 text-sm shadow-sm"
                style={{
                  backgroundColor: "rgba(7,6,5,0.8)",
                  borderColor: "rgba(201,154,88,0.16)",
                  color: "#eee5d8",
                }}
              />
            </div>

            <div
              className="rounded-xl p-4 text-sm"
              style={{
                border: "1px solid rgba(201,154,88,0.12)",
                background: "rgba(201,154,88,0.04)",
                color: "#a89880",
              }}
            >
              Your credentials are stored securely for this account and used only for CoinSwitch requests.
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={loading} className="h-10 flex-1 rounded-xl">
                {loading ? "Connecting..." : "Connect"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleDisconnect}
                disabled={loading}
                className="h-10 rounded-xl"
              >
                {loading ? "Working..." : "Disconnect"}
              </Button>
            </div>

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
