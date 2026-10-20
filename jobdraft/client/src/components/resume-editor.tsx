"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { Profile, ResumeDetails } from "@/lib/types";
import { useConfirm } from "./confirm-dialog";
import { Banner, Button, Field, Input, cx } from "./ui";

type Role = ResumeDetails["roles"][number];
type Edu = ResumeDetails["education"][number];
/** Highlights are edited as one textarea (one per line), split back on save. */
type RoleDraft = Omit<Role, "bullets"> & { bullets: string };

const emptyRole = (): RoleDraft => ({ title: "", company: "", start: "", end: "", is_current: false, bullets: "" });
const emptyEdu = (): Edu => ({ degree: "", institution: "", year: "" });

/**
 * Corrects what the AI read from the resume. Changes are kept in the form until
 * "Save changes" (with a confirmation), so a half-typed value is never used.
 */
export function ResumeEditor({ initial, onSaved, onClose }: { initial: ResumeDetails; onSaved: (p: Profile) => void; onClose: () => void }) {
  const id = useId();
  const confirm = useConfirm();
  const [form, setForm] = useState(() => toDraft(initial));
  const [skillInput, setSkillInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(toDraft(initial)) || skillInput.trim() !== "";

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setRole = (i: number, patch: Partial<RoleDraft>) => set("roles", form.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setEdu = (i: number, patch: Partial<Edu>) => set("education", form.education.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const err = (key: string) => errors[key];

  function addSkill() {
    set("skills", mergeSkills(form.skills, skillInput));
    setSkillInput("");
  }

  async function removeRole(i: number) {
    const r = form.roles[i]!;
    const name = [r.title, r.company].filter(Boolean).join(" at ") || "this role";
    const ok = await confirm({
      title: "Remove this role?",
      body: `"${name}" will be removed from your details when you save. You can still cancel the whole edit afterwards.`,
      confirmLabel: "Remove role",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (ok) set("roles", form.roles.filter((_, j) => j !== i));
  }

  async function cancel() {
    if (dirty) {
      const ok = await confirm({ title: "Discard your changes?", body: "Nothing you changed here will be saved.", confirmLabel: "Discard changes", cancelLabel: "Keep editing", danger: true });
      if (!ok) return;
    }
    onClose();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = fromDraft(form, skillInput);
    if (!body.full_name.trim()) {
      setErrors({ full_name: "Enter your name." });
      setFormError("Please fix the highlighted fields.");
      return;
    }
    const ok = await confirm({
      title: "Save your resume details?",
      body: "JobDraft will use these details from now on — in matching, your emails and your signature. Past and current employers you list here are added to companies to skip. The PDF attached to applications stays exactly as you uploaded it.",
      confirmLabel: "Save changes",
    });
    if (!ok) return;
    setSaving(true);
    setErrors({});
    setFormError("");
    try {
      const next = await api<Profile>("/api/profile/resume/details", { method: "PUT", body: body as unknown as Record<string, unknown> });
      toast.success("Resume details saved.");
      onSaved(next);
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length) {
        setErrors(error.fields);
        setFormError("Please fix the highlighted fields.");
      } else setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof Pick<ResumeDetails, "full_name" | "current_title" | "email" | "phone" | "location" | "linkedin">, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} htmlFor={`${id}-${key}`} error={err(key)}>
      <Input id={`${id}-${key}`} value={form[key]} onChange={(e) => set(key, e.target.value)} invalid={!!err(key)} {...props} />
    </Field>
  );

  return (
    <form onSubmit={save} noValidate className="space-y-6" data-testid="resume-editor">
      <Banner tone="info">Fix anything that was read wrong. This changes what JobDraft uses; your PDF file isn&apos;t changed.</Banner>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold text-slate-900">About you</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("full_name", "Full name", { autoComplete: "name" })}
          {field("current_title", "Current title")}
          {field("email", "Email", { type: "email", autoComplete: "email", inputMode: "email" })}
          {field("phone", "Phone", { type: "tel", autoComplete: "tel", inputMode: "tel" })}
          {field("location", "Location", { placeholder: "e.g. Bengaluru, India" })}
          {field("linkedin", "LinkedIn", { type: "url", inputMode: "url", placeholder: "https://linkedin.com/in/…" })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 font-semibold text-slate-900">Work experience</legend>
        <p className="mb-3 text-sm text-slate-600">Most recent first. Total experience is worked out from these dates (internships don&apos;t count).</p>
        <div className="space-y-3">
          {form.roles.map((r, i) => {
            const p = `${id}-role-${i}`;
            return (
              <div key={i} className="rounded-xl p-3 ring-1 ring-inset ring-slate-200 sm:p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-600">Role {i + 1}</p>
                  <Button type="button" variant="ghost" className="min-h-9 px-2 text-red-700 hover:bg-red-50" onClick={() => void removeRole(i)} aria-label={`Remove role ${i + 1}`}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Job title" htmlFor={`${p}-title`} error={err(`roles.${i}.title`)}>
                    <Input id={`${p}-title`} value={r.title} onChange={(e) => setRole(i, { title: e.target.value })} invalid={!!err(`roles.${i}.title`)} />
                  </Field>
                  <Field label="Company" htmlFor={`${p}-company`} error={err(`roles.${i}.company`)}>
                    <Input id={`${p}-company`} value={r.company} onChange={(e) => setRole(i, { company: e.target.value })} invalid={!!err(`roles.${i}.company`)} />
                  </Field>
                  <Field label="Start" htmlFor={`${p}-start`} error={err(`roles.${i}.start`)} hint="e.g. 2024-06 or Jun 2024">
                    <Input id={`${p}-start`} value={r.start} onChange={(e) => setRole(i, { start: e.target.value })} invalid={!!err(`roles.${i}.start`)} placeholder="2024-06" />
                  </Field>
                  <Field label="End" htmlFor={`${p}-end`} error={err(`roles.${i}.end`)}>
                    <Input
                      id={`${p}-end`}
                      value={r.is_current ? "Present" : r.end}
                      disabled={r.is_current}
                      onChange={(e) => setRole(i, { end: e.target.value })}
                      invalid={!!err(`roles.${i}.end`)}
                      placeholder="2025-03"
                      className="disabled:bg-slate-100 disabled:text-slate-600"
                    />
                  </Field>
                </div>
                <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 text-[15px] text-slate-800">
                  <input type="checkbox" className="size-5 accent-brand-600" checked={r.is_current} onChange={(e) => setRole(i, { is_current: e.target.checked, end: e.target.checked ? "" : r.end === "Present" ? "" : r.end })} />
                  I work here now
                </label>
                <Field label="Highlights" htmlFor={`${p}-bullets`} hint="One per line. Used to tailor your emails." error={err(`roles.${i}.bullets`)}>
                  <textarea
                    id={`${p}-bullets`}
                    rows={3}
                    value={r.bullets}
                    onChange={(e) => setRole(i, { bullets: e.target.value })}
                    className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
                  />
                </Field>
              </div>
            );
          })}
          {form.roles.length === 0 && <p className="text-[15px] text-slate-600">No roles yet.</p>}
          {form.roles.length < 25 && (
            <Button type="button" variant="secondary" onClick={() => set("roles", [...form.roles, emptyRole()])}>
              <Plus className="size-5" aria-hidden /> Add role
            </Button>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-semibold text-slate-900">Skills</legend>
        {form.skills.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {form.skills.map((s) => (
              <li key={s} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-800">
                {s}
                <button type="button" onClick={() => set("skills", form.skills.filter((x) => x !== s))} className="flex size-7 items-center justify-center rounded-full hover:bg-slate-200" aria-label={`Remove ${s}`}>
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <label htmlFor={`${id}-skill`} className="sr-only">
            Add a skill
          </label>
          <Input
            id={`${id}-skill`}
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSkill();
              }
            }}
            placeholder="Add a skill, e.g. React"
            invalid={!!err("skills")}
          />
          <Button type="button" variant="secondary" onClick={addSkill} disabled={!skillInput.trim()} aria-label="Add skill">
            <Plus className="size-5" aria-hidden />
          </Button>
        </div>
        {err("skills") && <p className="mt-1 text-sm font-medium text-red-700" role="alert">{err("skills")}</p>}
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-semibold text-slate-900">Education</legend>
        <div className="space-y-3">
          {form.education.map((ed, i) => {
            const p = `${id}-edu-${i}`;
            return (
              <div key={i} className="grid items-end gap-3 rounded-xl p-3 ring-1 ring-inset ring-slate-200 sm:grid-cols-[1fr_6.5rem_auto]">
                <div className="sm:col-span-3">
                  <Field label="Degree" htmlFor={`${p}-degree`}>
                    <Input id={`${p}-degree`} value={ed.degree} onChange={(e) => setEdu(i, { degree: e.target.value })} />
                  </Field>
                </div>
                <Field label="Institution" htmlFor={`${p}-inst`}>
                  <Input id={`${p}-inst`} value={ed.institution} onChange={(e) => setEdu(i, { institution: e.target.value })} />
                </Field>
                <Field label="Year" htmlFor={`${p}-year`}>
                  <Input id={`${p}-year`} value={ed.year} onChange={(e) => setEdu(i, { year: e.target.value })} inputMode="numeric" />
                </Field>
                <Button type="button" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => set("education", form.education.filter((_, j) => j !== i))} aria-label={`Remove education ${i + 1}`}>
                  <Trash2 className="size-5" aria-hidden />
                  <span className="sm:sr-only">Remove</span>
                </Button>
              </div>
            );
          })}
          {form.education.length < 10 && (
            <Button type="button" variant="secondary" onClick={() => set("education", [...form.education, emptyEdu()])}>
              <Plus className="size-5" aria-hidden /> Add education
            </Button>
          )}
        </div>
      </fieldset>

      {formError && <Banner tone="error">{formError}</Banner>}

      <div className={cx("sticky bottom-20 z-10 -mx-1 flex flex-col-reverse gap-2 rounded-2xl bg-white/90 p-1 backdrop-blur sm:bottom-2 sm:flex-row sm:justify-end")}>
        <Button type="button" variant="secondary" onClick={() => void cancel()} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!dirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function toDraft(d: ResumeDetails) {
  return {
    ...d,
    roles: d.roles.map((r) => ({ ...r, end: r.is_current ? "" : r.end, bullets: r.bullets.join("\n") })),
    skills: [...d.skills],
    education: d.education.map((e) => ({ ...e })),
  };
}

function fromDraft(f: ReturnType<typeof toDraft>, pendingSkill: string): ResumeDetails {
  return {
    ...f,
    roles: f.roles.map((r) => ({ ...r, bullets: r.bullets.split("\n").map((b) => b.trim()).filter(Boolean) })),
    skills: mergeSkills(f.skills, pendingSkill),
  };
}

/** Adds comma-separated skills from the input, skipping ones already listed (any case). */
function mergeSkills(skills: string[], input: string): string[] {
  const out = [...skills];
  const have = new Set(out.map((s) => s.toLowerCase()));
  for (const s of input.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (have.has(s.toLowerCase())) continue;
    have.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}
