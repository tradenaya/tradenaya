"use client";

import { ExternalLink, FileUp, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, API_URL, errorMessage } from "@/lib/api";
import { formatYears } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { Banner, Card, cx } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;

export function ResumeSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resume = profile.resume;

  async function upload(file: File) {
    setError("");
    if (file.size > MAX_BYTES) return setError("The file is larger than 5 MB.");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) return setError("Please choose a PDF file.");
    const form = new FormData();
    form.append("resume", file, file.name);
    setBusy(true);
    try {
      const next = await api<Profile>("/api/profile/resume", { body: form });
      onChange(next);
      toast.success(resume ? "Resume replaced." : "Resume uploaded and read.");
    } catch (err) {
      setError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
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
        disabled={busy}
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
        A text-based PDF up to 5 MB. We read it once to tailor your emails and attach it to every draft.
      </p>
      {busy && (
        <div className="mb-3">
          <Banner tone="info" title="Reading your resume…">
            This usually takes 10–30 seconds. Please keep this page open.
          </Banner>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      {!resume ? (
        picker
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
          <p className="rounded-xl bg-amber-50 p-3 text-[15px] text-amber-900 ring-1 ring-inset ring-amber-200">If anything is wrong, upload a corrected resume.</p>
          <div className="flex flex-wrap items-center gap-2">
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
