import type { SendMode } from "./types";

export interface SendModeOption {
  value: SendMode;
  title: string;
  description: string;
  recommended?: boolean;
}

/** The four sending modes, in the order shown. Smart send is the default. */
export const SEND_MODE_OPTIONS: SendModeOption[] = [
  { value: "drafts_only", title: "Drafts only", description: "Every email waits in your Gmail drafts. Nothing is sent for you." },
  { value: "smart", title: "Smart send", description: "Strong matches are sent after a 30-minute window to cancel; the rest stay as drafts.", recommended: true },
  { value: "send_all", title: "Send all", description: "Every suitable email is sent after a 30-minute window to cancel." },
  { value: "send_all_instant", title: "Send all instantly", description: "Every suitable email is sent as soon as the run finishes, with no chance to cancel." },
];

export const sendModeTitle = (mode: SendMode) => SEND_MODE_OPTIONS.find((o) => o.value === mode)?.title ?? "Smart send";

/** What a run does with the emails it prepares, in this mode (automation ON). */
export function automationOnText(mode: SendMode): string {
  switch (mode) {
    case "drafts_only":
      return "Every day at your run time, JobDraft finds matching jobs and prepares emails in your Gmail drafts. Nothing is sent for you.";
    case "send_all":
      return "Every day at your run time, JobDraft finds matching jobs and emails every suitable one from your Gmail, after a 30-minute window to cancel.";
    case "send_all_instant":
      return "Every day at your run time, JobDraft finds matching jobs and emails every suitable one from your Gmail as soon as the run finishes.";
    default:
      return "Every day at your run time, JobDraft finds matching jobs and prepares emails in your Gmail. Only the strongest matches are sent automatically, after a 30-minute window to cancel; the rest wait in your drafts.";
  }
}
