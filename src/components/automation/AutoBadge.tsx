import { cn } from "@/lib/utils";

/** Small fixed-size badge for auto-select bots. Keeps card widths uniform vs. the word "AUTO". */
export function AutoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Auto-select coin"
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-emerald-500/10 text-[10px] font-bold leading-none text-emerald-500/80",
        className,
      )}
    >
      A
    </span>
  );
}