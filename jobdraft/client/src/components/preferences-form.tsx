"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ExcludedCompany, Profile } from "@/lib/types";
import { ChipInput } from "./chip-input";
import { LocationPicker } from "./location-picker";
import { RunTimeField } from "./run-time-field";
import { SkipCompanies } from "./skip-companies";
import { Button, Card, Field, Input } from "./ui";

interface FormState {
  roles: string[];
  locations: string[];
  salary: string;
  runTime: string;
  skip: ExcludedCompany[];
}

function initial(profile: Profile): FormState {
  const p = profile.preferences;
  return {
    // First visit: pre-fill roles from the resume's suggestions.
    roles: p.saved ? p.targetRoles : (profile.resume?.suggestedTargetRoles ?? []).slice(0, 8),
    locations: p.locations,
    salary: p.expectedSalaryLpa === null ? "" : String(p.expectedSalaryLpa),
    runTime: p.runTime || "09:00",
    skip: profile.excludedCompanies,
  };
}

function validate(f: FormState) {
  const e: Record<string, string> = {};
  if (f.roles.length < 1) e.target_roles = "Add at least one role.";
  if (f.roles.length > 8) e.target_roles = "Up to 8 roles.";
  if (f.locations.length < 1) e.locations = "Pick at least one location.";
  if (f.locations.length > 5) e.locations = "Up to 5 locations.";
  const n = Number(f.salary);
  if (f.salary.trim() === "" || !Number.isFinite(n)) e.expected_salary_lpa = "Enter your expected salary in LPA.";
  else if (n < 1 || n > 200) e.expected_salary_lpa = "Enter a number between 1 and 200.";
  if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(f.runTime)) e.run_time = "Pick a time in 15-minute steps.";
  return e;
}

export function PreferencesForm({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [form, setForm] = useState<FormState>(() => initial(profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const hasResume = !!profile.resume;

  // A new resume brings role suggestions and past employers: merge them in.
  const suggested = profile.resume?.suggestedTargetRoles;
  const serverSkip = profile.excludedCompanies;
  const [prev, setPrev] = useState({ suggested, serverSkip });
  if (prev.suggested !== suggested || prev.serverSkip !== serverSkip) {
    setPrev({ suggested, serverSkip });
    const manualUnsaved = form.skip.filter((c) => c.source === "manual" && !serverSkip.some((s) => s.name.toLowerCase() === c.name.toLowerCase()));
    setForm({
      ...form,
      roles: !profile.preferences.saved && suggested?.length && form.roles.length === 0 ? suggested.slice(0, 8) : form.roles,
      skip: [...serverSkip, ...manualUnsaved],
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const next = await api<Profile>("/api/profile/preferences", {
        method: "PUT",
        body: {
          target_roles: form.roles,
          locations: form.locations,
          expected_salary_lpa: Number(form.salary),
          run_time: form.runTime,
          excluded_companies: form.skip.map((c) => c.name),
        },
      });
      onChange(next);
      toast.success("Preferences saved.");
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const describe = (key: string, hint: string) => (errors[key] ? `${key}-error` : hint);
  return (
    <Card title="2. What you're looking for" id="preferences">
      <form onSubmit={save} noValidate className="space-y-5">
        <Field label="Target roles (1–8)" htmlFor="target_roles" error={errors.target_roles} hint={hasResume ? "Remove any that don't fit, or type to add your own." : "Upload your resume to get suggestions, or type roles."}>
          <ChipInput
            id="target_roles"
            values={form.roles}
            onChange={(roles) => setForm({ ...form, roles })}
            max={8}
            suggestions={profile.resume?.suggestedTargetRoles ?? []}
            invalid={!!errors.target_roles}
            describedBy={describe("target_roles", "target_roles-hint")}
          />
        </Field>
        <Field label="Locations (1–5)" htmlFor="locations" error={errors.locations} hint="Indian cities, or Remote (India).">
          <LocationPicker
            id="locations"
            values={form.locations}
            onChange={(locations) => setForm({ ...form, locations })}
            max={5}
            invalid={!!errors.locations}
            describedBy={describe("locations", "locations-hint")}
          />
        </Field>
        <Field label="Expected salary (LPA)" htmlFor="expected_salary_lpa" error={errors.expected_salary_lpa} hint="Lakhs per annum, 1–200. Jobs paying clearly less are skipped.">
          <div className="relative max-w-48">
            <Input
              id="expected_salary_lpa"
              type="number"
              inputMode="decimal"
              min={1}
              max={200}
              step="0.5"
              value={form.salary}
              onChange={(e) => setForm({ ...form, salary: e.target.value })}
              invalid={!!errors.expected_salary_lpa}
              aria-describedby={describe("expected_salary_lpa", "expected_salary_lpa-hint")}
              className="pr-14"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-600">LPA</span>
          </div>
        </Field>
        <RunTimeField id="run_time" value={form.runTime} onChange={(runTime) => setForm({ ...form, runTime })} error={errors.run_time} />
        <Field
          label="Companies to skip"
          htmlFor="skip_companies"
          error={errors.excluded_companies}
          hint="JobDraft never contacts these. Your past employers are added from your resume; add others such as a sister company or one you already applied to."
        >
          <SkipCompanies id="skip_companies" values={form.skip} onChange={(skip) => setForm({ ...form, skip })} />
        </Field>
        <Button type="submit" loading={saving} full className="sm:w-auto">
          Save preferences
        </Button>
      </form>
    </Card>
  );
}
