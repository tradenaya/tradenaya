"use client";

import { Mail, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { ConfirmDialog, useConfirm, type ConfirmOptions } from "./confirm-dialog";
import { Banner, Button, Card } from "./ui";

/** Confirmation shown before sending the user to Google's sign-in. */
export function gmailConnectConfirm(connected: boolean): ConfirmOptions {
  return {
    title: connected ? "Switch or reconnect Gmail?" : "Connect Gmail?",
    body: connected
      ? "You'll go to Google to sign in again. Pick the Gmail account JobDraft should use and tick every permission box. If you choose a different account, JobDraft uses that one from now on."
      : "You'll go to Google to sign in. Pick the Gmail account JobDraft should use and tick every permission box.",
    confirmLabel: "Continue to Google",
  };
}

export async function startGmailConnect() {
  const { url } = await api<{ url: string }>("/api/gmail/connect");
  window.location.assign(url);
}

function Permissions() {
  return (
    <ul className="space-y-1.5 text-[15px] text-slate-700">
      <li>
        <strong className="text-slate-900">Create and send emails</strong> — to prepare each application in your Gmail and send the strongest matches.
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
  const [confirming, setConfirming] = useState(false);
  const g = profile.gmail;
  const confirm = useConfirm();

  async function connect() {
    if (!(await confirm(gmailConnectConfirm(g.status === "connected")))) return;
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
      setConfirming(false);
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
        <div className="space-y-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <span className="size-2 rounded-full bg-emerald-700" aria-hidden />
              Connected
            </p>
            <p className="mt-1 flex min-w-0 items-center gap-2 text-slate-900">
              <Mail className="size-5 shrink-0 text-slate-500" aria-hidden />
              <strong className="min-w-0 break-all">{g.address}</strong>
            </p>
            <p className="mt-2 text-[15px] text-slate-600">JobDraft prepares your applications in this Gmail account and sends the strongest matches from it.</p>
          </div>

          <details className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <summary className="cursor-pointer text-[15px] font-semibold text-slate-900">What can JobDraft access?</summary>
            <div className="mt-2">
              <Permissions />
            </div>
          </details>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Button variant="secondary" full onClick={connect} loading={busy === "connect"} disabled={!!busy}>
                <RefreshCw className="size-4" aria-hidden />
                Switch or reconnect
              </Button>
              <p className="mt-1.5 text-sm text-slate-600">Sign in again — to use a different Gmail account or fix permissions.</p>
            </div>
            <div>
              <Button variant="secondary" full onClick={() => setConfirming(true)} disabled={!!busy} className="text-red-700">
                <Unplug className="size-4" aria-hidden />
                Disconnect
              </Button>
              <p className="mt-1.5 text-sm text-slate-600">Removes JobDraft&apos;s access to this Gmail and turns automation off.</p>
            </div>
          </div>

          <ConfirmDialog
            open={confirming}
            title="Disconnect Gmail?"
            confirmLabel="Disconnect"
            danger
            busy={busy === "disconnect"}
            onCancel={() => setConfirming(false)}
            onConfirm={() => void disconnect()}
          >
            JobDraft will stop preparing and sending emails, automation turns off, and any scheduled emails stay in your Gmail drafts. Your history is kept, and you can connect again at any time.
          </ConfirmDialog>
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
