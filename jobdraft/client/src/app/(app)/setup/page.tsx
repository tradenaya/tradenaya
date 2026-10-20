"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AutomationSwitch } from "@/components/automation-switch";
import { GmailSection } from "@/components/gmail-section";
import { PreferencesForm } from "@/components/preferences-form";
import { ResumeSection } from "@/components/resume-section";
import { Stepper } from "@/components/stepper";
import { Banner, ButtonLink, PageSkeleton, PageTitle } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/types";

const GMAIL_RESULT: Record<string, [ok: boolean, message: string]> = {
  connected: [true, "Gmail connected. Drafts will appear in your Gmail Drafts folder."],
  denied: [false, "Gmail was not connected because access was declined."],
  expired: [false, "That Gmail sign-in took too long. Please try again."],
  session: [false, "Please connect Gmail from this browser while logged in to JobDraft."],
  scope: [false, "Some Gmail permissions weren't allowed. Please reconnect and tick every box on Google's screen."],
  error: [false, "Couldn't connect Gmail. Please try again."],
};

function SetupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState("");
  const handled = useRef(false);

  const load = useCallback(
    () =>
      api<Profile>("/api/profile").then(
        (p) => {
          setProfile(p);
          setLoadError("");
        },
        (err) => setLoadError(errorMessage(err)),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Result of the Google OAuth round trip (?gmail=connected|denied|…).
  useEffect(() => {
    const result = params.get("gmail");
    if (!result || handled.current) return;
    handled.current = true;
    const [ok, message] = GMAIL_RESULT[result] ?? GMAIL_RESULT.error!;
    if (ok) toast.success(message);
    else toast.error(message);
    router.replace("/setup");
  }, [params, router]);

  if (loadError)
    return (
      <Banner tone="error" title="Couldn't load your setup" action={<button className="min-h-11 font-semibold underline" onClick={() => void load()}>Try again</button>}>
        {loadError}
      </Banner>
    );
  if (!profile) return <PageSkeleton />;

  const allDone = profile.complete.resume && profile.complete.preferences && profile.complete.gmail;
  const showSteps = params.get("welcome") === "1" || !allDone;
  return (
    <div>
      <PageTitle subtitle="Upload your resume, choose what you're looking for and connect Gmail. You can change any of this later.">Setup</PageTitle>
      {showSteps && <Stepper complete={profile.complete} />}
      <div className="space-y-4">
        {/* Desktop: resume and preferences side by side. */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <ResumeSection profile={profile} onChange={setProfile} />
          <PreferencesForm key={profile.preferences.saved ? "saved" : "new"} profile={profile} onChange={setProfile} />
        </div>
        <GmailSection profile={profile} onChange={setProfile} />
        <AutomationSwitch profile={profile} onChange={setProfile} compact />
        {allDone && (
          <Banner tone="success" title="You're all set" action={<ButtonLink href="/dashboard">Go to dashboard</ButtonLink>}>
            {profile.automation.enabled
              ? "JobDraft will run every day at your chosen time."
              : "Turn automation on above when you're ready — nothing is drafted or sent until then."}
          </Banner>
        )}
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SetupInner />
    </Suspense>
  );
}
