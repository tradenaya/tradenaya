"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STRATEGIES, strategyInfo } from "@/automation/strategy/catalog";

/** Strategy select + one-line explanation, shared by the bot and backtest dialogs. */
export function StrategyPicker({
  value,
  onChange,
  disabled,
  id = "strategy",
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const info = strategyInfo(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Strategy</Label>
      <Select value={info.id} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STRATEGIES.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {info.summary}
        {info.fixedTimeframe ? ` Runs on ${info.fixedTimeframe} candles only.` : ""}
      </p>
    </div>
  );
}
