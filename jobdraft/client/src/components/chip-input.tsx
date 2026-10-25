"use client";

import { Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { isKnownRole, searchRoles } from "@/lib/job-roles";
import { Button, cx, Input } from "./ui";

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

  // Autocomplete: known titles that match what's typed (spelling mistakes included), then "add as typed".
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const typed = draft.replace(/\s+/g, " ").trim();
  const matches = useMemo(() => (typed.length >= 2 ? searchRoles(typed, values) : []), [typed, values]);
  const options = typed.length >= 2 && !isKnownRole(typed) && !has(typed) ? [...matches.map((m) => ({ value: m, custom: false })), { value: typed, custom: true }] : matches.map((m) => ({ value: m, custom: false }));
  const showList = open && !full && options.length > 0;
  const pick = (v: string) => {
    add(v);
    setActive(0);
  };

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
        <div className="relative min-w-0 flex-1">
          <Input
            id={id}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${listId}-${active}` : undefined}
            autoComplete="off"
            value={draft}
            placeholder={full ? `Up to ${max} roles` : "Type a role, e.g. Product Manager"}
            disabled={full}
            invalid={invalid}
            aria-describedby={describedBy}
            enterKeyHint="done"
            onChange={(e) => {
              const v = e.target.value;
              if (v.endsWith(",")) add(v.slice(0, -1));
              else setDraft(v);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(a + 1, options.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(showList && options[active] ? options[active].value : draft);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          {showList && (
            <ul id={listId} role="listbox" aria-label="Matching roles" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
              {options.map((o, i) => (
                <li
                  key={`${o.custom}-${o.value}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o.value)}
                  onMouseEnter={() => setActive(i)}
                  className={cx("flex min-h-11 cursor-pointer items-center px-3 py-2 text-slate-900", i === active && "bg-brand-50", o.custom && "border-t border-slate-200 text-slate-700")}
                >
                  {o.custom ? (
                    <span className="truncate">
                      Add “<strong className="font-semibold">{o.value}</strong>” as typed
                    </span>
                  ) : (
                    <span className="truncate font-medium">{o.value}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
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
