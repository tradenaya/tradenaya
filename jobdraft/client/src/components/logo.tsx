import Image from "next/image";
import markDark from "@/assets/jobdraft-mark-dark.png";
import mark from "@/assets/jobdraft-mark.png";

// Local helper: this component also renders on the server (auth layout), so it
// can't import from the client-only ui.tsx.
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const SIZES = {
  sm: { mark: "h-7", text: "text-lg" },
  lg: { mark: "h-14", text: "text-2xl" },
};

/** The JobDraft "JD" mark (indigo → violet; brighter in dark mode) with an optional wordmark. */
export function Logo({ size = "sm", withText = true, animate = true, className }: { size?: keyof typeof SIZES; withText?: boolean; animate?: boolean; className?: string }) {
  const s = SIZES[size];
  const alt = withText ? "" : "JobDraft";
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span className={cx("inline-flex", animate && "animate-dash-in")}>
        <Image src={mark} alt={alt} priority className={cx(s.mark, "w-auto dark:hidden")} />
        <Image src={markDark} alt={alt} priority className={cx(s.mark, "hidden w-auto dark:block")} />
      </span>
      {withText && <span className={cx(s.text, "text-brand-gradient font-extrabold tracking-tight")}>JobDraft</span>}
    </span>
  );
}
