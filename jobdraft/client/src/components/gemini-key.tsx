"use client";

import { ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDateIst } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { useConfirm } from "./confirm-dialog";
import { Banner, Button, Card, Field, PasswordInput } from "./ui";

/** Google AI Studio's API key page (free; sign in with Google). */
export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";

/** Where to get a key, in three steps, with a link that opens Google AI Studio in a new tab. */
export function GeminiKeyHelp({ id }: { id?: string }) {
  return (
    <div id={id} className="rounded-xl bg-brand-50 p-3 text-[15px] text-slate-800 ring-1 ring-inset ring-brand-100">
      <p className="font-semibold text-slate-900">Don&apos;t have a key? It&apos;s free and takes a minute:</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>
          Open{" "}
          <a href={GEMINI_KEY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 underline underline-offset-2">
            Google AI Studio
            <ExternalLink className="size-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>{" "}
          and sign in with your Google account.
        </li>
        <li>
          Click <strong>Create API key</strong>, then copy it.
        </li>
        <li>Come back here and paste it.</li>
      </ol>
      <a
        href={GEMINI_KEY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 hover:bg-brand-50"
        data-testid="get-gemini-key"
      >
        <KeyRound className="size-4" aria-hidden />
        Get your free key
        <ExternalLink className="size-4" aria-hidden />
        <span className="sr-only">(opens Google AI Studio in a new tab)</span>
      </a>
      <p className="mt-2 text-sm text-slate-600">JobDraft uses it only for your own resume, job checks and emails. It&apos;s stored encrypted.</p>
    </div>
  );
}

/** Setup: the user's own Gemini key — status, replace, remove. */
export function GeminiKeyCard({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const confirm = useConfirm();
  const k = profile.geminiKey;
  const [editing, setEditing] = useState(!k.saved);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const key = value.trim();
    if (!key) return setError("Paste your Gemini API key.");
    const ok = await confirm({
      title: k.saved ? "Replace your Gemini API key?" : "Save this Gemini API key?",
      body: "JobDraft checks the key with Google, then stores it encrypted and uses it for your resume, job checks and emails.",
      confirmLabel: k.saved ? "Replace key" : "Save key",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Profile>("/api/profile/gemini-key", { method: "PUT", body: { key } });
      onChange(next);
      setValue("");
      setEditing(false);
      toast.success("Gemini API key saved.");
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.key ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Remove your Gemini API key?",
      body: "JobDraft can't read resumes, check jobs or write emails without it. Daily runs pause until you add a key again. Your other settings are kept.",
      confirmLabel: "Remove key",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      onChange(await api<Profile>("/api/profile/gemini-key", { method: "DELETE" }));
      setEditing(true);
      toast.success("Gemini API key removed.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Gemini API key" id="gemini-key">
      <p className="mb-3 text-[15px] text-slate-700">JobDraft&apos;s AI runs on your own free Google Gemini key, so your usage never depends on anyone else&apos;s.</p>
      {k.saved && k.status === "invalid" && (
        <div className="mb-3">
          <Banner tone="error" title="Google rejected your key">
            Runs are paused. Paste a working key below, or create a new one.
          </Banner>
        </div>
      )}
      {!k.saved && (
        <div className="mb-3">
          <Banner tone="warn" title="Add your key to get started">
            You need it to read your resume and run JobDraft.
          </Banner>
        </div>
      )}
      {k.saved && !editing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[15px] text-slate-800" data-testid="gemini-key-status">
            Saved key ending in <strong className="font-mono">…{k.hint}</strong>
            {k.updatedAt && <span className="text-slate-600"> · added {formatDateIst(k.updatedAt)}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Replace key
            </Button>
            <Button type="button" variant="ghost" onClick={() => void remove()} disabled={busy} className="text-red-700 hover:bg-red-50">
              <Trash2 className="size-4" aria-hidden /> Remove
            </Button>
          </div>
        </div>
      )}
      {editing && (
        <form onSubmit={save} noValidate className="space-y-3">
          <Field label={k.saved ? "New Gemini API key" : "Gemini API key"} htmlFor="gemini-key-input" error={error}>
            <PasswordInput
              id="gemini-key-input"
              what="key"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Paste your key (starts with AIza…)"
              invalid={!!error}
              aria-describedby={error ? "gemini-key-input-error" : "gemini-key-help"}
            />
          </Field>
          <GeminiKeyHelp id="gemini-key-help" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {k.saved ? "Replace key" : "Save key"}
            </Button>
            {k.saved && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setError("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
