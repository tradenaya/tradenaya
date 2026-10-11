"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage, rawErrorMessage, technicalLines } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** The thrown value (ApiError, Error or string). */
  error: unknown;
  /** Short readable heading, e.g. "Couldn't load open positions". */
  title?: string;
  onRetry?: () => void;
  /** Inline one-line variant for small widgets / table cells. */
  compact?: boolean;
  className?: string;
}

/**
 * Consistent error display: readable message for the user plus a collapsible
 * "Technical details" panel (endpoint, HTTP status, DB/exchange error, stack)
 * that developers can copy straight into a bug report.
 */
export function ErrorState({ error, title = "Something went wrong", onRetry, compact = false, className }: ErrorStateProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const message = errorMessage(error);
  const lines = technicalLines(error);
  const technical = [`${title}: ${rawErrorMessage(error)}`, ...lines].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(technical);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — the details stay visible to select manually
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-red-500/30 bg-red-500/5 text-sm",
        compact ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 shrink-0 text-red-400", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("font-medium text-red-300", compact && "text-xs")}>{title}</p>
          <p className={cn("break-words text-red-200/90", compact ? "text-[11px]" : "text-xs")}>{message}</p>

          {lines.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-red-300/80 hover:text-red-200"
              >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Technical details
              </button>
              {open && (
                <div className="mt-1.5 rounded-md border border-red-500/20 bg-black/30">
                  <div className="flex justify-end border-b border-red-500/10 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => void copy()}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-2 py-1.5 font-mono text-[11px] leading-relaxed text-red-100/80">
                    {lines.join("\n")}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size={compact ? "xs" : "sm"}
            onClick={onRetry}
            className="shrink-0 border-red-500/30 text-red-200 hover:bg-red-500/10"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}
