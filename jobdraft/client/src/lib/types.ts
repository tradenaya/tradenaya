export interface User {
  id: number;
  name: string;
  email: string;
}

export type RunStatus = "running" | "ready_to_send" | "sending" | "sent" | "no_matches" | "failed" | "completed";
export type GmailStatus = "connected" | "disconnected" | "error" | "needs_reconnect" | "not_connected";

export interface ResumeSummary {
  fileName: string | null;
  uploadedAt: string | null;
  experienceYears: number;
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  location: string;
  currentTitle: string;
  companies: string[];
  roles: { title: string; company: string; start: string; end: string }[];
  skills: string[];
  education: { degree: string; institution: string; year: string }[];
  suggestedTargetRoles: string[];
}

/** Everything read from the resume that the user can correct (GET/PUT /api/profile/resume/details). */
export interface ResumeDetails {
  full_name: string;
  email: string;
  phone: string;
  linkedin: string;
  location: string;
  current_title: string;
  roles: { title: string; company: string; start: string; end: string; is_current: boolean; bullets: string[] }[];
  skills: string[];
  education: { degree: string; institution: string; year: string }[];
}

export interface ExcludedCompany {
  name: string;
  source: "resume" | "manual";
}

export interface Automation {
  enabled: boolean;
  changedAt: string | null;
  missing: string[];
}

export interface Profile {
  resume: ResumeSummary | null;
  preferences: { targetRoles: string[]; locations: string[]; expectedSalaryLpa: number | null; runTime: string; saved: boolean };
  excludedCompanies: ExcludedCompany[];
  automation: Automation;
  nextRunAt: string | null;
  gmail: { status: GmailStatus; address: string | null; connectedAt: string | null; lastError: string | null; allScopes: boolean; sendPausedUntil: string | null };
  complete: { resume: boolean; preferences: boolean; gmail: boolean };
}

export interface Run {
  id: number;
  trigger: "scheduled" | "manual";
  runDate: string;
  scheduledFor: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  draftsCount: number;
  autoSendCount: number;
  sentCount: number;
  linkOnlyCount: number;
  jobsConsidered: number;
  errorMessage: string | null;
}

export interface FollowUp {
  id: number;
  runItemId: number;
  sequence: 1 | 2;
  mode: "auto" | "draft";
  state: "scheduled" | "draft_created" | "sending" | "sent" | "cancelled" | "skipped" | "not_needed" | "expired" | "failed";
  dueAt: string;
  sendAt: string | null;
  sentAt: string | null;
  skipReason: string | null;
  createdAt: string;
}

export interface Application {
  id: number;
  type: "draft" | "auto_send" | "link_only";
  company: string;
  jobTitle: string;
  location: string | null;
  jobUrl: string | null;
  source: string;
  toEmail: string | null;
  subject: string | null;
  confidence: number | null;
  sendState: string;
  sendAt: string | null;
  sentAt: string | null;
  replyState: "none" | "replied" | "bounced";
  repliedAt: string | null;
  outcome: "open" | "replied" | "bounced" | "no_response" | "stopped";
  followupMode: "auto" | "draft";
  followupsStopped: boolean;
  note: string | null;
  skipReason: string | null;
  createdAt: string;
  status: { key: string; label: string; at?: string | null };
  followups: FollowUp[];
  canCancel: boolean;
  canStopFollowUps: boolean;
}

export interface UpcomingSend {
  kind: "email" | "followup";
  id: number;
  itemId: number;
  runId: number | null;
  label: string;
  company: string;
  jobTitle: string;
  toEmail: string;
  sendAt: string;
}

export interface Dashboard {
  automation: Automation;
  nextRunAt: string | null;
  runTime: string;
  lastRun: Run | null;
  upcoming: UpcomingSend[];
  followupDrafts: { id: number; itemId: number; sequence: number; company: string; jobTitle: string; createdAt: string; expiresAt: string }[];
  stats30: { sent: number; replies: number; followups: number; noResponse: number };
  runNowAvailableAt: string | null;
  sendingPausedUntil: string | null;
  profile: Profile;
  notConfigured: string[];
  mock: boolean;
  now: string;
}
