import { FileText } from "lucide-react";
import { ThemeToggle } from "@/components/theme";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="pt-safe pb-safe relative flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center">
      <ThemeToggle className="absolute right-3 top-3" />
      <div className="mb-6 flex items-center gap-2 text-xl font-bold text-slate-900">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-600 text-white">
          <FileText className="size-6" aria-hidden />
        </span>
        JobDraft
      </div>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">{children}</div>
      <p className="mt-6 max-w-sm text-center text-sm text-slate-600">
        JobDraft finds jobs that accept email applications and prepares drafts in your own Gmail. Nothing is ever sent for you.
      </p>
    </main>
  );
}
