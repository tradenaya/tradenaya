"use client";

import { Label } from "@/components/ui/label";

export type CoinUniverse = "MAJORS" | "TOP_VOLUME";

const OPTIONS: { value: CoinUniverse; label: string; hint: string }[] = [
  { value: "MAJORS", label: "Major coins only", hint: "BTC, ETH, SOL, XRP, BNB, DOGE — steadier, and what Trend Breakout was tested on." },
  { value: "TOP_VOLUME", label: "Top 10 by volume", hint: "Whatever trades most on CoinSwitch right now — often hype/meme coins with bigger swings." },
];

/** "Coins to scan" choice for auto-select bots. */
export function CoinUniversePicker({ value, onChange }: { value: CoinUniverse; onChange: (v: CoinUniverse) => void }) {
  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[1];
  return (
    <div className="space-y-1.5">
      <Label>Coins to scan</Label>
      <div role="radiogroup" aria-label="Coins to scan" className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              value === o.value ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{active.hint}</p>
    </div>
  );
}
