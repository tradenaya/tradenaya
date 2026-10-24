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

export type SendMode = "drafts_only" | "smart" | "send_all" | "send_all_instant";

export interface Automation {
  enabled: boolean;
  changedAt: string | null;
  missing: string[];
  /** Kept while automation is OFF; only applies while it is ON. */
  sendMode: SendMode;
  sendModeChangedAt: string | null;
}

export interface Profile {
  resume: ResumeSummary | null;
  preferences: { targetRoles: string[]; locations: string[]; expectedSalaryLpa: number | null; runTime: string; saved: boolean };
  excludedCompanies: ExcludedCompany[];
  automation: Automation;
  nextRunAt: string | null;
  gmail: { status: GmailStatus; address: string | null; connectedAt: string | null; lastError: string | null; allScopes: boolean; sendPausedUntil: string | null };
  /** The user's own Gemini key (never the key itself). */
  geminiKey: { saved: boolean; hint: string | null; status: "valid" | "invalid" | null; updatedAt: string | null; getKeyUrl: string };
  complete: { geminiKey: boolean; resume: boolean; preferences: boolean; gmail: boolean };
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
  /** What the run fetched, filtered, checked and created (null for runs before diagnostics existed). */
  funnel: Funnel | null;
}

export type JobSource = "adzuna" | "jsearch" | "mock";
export type QueryVariant = "plain" | "remote" | "wfh" | "startup" | "immediate" | "send_resume" | "walk_in";
export type RemovalStep = "excluded" | "seen" | "location" | "title" | "industry" | "seniority" | "experience" | "salary" | "agency" | "contacted" | "duplicate" | "other";

export interface Funnel {
  v: 1;
  sources: { source: JobSource; configured: boolean; calls: number; cached: number; fetched: number; errors: { status?: number; message: string }[]; note?: string }[];
  queries: { source: JobSource; variant: QueryVariant; role: string; location: string; query: string; where?: string; fetched: number; fromCache: boolean; error?: string }[];
  fetched: number;
  removed: Partial<Record<RemovalStep, number>>;
  afterFilters: number;
  aiChecked: number;
  suitable: number;
  emailsFound: number;
  drafted: number;
  autoSent: number;
  linkOnly: number;
  notChecked: number;
  variants: Partial<Record<QueryVariant, { fetched: number; emailApply: number }>>;
  note?: string;
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
  /** The sending mode when the email was created. */
  sendMode: SendMode | null;
  /** "Sent automatically", "Sent by you", "Draft – waiting for you"… */
  handling: { key: "auto" | "user" | "scheduled" | "draft" | "removed"; label: string };
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
