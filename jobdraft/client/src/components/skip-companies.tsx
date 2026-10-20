"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { ExcludedCompany } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Button, Input } from "./ui";

/**
 * "Companies to skip": past employers from the resume (labelled) plus any the
 * user adds. Removing a resume company asks for confirmation first.
 */
export function SkipCompanies({ id, values, onChange }: { id: string; values: ExcludedCompany[]; onChange: (v: ExcludedCompany[]) => void }) {
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<ExcludedCompany | null>(null);
  const has = (name: string) => values.some((v) => v.name.toLowerCase() === name.toLowerCase());

  function add() {
    const name = draft.replace(/\s+/g, " ").trim().slice(0, 150);
    if (!name || has(name)) return setDraft("");
    onChange([...values, { name, source: "manual" }]);
    setDraft("");
  }

  const remove = (c: ExcludedCompany) => onChange(values.filter((v) => v !== c));

  return (
    <div>
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Companies to skip">
          {values.map((c) => (
            <li key={c.name} className="flex max-w-full items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-slate-900 ring-1 ring-inset ring-slate-200">
              <span className="truncate font-medium">{c.name}</span>
              {c.source === "resume" && <span className="shrink-0 rounded-full bg-white px-1.5 text-xs text-slate-600 ring-1 ring-slate-200">from resume</span>}
              <button
                type="button"
                onClick={() => (c.source === "resume" ? setConfirming(c) : remove(c))}
                aria-label={`Remove ${c.name}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-slate-200"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder="Add a company, e.g. a sister company"
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add} disabled={!draft.trim()} aria-label="Add company to skip">
          <Plus className="size-5" aria-hidden />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>
      <ConfirmDialog
        open={!!confirming}
        title={`Remove ${confirming?.name ?? ""}?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) remove(confirming);
          setConfirming(null);
        }}
      >
        {confirming?.name} is on your resume. If you remove it, JobDraft may email them about new openings. Save your preferences to apply the change.
      </ConfirmDialog>
    </div>
  );
}
