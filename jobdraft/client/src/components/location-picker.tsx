"use client";

import { MapPin } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { locationLabel, searchLocations } from "@/lib/cities";
import { RemovableChip } from "./chip-input";
import { cx, Input } from "./ui";

/** Multi-select combobox over the bundled city list (no external API). */
export function LocationPicker({
  id,
  values,
  onChange,
  max,
  invalid,
  describedBy,
}: {
  id: string;
  values: string[];
  onChange: (v: string[]) => void;
  max: number;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const full = values.length >= max;
  const options = useMemo(() => searchLocations(query, values), [query, values]);

  function pick(value: string) {
    if (full || values.includes(value)) return;
    onChange([...values, value]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  const showList = open && !full && options.length > 0;
  return (
    <div>
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Selected locations">
          {values.map((v) => (
            <RemovableChip key={v} label={locationLabel(v)} onRemove={() => onChange(values.filter((x) => x !== v))} />
          ))}
        </ul>
      )}
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          enterKeyHint="search"
          invalid={invalid}
          disabled={full}
          placeholder={full ? `Up to ${max} locations` : "Search city, e.g. Bengaluru or Remote"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
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
              if (showList && options[active]) {
                e.preventDefault();
                pick(options[active].value);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {showList && (
          <ul id={listId} role="listbox" aria-label="Locations" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value)}
                onMouseEnter={() => setActive(i)}
                className={cx("flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2", i === active ? "bg-brand-50" : "")}
              >
                <MapPin className="size-4 shrink-0 text-slate-500" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{o.label}</span>
                  <span className="block truncate text-sm text-slate-600">{o.hint}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {open && !full && query && options.length === 0 && (
          <p className="absolute z-20 mt-1 w-full rounded-xl bg-white p-3 text-slate-600 shadow-lg ring-1 ring-slate-200">No matching city. Try another spelling.</p>
        )}
      </div>
    </div>
  );
}
