"use client";
import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function ConnectPage() {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      setMessage("Connected successfully");
    } catch (err: any) {
      setMessage(err.message || "Error");
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
      setMessage("Disconnected");
    } catch (err: any) {
      setMessage(err.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <h2 className="text-lg font-semibold mb-4">Connect CoinSwitch</h2>
      <form onSubmit={handleConnect} className="space-y-3">
        <div>
          <label className="block text-sm mb-1">API Key</label>
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Enter API Key" />
        </div>
        <div>
          <label className="block text-sm mb-1">API Secret</label>
          <Input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="Enter API Secret" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>Connect</Button>
          <Button variant="outline" onClick={handleDisconnect} disabled={loading}>Disconnect</Button>
        </div>
        {message && <div className="text-sm mt-2">{message}</div>}
      </form>
    </div>
  );
}
