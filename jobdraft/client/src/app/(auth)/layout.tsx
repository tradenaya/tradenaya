import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    // Centred vertically on every screen size; on short screens it simply scrolls (min-h, not h).
    <main className="pt-safe pb-safe relative flex min-h-dvh flex-col items-center justify-center px-4 py-16">
      <ThemeToggle className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))]" />
      <Logo size="lg" className="mb-6" />
      <div className="w-full max-w-sm animate-rise rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">{children}</div>
      <p className="mt-6 max-w-sm animate-rise text-center text-[15px] font-medium text-slate-600 [animation-delay:120ms]">Your job hunt, on autopilot.</p>
    </main>
  );
}
