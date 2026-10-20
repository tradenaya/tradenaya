"use client";

import { ExternalLink, FileUp, Pencil, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, API_URL, ApiError, errorMessage } from "@/lib/api";
import { formatYears } from "@/lib/format";
import type { Profile, ResumeDetails } from "@/lib/types";
import { useConfirm } from "./confirm-dialog";
import { ResumeEditor } from "./resume-editor";
import { ResumeReading } from "./resume-reading";
import { Banner, Button, Card, cx } from "./ui";

/** Same limit as the server (it rejects anything larger). */
const MAX_MB = 5;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Checked before anything else (no confirmation, no upload) — returns the problem or "". */
export function resumeFileProblem(file: File): string {
  if (file.size === 0) return `"${file.name}" is empty. Please choose another file.`;
  if (file.size > MAX_BYTES) return `"${file.name}" is ${formatSize(file.size)}. The maximum is ${MAX_MB} MB — please upload a smaller PDF (for example, export it again without large images).`;
  if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) return `"${file.name}" isn't a PDF. Please choose a PDF file.`;
  return "";
}

export function ResumeSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ResumeDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const resume = profile.resume;
  const confirm = useConfirm();

  async function upload(file: File) {
    setError("");
    const problem = resumeFileProblem(file);
    if (problem) {
      if (inputRef.current) inputRef.current.value = "";
      return setError(problem);
    }
    const ok = await confirm(
      resume
        ? {
            title: "Replace your resume?",
            body: `"${file.name}" (${formatSize(file.size)}) will replace your current resume. JobDraft reads it again, updates your summary and refreshes the companies taken from it. Your old file is removed only after the new one is read successfully.`,
            confirmLabel: "Replace resume",
          }
        : {
            title: "Upload this resume?",
            body: `JobDraft will read "${file.name}" (${formatSize(file.size)}) to tailor your emails, and attach it to every application.`,
            confirmLabel: "Upload resume",
          },
    );
    if (!ok) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const form = new FormData();
    form.append("resume", file, file.name);
    setBusy(file);
    setEditing(null);
    try {
      const next = await api<Profile>("/api/profile/resume", { body: form });
      onChange(next);
      toast.success(resume ? "Resume replaced." : "Resume uploaded and read.");
    } catch (err) {
      // Status 0: the connection dropped mid-upload (network or proxy), not "server down".
      const msg = err instanceof ApiError && err.status === 0 ? "The upload was cut off before JobDraft could read your resume. Please try again." : errorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function startEditing() {
    setError("");
    setLoadingDetails(true);
    try {
      setEditing(await api<ResumeDetails>("/api/profile/resume/details"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingDetails(false);
    }
  }

  const picker = (
    <>
      <input
        ref={inputRef}
        id="resume-file"
        name="resume"
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        disabled={!!busy}
        aria-describedby="resume-help"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <label
        htmlFor="resume-file"
        className={cx(
          "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 font-semibold",
          resume ? "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50" : "w-full bg-brand-600 text-white hover:bg-brand-700 sm:w-auto",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {resume ? <RefreshCw className="size-5" aria-hidden /> : <FileUp className="size-5" aria-hidden />}
        {resume ? "Replace resume" : "Upload resume (PDF)"}
      </label>
    </>
  );

  return (
    <Card title="1. Your resume" id="resume">
      <p id="resume-help" className="mb-3 text-[15px] text-slate-600">
        We read it once to tailor your emails and attach it to every application.
        <span className="mt-1 block font-medium text-slate-700">PDF only · max {MAX_MB} MB · text-based, not a scan</span>
      </p>
      {busy && (
        <div className="mb-3">
          <ResumeReading fileName={busy.name} />
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      {busy ? null : !resume ? (
        picker
      ) : editing ? (
        <ResumeEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            onChange(p);
            setEditing(null);
          }}
        />
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Item label="Name" value={resume.fullName} />
            <Item label="Current title" value={resume.currentTitle || "—"} />
            <Item label="Total experience" value={formatYears(resume.experienceYears)} />
            <Item label="Location" value={resume.location || "—"} />
            <Item label="Contact" value={[resume.email, resume.phone].filter(Boolean).join(" · ") || "—"} />
            <Item label="LinkedIn" value={resume.linkedin || "—"} />
          </dl>
          {resume.roles.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">Recent roles</h3>
              <ul className="space-y-1 text-[15px] text-slate-700">
                {resume.roles.map((r, i) => (
                  <li key={i} className="break-words">
                    <span className="font-medium text-slate-900">{r.title}</span>
                    {r.company && ` · ${r.company}`}
                    {(r.start || r.end) && <span className="text-slate-600"> ({[r.start, r.end].filter(Boolean).join(" – ")})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {resume.skills.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">Top skills</h3>
              <ul className="flex flex-wrap gap-1.5">
                {resume.skills.map((s) => (
                  <li key={s} className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-800">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {resume.education.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">Education</h3>
              <ul className="text-[15px] text-slate-700">
                {resume.education.map((e, i) => (
                  <li key={i} className="break-words">
                    {[e.degree, e.institution, e.year].filter(Boolean).join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="rounded-xl bg-amber-50 p-3 text-[15px] text-amber-900 ring-1 ring-inset ring-amber-200">Something read wrong? Edit the details, or upload a corrected resume.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void startEditing()} loading={loadingDetails}>
              {!loadingDetails && <Pencil className="size-5" aria-hidden />}
              Edit details
            </Button>
            {picker}
            <a
              href={`${API_URL}/api/profile/resume/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 font-semibold text-brand-700 hover:bg-brand-50"
            >
              <ExternalLink className="size-5" aria-hidden />
              <span className="max-w-[14rem] truncate">View {resume.fileName ?? "PDF"}</span>
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="break-words font-medium text-slate-900">{value}</dd>
    </div>
  );
}
