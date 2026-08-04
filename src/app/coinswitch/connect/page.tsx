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
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">CoinSwitch</p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground">Connect your account</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Add your CoinSwitch API credentials to enable trading actions for this account.
              </p>
            </div>
            <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              Secure
            </div>
          </div>

          <form onSubmit={handleConnect} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="apiKey" className="block text-sm font-medium text-foreground">
                API Key
              </label>
              <Input
                id="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your CoinSwitch API key"
                className="h-10 rounded-xl border-border/70 bg-background px-3 text-sm shadow-sm"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="apiSecret" className="block text-sm font-medium text-foreground">
                API Secret
              </label>
              <Input
                id="apiSecret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Paste your CoinSwitch API secret"
                className="h-10 rounded-xl border-border/70 bg-background px-3 text-sm shadow-sm"
              />
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
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
