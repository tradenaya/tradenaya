"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "./ui";

export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="flex max-w-full items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-brand-800 ring-1 ring-inset ring-brand-100">
      <span className="truncate font-medium">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-brand-100">
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/** Role chips: remove with ×, add by typing (Enter or comma) or one tap on a suggestion. */
export function ChipInput({
  id,
  values,
  onChange,
  max,
  suggestions = [],
  related = [],
  invalid,
  describedBy,
}: {
  id: string;
  values: string[];
  onChange: (v: string[]) => void;
  max: number;
  /** From the resume. */
  suggestions?: string[];
  /** Adjacent roles worth considering. */
  related?: string[];
  invalid?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState("");
  const has = (v: string) => values.some((x) => x.toLowerCase() === v.toLowerCase());
  const full = values.length >= max;

  function add(raw: string) {
    const v = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    if (v.length < 2 || has(v) || full) return;
    onChange([...values, v]);
    setDraft("");
  }

  const unused = suggestions.filter((s) => !has(s));
  const relatedUnused = related.filter((s) => !has(s) && !suggestions.some((x) => x.toLowerCase() === s.toLowerCase()));
  return (
    <div>
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Selected roles">
          {values.map((v) => (
            <RemovableChip key={v} label={v} onRemove={() => onChange(values.filter((x) => x !== v))} />
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={full ? `Up to ${max} roles` : "Add a role, e.g. Product Manager"}
          disabled={full}
          invalid={invalid}
          aria-describedby={describedBy}
          enterKeyHint="done"
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) add(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={() => add(draft)} disabled={full || draft.trim().length < 2} aria-label="Add role">
          <Plus className="size-5" aria-hidden />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>
      {!full && <SuggestionGroup title="Suggested from your resume:" items={unused} onAdd={add} />}
      {!full && <SuggestionGroup title="Related roles you could also target:" items={relatedUnused} onAdd={add} testId="related-roles" />}
    </div>
  );
}

function SuggestionGroup({ title, items, onAdd, testId }: { title: string; items: string[]; onAdd: (s: string) => void; testId?: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-2" data-testid={testId}>
      <p className="mb-1 text-sm text-slate-600">{title}</p>
      <ul className="flex flex-wrap gap-2">
        {items.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onAdd(s)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed border-slate-400 px-3 text-[15px] text-slate-800 hover:bg-slate-50"
            >
              <Plus className="size-4" aria-hidden />
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
