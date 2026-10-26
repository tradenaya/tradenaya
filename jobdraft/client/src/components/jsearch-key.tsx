"use client";

import { ExternalLink, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDateIst, plural } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { useConfirm } from "./confirm-dialog";
import { Banner, Button, Card, Field, PasswordInput } from "./ui";

function NewTabLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 hover:bg-brand-50"
      data-testid={testId}
    >
      {children}
      <ExternalLink className="size-4" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** The four steps to a free RapidAPI key for JSearch, each with the page it happens on. */
function JSearchKeyHelp({ subscribeUrl, playgroundUrl }: { subscribeUrl: string; playgroundUrl: string }) {
  return (
    <div id="jsearch-key-help" className="rounded-xl bg-brand-50 p-3 text-[15px] text-slate-800 ring-1 ring-inset ring-brand-100">
      <p className="font-semibold text-slate-900">Get your free key in about 2 minutes:</p>
      <ol className="mt-1 list-decimal space-y-2 pl-5">
        <li>
          Open JSearch on RapidAPI and sign up. <strong>Sign up with Google</strong> is the quickest.
          <br />
          <NewTabLink href={subscribeUrl} testId="jsearch-open-pricing">
            <KeyRound className="size-4" aria-hidden /> Open JSearch on RapidAPI
          </NewTabLink>
        </li>
        <li>
          Under <strong>Basic</strong> (the $0.00 plan), click <strong>Subscribe</strong>, then confirm. It&apos;s free.
          <span className="block text-sm text-slate-600">If it asks for card details, stop here: you don&apos;t need this, JobDraft works without it.</span>
        </li>
        <li>
          Open the <strong>Playground</strong>. On the right, find <strong>X-RapidAPI-Key</strong> and copy the long value next to it.
          <br />
          <NewTabLink href={playgroundUrl} testId="jsearch-open-playground">
            Open the Playground
          </NewTabLink>
        </li>
        <li>Come back here, paste it below and click Save key.</li>
      </ol>
    </div>
  );
}

/**
 * Setup (optional): the user's own RapidAPI key for JSearch. Without it, they
 * share the server's free searches with everyone; with it, they get their own
 * free monthly searches. Most email-apply jobs come from JSearch.
 */
export function JSearchKeyCard({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const confirm = useConfirm();
  const j = profile.jsearch;
  const own = j.ownKey;
  const [editing, setEditing] = useState(own?.status === "invalid");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | "remove" | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return setError("Paste your RapidAPI key.");
    setBusy("save");
    setError("");
    try {
      const next = await api<Profile>("/api/profile/jsearch-key", { method: "PUT", body: { key: value } });
      onChange(next);
      setValue("");
      setEditing(false);
      if (next.jsearch.ownKey?.status === "not_subscribed") toast.warning("Key saved. One step left: subscribe to the free plan.");
      else toast.success("Your JSearch key works. JobDraft will use it from the next run.");
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.key ?? err.message) : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function checkAgain() {
    setBusy("check");
    try {
      const next = await api<Profile>("/api/profile/jsearch-key/check", { method: "POST" });
      onChange(next);
      if (next.jsearch.ownKey?.status === "valid") toast.success("Subscribed. Your JSearch key works now.");
      else toast.error("Still not subscribed. Click Subscribe on the free Basic plan, then try again.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Remove your JSearch key?",
      body: "JobDraft goes back to sharing the free JobDraft searches with everyone. Nothing else changes.",
      confirmLabel: "Remove key",
      danger: true,
    });
    if (!ok) return;
    setBusy("remove");
    try {
      onChange(await api<Profile>("/api/profile/jsearch-key", { method: "DELETE" }));
      setEditing(false);
      toast.success("JSearch key removed.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const form = (
    <form onSubmit={save} noValidate className="space-y-3">
      <JSearchKeyHelp subscribeUrl={j.subscribeUrl} playgroundUrl={j.playgroundUrl} />
      <Field label={own ? "New RapidAPI key" : "RapidAPI key"} htmlFor="jsearch-key-input" error={error}>
        <PasswordInput
          id="jsearch-key-input"
          what="key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Paste the value of X-RapidAPI-Key"
          invalid={!!error}
          aria-describedby={error ? "jsearch-key-input-error" : "jsearch-key-help"}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === "save"}>
          Save key
        </Button>
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
      </div>
      <p className="text-sm text-slate-600">JobDraft checks the key with one search, stores it encrypted and uses it only for your job searches.</p>
    </form>
  );

  return (
    <Card title="More jobs you can apply to by email (optional)" id="jsearch-key">
      <p className="mb-3 text-[15px] text-slate-700">
        Most jobs that take applications by email come from JSearch. Its free searches are shared by everyone on JobDraft
        {j.shared && !own ? (
          <>
            {" "}
            (your share today: <strong data-testid="jsearch-share">{plural(j.shared.todayShare, "search", "searches")}</strong>, {j.shared.usedToday} used)
          </>
        ) : null}
        . With your own free key you get about 200 searches a month just for you.
      </p>

      {own?.status === "valid" && !editing && (
        <div className="space-y-3">
          <p className="text-[15px] text-slate-800" data-testid="jsearch-key-status">
            Your key ending in <strong className="font-mono">…{own.hint}</strong> works.{" "}
            <span className="text-slate-600">
              {own.usedThisMonth} of {own.monthlyQuota} searches used this month · up to {own.todayAllowance} today
              {own.updatedAt && <> · added {formatDateIst(own.updatedAt)}</>}
            </span>
          </p>
          {own.quotaUsedUp && (
            <Banner tone="warn" title="This month's free searches on your key are used up">
              JobDraft uses the shared searches until your key resets next month.
            </Banner>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Replace key
            </Button>
            <Button type="button" variant="ghost" onClick={() => void remove()} disabled={busy !== null} className="text-red-700 hover:bg-red-50">
              <Trash2 className="size-4" aria-hidden /> Remove
            </Button>
          </div>
        </div>
      )}

      {own?.status === "not_subscribed" && !editing && (
        <div className="space-y-3" data-testid="jsearch-not-subscribed">
          <Banner tone="warn" title="One step left: subscribe to the free plan">
            Your key (ending in …{own.hint}) is saved, but it isn&apos;t subscribed to JSearch yet. Open JSearch on RapidAPI, click <strong>Subscribe</strong> under{" "}
            <strong>Basic</strong> ($0.00), then come back and check again.
          </Banner>
          <div className="flex flex-wrap gap-2">
            <NewTabLink href={j.subscribeUrl}>Open JSearch on RapidAPI</NewTabLink>
            <Button type="button" onClick={() => void checkAgain()} loading={busy === "check"} className="mt-1">
              <RefreshCw className="size-4" aria-hidden /> I&apos;ve subscribed, check again
            </Button>
            <Button type="button" variant="ghost" onClick={() => void remove()} disabled={busy !== null} className="mt-1 text-red-700 hover:bg-red-50">
              <Trash2 className="size-4" aria-hidden /> Remove
            </Button>
          </div>
        </div>
      )}

      {own?.status === "invalid" && (
        <div className="mb-3">
          <Banner tone="error" title="RapidAPI rejected your key">
            JobDraft is using the shared searches for now. Paste your key again below, copying the whole value next to X-RapidAPI-Key.
          </Banner>
        </div>
      )}

      {!own && !editing && (
        <Button type="button" variant="secondary" onClick={() => setEditing(true)} data-testid="jsearch-add-key">
          <KeyRound className="size-4" aria-hidden /> Add your own free key
        </Button>
      )}

      {editing && form}
    </Card>
  );
}
