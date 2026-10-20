"use client";

import { Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { Banner, Button, Card } from "./ui";

export async function startGmailConnect() {
  const { url } = await api<{ url: string }>("/api/gmail/connect");
  window.location.assign(url);
}

function Permissions() {
  return (
    <ul className="space-y-1.5 text-[15px] text-slate-700">
      <li>
        <strong className="text-slate-900">Create and send drafts</strong> — to put each application in your Gmail Drafts and send only the strongest matches.
      </li>
      <li>
        <strong className="text-slate-900">Read email headers only</strong> — sender, date and labels, to see whether an application was sent, replied to or bounced.
        JobDraft never reads the content of your emails.
      </li>
    </ul>
  );
}

export function GmailSection({ profile, onChange, title = "3. Connect Gmail" }: { profile: Profile; onChange: (p: Profile) => void; title?: string }) {
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const g = profile.gmail;

  async function connect() {
    setBusy("connect");
    try {
      await startGmailConnect();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      await api("/api/gmail/disconnect", { method: "POST" });
      onChange(await api<Profile>("/api/profile"));
      toast.success("Gmail disconnected. Automation is off and scheduled emails were kept as drafts.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={title} id="gmail">
      {g.status === "connected" ? (
        <div className="space-y-3">
          <p className="flex min-w-0 items-center gap-2 text-slate-900">
            <Mail className="size-5 shrink-0 text-emerald-700" aria-hidden />
            <span className="min-w-0">
              Connected as <strong className="break-all">{g.address}</strong>
            </span>
          </p>
          <Permissions />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={connect} loading={busy === "connect"} disabled={!!busy}>
              Reconnect
            </Button>
            <Button variant="ghost" onClick={disconnect} loading={busy === "disconnect"} disabled={!!busy} className="text-red-700 hover:bg-red-50">
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {g.status === "error" && (
            <Banner tone="error" title="Gmail access expired — please reconnect">
              {g.address && <>Previously connected as {g.address}. </>}Google stopped accepting JobDraft&apos;s access, so nothing can be drafted or sent until you reconnect.
            </Banner>
          )}
          {g.status === "needs_reconnect" && (
            <Banner tone="warn" title="Reconnect Gmail and allow all permissions">
              {g.lastError ?? "Some permissions are missing."} On Google&apos;s screen, tick every box.
            </Banner>
          )}
          <p className="text-[15px] text-slate-600">
            JobDraft prepares each application in <strong>your own Gmail</strong>, with your resume attached. It asks for two permissions:
          </p>
          <Permissions />
          <Button onClick={connect} loading={busy === "connect"} full className="sm:w-auto">
            <Mail className="size-5" aria-hidden />
            {g.status === "error" || g.status === "needs_reconnect" ? "Reconnect Gmail" : "Connect Gmail"}
          </Button>
          <details className="rounded-xl bg-slate-50 p-3 text-[15px] text-slate-700 ring-1 ring-inset ring-slate-200">
            <summary className="cursor-pointer font-semibold text-slate-900">Seeing “Google hasn’t verified this app”?</summary>
            <p className="mt-2">This is a one-time screen for small apps that haven&apos;t been through Google&apos;s review. To continue:</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>
                Tap <strong>Advanced</strong>, then <strong>Go to JobDraft (unsafe)</strong> — or simply <strong>Continue</strong> if that&apos;s the only option shown.
              </li>
              <li>
                On the permissions screen, <strong>tick every box</strong> (or <strong>Select all</strong>), then <strong>Continue</strong>.
              </li>
            </ol>
          </details>
        </div>
      )}
    </Card>
  );
}
