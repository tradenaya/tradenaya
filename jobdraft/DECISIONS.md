# Decisions made on your behalf

These are the choices made while building JobDraft without being able to ask, with the reason for each. **v2** marks decisions from the second spec: per-user run time, automation switch, auto-send, tracking and follow-ups.

## Isolation from Tradenaya

| Decision | Why |
|---|---|
| Everything lives in `jobdraft/`, with its own `package.json`, lockfiles, node_modules, env files, configs and tests. | Required. Nothing was added to Tradenaya's dependencies. |
| **Two one-line additive exclusions in Tradenaya's root config:** `"jobdraft"` in `tsconfig.json` → `exclude`, and `"jobdraft/**"` in `eslint.config.mjs` → `globalIgnores`. | Tradenaya's tsconfig includes `**/*.ts(x)` and its lint runs on the whole tree. Without these, `next build` would type-check JobDraft. On the VPS, where JobDraft's packages aren't installed, that fails ("Cannot find module 'express'") and **breaks Tradenaya's auto-deploy**. A TypeScript app in a folder named `jobdraft` can't avoid the root glob any other way. |
| `jobdraft/.gitignore` ignores node_modules, `.next*`, `dist`, test output, `.mock-storage` and real env files, but keeps `.env.example`. | The root `.gitignore` only ignores `/node_modules` at the root. |
| The client pins `turbopack.root` / `outputFileTracingRoot` to `jobdraft/client`. | Otherwise Next treats the Tradenaya repo root (its lockfile) as the workspace. |
| Ports: **5055** (API) and **3055** (web); e2e uses 5056/3056. | 3000/3001 are used by Tradenaya locally. |
| pm2 processes `jobdraft-server` (one instance) and `jobdraft-client`, deployed by hand. JobDraft is not in GitHub Actions or `deploy.sh`. | The brief forbids touching Tradenaya's deploy. One server instance avoids duplicate cron jobs; DB locks guard anyway. |
| Same Next (16.2.6), React (19.2.4), Tailwind v4, lucide-react and sonner versions as Tradenaya; TypeScript ~5.9; ESLint 9. | Consistent, and already proven on this machine. |

## Database

| Decision | Why |
|---|---|
| The DB is created and migrated **on server startup**, using ordered TypeScript migrations recorded in `schema_migrations`, under a MySQL `GET_LOCK`. | The cron jobs must work without API traffic. The lock handles several processes starting at once. |
| **v2 is an in-place migration** (version 2, `src/db/migration-v2.ts`), not a rebuild. It:<ul><li>renames `experience_years` → `total_experience_years`;</li><li>maps v1 `slot` → `trigger` (the morning run counts as the day's scheduled run, the others as manual);</li><li>maps `draft_state` → `send_state`;</li><li>back-fills `contacted_emails` from past drafts;</li><li>recreates `job_cache` (it's only a cache).</li></ul> | It keeps users, resumes and history. An integration test builds a v1 database with tricky rows and checks every conversion. |
| **v2:** existing Gmail connections become `needs_reconnect` and automation is set **OFF** during the migration. | v1 tokens lack `gmail.metadata`, so tracking would fail. It also guarantees nothing auto-sends from a real account until the user deliberately turns automation back on. |
| **v2:** one scheduled run per user per IST date is enforced by a generated column `scheduled_key` (= `run_date` for scheduled runs, NULL for manual) with `UNIQUE(user_id, scheduled_key)`. | As specified. NULLs never collide, so manual runs are unrestricted by the key. |
| **v2:** follow-ups are limited to 2 per application by `UNIQUE(run_item_id, sequence)`, `CHECK(sequence IN (1,2))`, and `CHECK(followup_count <= 2)` on `run_items`. | As specified. Requires MySQL 8.0.16+, where CHECK constraints are enforced. |
| Extra columns beyond the spec:<ul><li>`run_items.note` (why an item is link-only) and `sending_started_at` (crash recovery);</li><li>`followups.subject/body_preview` (history);</li><li>`gmail_connections.next_send_after` (the 2–4 minute gap, persisted).</li></ul> | Needed to make restarts safe and history readable. |
| All times are stored in UTC. `run_date` is the IST calendar date. Every scheduling decision uses `Asia/Kolkata` explicitly via **luxon**, whatever the process timezone. | Correct regardless of the server's TZ. Tests run it under UTC, New York, Kiritimati and London. |
| Tests use `jobdraft_test`, recreated per run through the real migrations and then dropped. The drop helper refuses names without `test`/`e2e`. | Clean, repeatable tests that can never drop `jobdraft`. |

## Security

| Decision | Why |
|---|---|
| Sessions: JWT (HS256, 7 days) in an httpOnly, SameSite=Lax cookie, `Secure` in production (`COOKIE_SECURE` overrides). | As specified. |
| bcrypt cost 12. Passwords are 8–72 characters (bcrypt's limit). Login compares against a dummy hash for unknown emails, with generic errors. | Prevents account enumeration. |
| Rate limits: 20 login/register attempts per 15 min per IP, 300 API requests per minute per IP, and Run now once per 30 min per user (from the DB). | As specified. DB enforcement survives restarts. |
| CORS only for `CLIENT_URL`; helmet; `trust proxy` = loopback. | As specified, and rate limits use real client IPs behind nginx. |
| The Gmail OAuth `state` is a signed JWT bound to the user **plus** an httpOnly nonce cookie. | Stronger CSRF protection than a signed state alone. |
| Refresh tokens are AES-256-GCM encrypted and never sent to the client. Reconnecting revokes the previous token. | As specified. |
| **v2:** granted scopes are stored. A missing `gmail.compose` or `gmail.metadata` → `needs_reconnect`, automation OFF, and a "tick every box" banner. | As specified. |
| MIME header values are stripped of CR/LF. | Prevents header injection from AI- or posting-supplied text. |
| JSON logs carry ids and counts only. Keys that look like secrets or PII are redacted automatically. | As specified. |
| **No forgot-password in v1.** | Out of scope. It needs an email-sending service. |
| Account deletion ("Deactivate account" in the UI) asks for the password inside a confirmation dialog. The dialog states that it permanently deletes everything, stops all drafting, and that re-registering starts fresh. | Requested UI wording; the password stops a borrowed session from wiping an account. Scheduled sends are cancelled and every row cascades away. |
| **v2:** an e2e-only route `POST /api/__test/tick` (advance the server clock and run the send queue) is mounted **only** when `NODE_ENV=test` **and** `MOCK_EXTERNAL=true`. A test proves it's absent otherwise. | The browser test needs to see a sent email without waiting 30 real minutes. |

## Resume and companies to skip

| Decision | Why |
|---|---|
| **unpdf** extracts text. Fewer than 200 non-whitespace characters → rejected as scanned. MIME type plus `%PDF-` magic bytes are required (octet-stream is accepted only for `.pdf` names, for Android pickers). | As specified, and works on phones. |
| Experience is computed in code. Overlapping roles are merged. Internships are excluded. `is_current` roles (v2) run to today. A bare year means January. | "Don't trust the model for arithmetic", without overstating experience. |
| **v2:** every resume employer (including internships and the current one) is saved as a `resume` exclusion **only after** the new resume fully succeeds. `manual` exclusions are kept on replace. | As specified: a failed replace keeps the old data intact. |
| **v2:** the excluded-company match:<ul><li>normalises suffixes (pvt, ltd, india, technologies, solutions, software, services, labs, systems, group, …);</li><li>matches equal keys, token containment, or Jaro-Winkler ≥ 0.9;</li><li>matches email/URL domains containing the key (keys under 4 letters are ignored for domains, to avoid false hits);</li><li>is checked again on the model's `real_employer_name`, and again right before sending.</li></ul> | As specified. Containment deliberately errs on the side of skipping (e.g. "Kestrel Labs" also skips "Kestrel Analytics"). Never contacting a past employer matters more than one extra job. |
| Removing a "from resume" chip asks for confirmation. Saving applies it. | As specified. |

## Scheduling (v2)

| Decision | Why |
|---|---|
| One shared function, `nextRunAt`, decides "today at run time" vs "tomorrow at run time". Today counts only if:<ul><li>no scheduled run happened today;</li><li>the slot was set up **before** it came round (later than `run_time_changed_at` and `automation_changed_at`);</li><li>it is less than 3 hours old.</li></ul>The scheduler's "due" check is `nextRunAt ≤ now`, and the UI hint calls the same function through `GET /api/profile/next-run`. | Changing the time or turning automation on never triggers an immediate run. Missed runs are caught up once within 3 hours. UI and scheduler always agree. |
| The 3-hour catch-up window doesn't cross midnight. | A 23:45 run missed until 00:30 belongs to yesterday, which already passed; today's 23:45 is next. Simple and predictable. |
| **Two** per-minute cron jobs (runs, send queue) with **separate** DB locks (`job_locks`). Tracking runs every 2 hours and follow-ups at 10:00 IST daily, each under its own lock. Follow-up processing also runs once at startup; it's idempotent. | A long run never blocks sending. Overlapping firings or processes simply skip. |
| Due users are processed two at a time, each isolated. Nobody is skipped under load: a user stays due for 3 hours, so the next minute's pass picks them up. | As specified. |
| Fetched postings are reused across users for **6 hours** per (source, query, location). Manual runs use the same cache. | As specified. Saves the small JSearch quota. |

## Sending policy (v2; per-user sending modes added in v4, see below)

| Decision | Why |
|---|---|
| Auto-send needs confidence ≥ 85, no scam/agency flag, all safety checks, automation ON, and Gmail connected. Limits: 5 per run, 8 per IST day (manual runs included), 10 new emails per run, 15 link-only. | As specified. |
| `send_at` = run finish + 30 min. The queue sends one per user per pass, with a random 2–4 minute gap persisted in `next_send_after`, via `drafts.send` (the exact draft, which then appears in Sent). | As specified. Persisting the gap survives restarts. |
| Atomic claim `UPDATE … WHERE state='scheduled'` (1 row or skip). A crash leaves `sending` items; after 10 minutes, recovery asks Gmail: if the draft is gone it was sent (tracking confirms), otherwise it is retried. | "Never twice", even with crashes: Gmail removes a draft when it is sent, so a missing draft can't be sent again. |
| `sendDraft` is never auto-retried inside one attempt. Failed attempts are retried by the queue 15+ minutes later, at most 3 attempts in total, then `failed`. | A timeout might mean it was sent; the next attempt's "draft exists?" check decides. |
| A rate-limit or quota error pauses that user for 24 h, and every waiting send or follow-up becomes `skipped` (it stays a Gmail draft). | As specified ("keep the remaining items as drafts"). |
| Cancelling an auto-send makes it a normal draft (`followup_mode='draft'`). If the user later sends it by hand, tracking sees it and draft-mode follow-ups apply. | Matches "a cancelled email stays as a normal draft". |
| Generated `Message-ID` on the sender's Gmail domain, plus `Reply-To` = the user's address. Plain text only; the only link is the user's LinkedIn. | As specified, and needed for threading follow-ups. |
| Body style checks reject hype words, emojis, words in ALL CAPS (5+ letters, except resume skills), "!!", placeholders, and overstated experience. | "Professional tone, no hype words, emojis or ALL CAPS". |

## Tracking and follow-ups (v2)

| Decision | Why |
|---|---|
| Tracking uses `threads.get(format: "metadata")` on stored thread ids only:<ul><li>**sent**: SENT label, not DRAFT;</li><li>**removed**: thread 404 and nothing sent;</li><li>**replied**: a message after our first sent one, from another address, that isn't a bounce;</li><li>**bounced**: mailer-daemon/postmaster or a delivery-failure subject.</li></ul> | `gmail.metadata` forbids search (`q`) and bodies. |
| Follow-ups sent by hand are matched by Message-ID, or else by order: the 2nd/3rd SENT message in the thread = follow-up 1/2. | Gmail may rewrite Message-IDs when a user edits a draft. |
| The follow-up row is inserted **before** the Gmail draft is created. A duplicate-key error means another worker won. The queue only sends follow-ups that have a draft id. | Layer 3 of the "max 2" rule, and safe under parallel workers. |
| Due times:<ul><li>a follow-up is due once the first 10:00 IST slot on a weekday ≥ base + 7 days arrives (base = original sent, or follow-up 1 sent);</li><li>`due_at` is a random minute in that day's 10:00–11:30 window, never earlier than now;</li><li>auto mode sends at `max(due_at, now + 30 min)`.</li></ul> | Weekday business hours, the cancel window, and "never send early". |
| No follow-ups are **created** on weekends. The daily cap of 5 per user counts follow-ups due that IST day; the rest stay due and are created the next weekday. | As specified. |
| Follow-up text: Gemini first, then the same safety and style checks plus a "no pressure" check (e.g. "haven't heard back"). If that fails twice, a short factual template from the resume is used. The signature is always added in code. | A good follow-up is never lost to a model hiccup, and the facts stay accurate. |
| Applications close as **No response** 7 days after follow-up 2 is sent, when a draft follow-up expires, or after the 45-day tracking window. | As specified, and nothing stays "open" forever. |
| Disconnecting Gmail cancels scheduled sends and follow-ups (kept as drafts) and turns automation OFF. | As specified. |

## UI

| Decision | Why |
|---|---|
| Phones: sticky header plus a bottom tab bar (56 px+, safe-area padding). ≥768 px: top nav. Content is up to ~1150 px wide, with **two columns on desktop** for Dashboard, Setup, History details and Account. | Mobile-first; desktop widened as requested. |
| **Light and dark mode**: a sun/moon toggle in the header (and on login/register). It starts from the system setting, is remembered in `localStorage`, and a tiny head script applies it before first paint. Dark mode swaps the colour variables the components already use, so every screen and badge keeps AA contrast pairs. | Requested. One place to maintain colours, and no flash of the wrong theme. |
| Password fields have an eye button (show/hide). Every clickable control shows a pointer cursor. | Requested. |
| Run time: the native `<input type="time" step=900>` (snapped to 15 minutes, since iOS ignores `step`), shown next to a readable "9:00 AM IST". Browsers without a time input get a 96-option list. The live "Next run" hint comes from the server. | Mobile-friendly with a clear fallback, as specified. |
| Toasts sit below the header; the Next.js dev indicator sits top-right. | Found by e2e: they were covering navigation. |
| Role chips are pre-filled from resume suggestions until the user saves their own. Automation starts **OFF** for new users. | v2 spec ("automation_enabled default false"). |

## Testing

| Decision | Why |
|---|---|
| Vitest + supertest. Unit tests also have a DB-free config (`npm run test:unit --prefix server`). Integration tests use a **fake clock** to simulate days and weeks of cron activity, plus a mock Gmail with threads, replies, bounces, rate limits and failures. | The spec's follow-up and scheduling guarantees need weeks of simulated time. |
| Playwright runs against a **production build** of the client and a mock-mode server, in the already-installed Microsoft Edge. | "Reuse browsers, don't download". A production build also avoids dev-only overlays. |
| Mock postings include traps the pipeline must reject: agency, scam, too senior, low salary, internship, noreply, no email, and the test resume's past employers by name, through a portal "for our client", and by web domain. All mock companies and domains are fictional. | The whole pipeline and every safety check runs end to end without keys or real email. |

## Gemini

| Decision | Why |
|---|---|
| `GEMINI_MODELS` = `gemini-flash-latest,gemini-flash-lite-latest,gemini-3.8-flash,gemini-3.5-flash-lite`. | Your aliases first, then the stable IDs Google's model page currently recommends, as fallbacks. |
| Structured output (`responseJsonSchema`, temperature 0.2) + zod. 429/5xx errors are retried with backoff before moving to the next model; 401/403 stop immediately. A 1.5 s delay between job checks. | Reliable JSON within free-tier limits. |

## v3: missing runs, run funnel, more productive search

### Why History showed no runs

| Finding | What changed |
|---|---|
| The full scheduler path was traced: cron registration in the production entry point (`index.ts` → `startScheduler`, not dev-only), the per-minute pass, Asia/Kolkata handling, the due rule, the run claim and errors. Cron itself works: a real `node-cron` per-minute task fired on time with the process timezone set to UTC. IST maths, the TIME column parsing and the unique per-day claim were correct, and the existing tests covered them. | Added tests for IST with `TZ=UTC`, stale-lock reclaim and stuck runs. |
| **The gap: the scheduler's due-user query only selected users whose Gmail status was `connected`.** A user with automation ON whose Google access expired or was revoked (`invalid_grant` → status `error`; Google expires tokens after 7 days while the OAuth app is in Testing mode), or who lacked a permission, was skipped **silently every minute**: no run row, no History card, no log line, automation still showing ON. Incomplete setup was skipped the same silent way. This matches "History shows nothing at all" for a user with automation ON. I can't read the production database from here, so `npm run diagnose` (below) confirms the exact cause on the VPS. | The scheduler now starts from **every** automation-ON user. If the run time comes and setup or Gmail blocks the run, it records a **failed run card** for that day saying what to fix ("Today's run couldn't start: reconnect gmail (access expired)…"). It is reported once per day, never silently skipped. |
| A hung network call inside a run held the `scheduler` lock forever (the heartbeat kept renewing it), which would block every user's runs. googleapis calls had no timeout. | Runs are **claimed** under the lock (quick) and **processed outside** it (2 at a time per process). Locks stop renewing after 2 hours (`maxHoldMs`), Gmail calls time out after 60 s, a run stops itself after 20 minutes, and every pass closes runs stuck in "running" for over 45 minutes (before, only a restart did). |
| Nothing showed how many users were due or why others were skipped. | Startup logs every registered cron job. `LOG_LEVEL=debug` logs each minute: automation-ON users, due, blocked, waiting (by reason). `npm run diagnose` prints a per-user explanation: run time, Gmail state, permissions, what blocks them, next run, last 3 runs, plus locks and today's job-source usage. Read-only, IDs only. |
| JSearch had been returning zero jobs: the code read jobs from `data`, while v5 returns them in `data.jobs`. | Rewritten to the verified v5 shape (below). |

### Funnel

| Decision | Why |
|---|---|
| Stored as JSON on `runs.funnel` (migration v3); `run_items.query_variant` records which search found each job. | One read for History; no extra tables per step. |
| Steps: fetched (per source and per search, with errors and notes), removed per filter step, AI-screened, suitable, with an email, drafted, auto-sent, link-only, left for the next run, and per search variant: fetched / with an email. At most 80 searches are stored per run. | What the spec asked for, with enough detail to answer "why nothing?". |
| A run that fetched nothing stores a one-line reason (per source: not configured, error with HTTP status, daily cap, quota exhausted, returned 0) as its message, shown on the card. | "If 0 jobs are fetched, the run card must say why." |

### Adzuna

| Decision | Why |
|---|---|
| **The role goes in `title_only`, not `what`.** Remote searches keep `what=remote` / `what=work from home`. | Measured on the live API (Product Manager, Pune, 7 days, 50 newest): `what` returned 9 relevant of 50 (the rest were "Relationship Manager – Phone Banking", "Data Engineer"…, of 129 broad matches); `title_only` returned all 14 relevant postings in one call. Same number of calls, far better results. |
| One search per (role, area). Areas: Bengaluru + Bangalore, Mumbai + Navi Mumbai + Thane, Pune + Pimpri-Chinchwad, Hyderabad + Secunderabad (also Delhi/New Delhi, Gurugram/Gurgaon). Location matching accepts the same areas. `max_days_old=7`, `results_per_page=50`, `sort_by=date`. | As specified. |
| Daily cap 230 calls (IST day) across all users, counted atomically in `api_usage` (`ADZUNA_DAILY_CAP`). Cache 6 hours, shared by all users; identical searches from different users are made once. HTTP 401/403 stops further Adzuna calls in that run. | Free plan: 250 calls/day. |

### JSearch

| Decision | Why |
|---|---|
| Request and response exactly as verified: `country=in`, `date_posted=week`, `num_pages=1`, `language=en`; `status === "OK"`; jobs in `data.jobs`; `data.cursor` for page 2. A non-OK status is an error, not "0 jobs". | Defaults return old, US jobs. |
| India only: `job_country === "IN"`, or remote with no country / mentioning India. Dedupe on `job_uid`, then `job_id`. Apply link: a direct `apply_options` entry first, else `job_apply_link`. Posted date: `job_posted_at_datetime_utc`, else the timestamp, else unknown (kept). Salary only for Indian postings. | As specified. |
| Variants: plain, "startup", "hiring immediate joiner", "send resume", "walk-in" (no remote walk-ins). | Email-apply postings come mostly from small employers. |
| Cap: `JSEARCH_DAILY_CAP` (default 6) across all users, plus `JSEARCH_MAX_CALLS_PER_RUN` (default 4) per run, so one user's run can't use the whole day. Cache 12 hours. Rotation: cached searches first (free), then the **least recently searched** (role, city, variant), never-searched first, plain variants before the others. A second page only when the first page had at least 5 postings that pass the title and location checks. HTTP 429 marks the day exhausted; 401/403 stops JSearch for the run. A missing key is noted, not an error. | Least-recently-searched rotation covers every combination over the days without a schedule table. At 6 calls a day, all combinations are covered within a week when there are at most 42 (e.g. 2 roles × 5 cities × 4–5 variants); more combinations take proportionally longer. |

### Matching

| Decision | Why |
|---|---|
| Role families (product, project, delivery, business analyst, implementation, customer success, scrum, team lead) on top of token matching: "Product Owner", "Associate PM" and "PM" match Product Manager; "Technical Program Manager" and "Project Coordinator" match Project Manager; and so on. A bare "PM" counts as product only when the title isn't a project/program title. Families never cross ("Project Manager" ≠ "Product Manager"). | Broader without mixing different jobs. |
| A non-software domain word in the title (civil, mechanical, construction, pharma, veterinary, ruminant, manufacturing, solar…) never matches a role that doesn't contain it. For generic titles with no software word, the description decides: 2+ non-software domain words and at most 1 software word → removed as "not a software / IT role". | "Civil Project Manager" and "Product Manager – Ruminant (veterinary)" must not match. |
| Seniority: only director / head / VP / principal (and C-level) titles are skipped, and only for users under 5 years. "Senior", "Senior Associate" and "Lead" are allowed; the stated minimum experience decides. Internships (1+ year) and junior titles (5+ years) are still skipped. | As specified. |
| Experience: the smallest stated minimum ("7+ years", "3-5 years", "3 to 5 yrs", "15+ Years" in a title) must be at most your experience + 2; unstated is kept. Company age ("25+ years of excellence") is ignored. | As specified, avoiding a common false match. |
| AI: up to **15 postings screened per run, 5 per Gemini call** (suitability, confidence, scam/agency, real employer). Postings that contain an email address are screened first. An email is then written (one more call) only for suitable postings whose own text contains a real address, and every existing safety check (verbatim address, excluded companies, caps, auto-send rules) still applies. Two AI failures in a row stop the run with what it has. | More postings checked per AI call, and email-apply jobs aren't crowded out. |
| Suitable postings without an email (or over the 10-email cap) go to **Apply via link** with their apply URL (cap 15 per run, unchanged). | "It must appear in the Apply via link list." |

### Setup page

| Decision | Why |
|---|---|
| Under Target roles, besides "Suggested from your resume", a "Related roles you could also target" group: for product/project/analyst/consultant-type resumes, Associate Project Manager, Project Coordinator, Business Analyst, Implementation Consultant, Technical Account Manager, Customer Success Manager, Scrum Master, Delivery Manager; for engineering resumes, neighbouring developer roles. One tap adds a tag. | The spec's list fits management profiles; showing it to a developer would be noise. |

## v4: sending modes (override the v2 sending policy where they differ)

| Decision | Why |
|---|---|
| `profiles.send_mode` ENUM('drafts_only','smart','send_all','send_all_instant') default `smart`, plus `send_mode_changed_at` (migration v4, applied on startup). Existing users get `smart`, the previous behaviour, and existing emails are marked `smart`. | As specified. |
| One table of per-mode rules (`SEND_MODES` in `runs/safety.ts`): Drafts only → nothing auto-sent; Smart send → confidence ≥ 85, 5 per run, 8 per IST day, 30-min window; Send all → any suitable email that passed the hard checks, 15 per day, 30-min window; Send all instantly → the same with no window. In the send-all modes the per-run limit is the existing 10 new emails per run. | The spec gives daily caps for the send-all modes and no per-run cap; Smart send keeps its existing 5-per-run limit. |
| "Suitable email that passes all hard safety checks" = what already becomes an email: suitable, not scam/agency (those are never even drafted by the safety checks), a verbatim application address and every body check passed. Scam/agency flags are also checked again at classification, so they can never be auto-sent in any mode. | Every existing safety check is kept; the mode only decides auto-send vs draft for emails that passed them. |
| The mode is read again right before each email is classified, and stored on the item (`run_items.send_mode`). If it changes to Drafts only during a run, the run's auto-sends are cancelled when it finishes. | "Changing the mode affects only emails created after the change." |
| Send all instantly: `send_at` = the run's finish time; the queue still sends one email per 2–4 minutes per user. | "Queued to send immediately… still with the 2–4 minute gap." |
| Changing the mode needs automation ON (`PUT /api/automation/send-mode`, 400 "Turn on automation to use sending modes." otherwise); the saved value is kept while OFF. Switching to Drafts only cancels every scheduled send and follow-up at once (kept as drafts). Switching to a send mode never touches existing drafts. | As specified. |
| The send queue re-reads the profile on every pass, so it always sees the **current** mode: Drafts only → the email or follow-up is skipped with the reason "mode changed to drafts only". | Also covers a mode changed from another device or tab between passes. |
| `run_items.sent_by` ('auto' / 'user'): the queue sets `auto` when it sends; Gmail tracking sets `user` when it finds a draft sent by hand. Backfill for older rows: `auto` if it was an auto-send the queue attempted, otherwise `user`. A crash-recovered send (draft gone after the queue claimed it) counts as `auto`. History shows "Sent automatically", "Sent by you", "Will be sent automatically" or "Draft – waiting for you". | Telling these apart needs to know who sent it; nothing recorded that before. |
| Follow-ups: auto only when the original's follow-up mode is auto **and** the queue sent it (`sent_by = 'auto'`); always drafts in Drafts only (checked when each follow-up is created, and again before sending). Auto follow-up window: 30 min in Smart send and Send all, none in Send all instantly (the follow-up still waits for its 10:00–11:30 weekday slot). | As specified ("auto if its original email was sent automatically"). An auto-send the user sent by hand during its window counts as sent by the user. |
| UI: four toggle cards in a radio group directly under the automation switch on Setup (`#send-mode`), each with a title and one line; the selected card has a check and a brand outline; "Recommended" badge on Smart send; every card is at least 44px tall. Disabled with "Turn on automation to use. Your choice is kept." while automation is OFF. The dashboard shows "Sending mode: … · Change" inside the automation card. The automation switch's text and its "Turn on" confirmation describe the selected mode. | As specified. |
| **Every** mode change asks for confirmation, not only Send all instantly. Send all instantly uses the exact text "Emails will be sent without a chance to cancel. Continue?" (red Continue button); Drafts only says scheduled sends will be cancelled. | You asked for confirmation popups on every important create/update/delete action; changing what gets sent from your Gmail is one. |
| Found while testing: after connecting Gmail, Setup removed `?gmail=connected` from the address with `router.replace`, and later links to `/setup` (such as the dashboard's "Change") landed back on the old `?gmail=connected` address, showing the "Gmail connected" toast again. It now uses `window.history.replaceState`, which the App Router supports. | The dashboard "Change" link has to land on the Sending mode section. |

## v5–v6: own Gemini key, reschedule today

| Decision | Why |
|---|---|
| Each user brings their own Gemini key: required at registration (checked with Google before the account is created) and managed on Setup (replace / remove, with a "Get your free key" link to aistudio.google.com/apikey and 3 steps). Stored AES-256-GCM encrypted; only the last 4 characters are shown. `GEMINI_API_KEY` in the server .env is no longer used. | One shared key would hit its limit with many users. |
| Format check is deliberately loose (any 20–300 characters without spaces); Google decides whether a key works. | Google key formats change; a strict pattern rejected a real key. |
| Missing key → resume reading refused, automation blocked, "couldn't start" card. Key rejected during a run → run stops at once (no retries), key marked invalid, Setup asks for a new one. Quota limits are tracked per key. | Clear, never silent. |
| A scheduled run is unique per user per IST day **and run time** (migration v6). After a 9:00 run, moving the time to a later time today runs today at the new time; a time already past waits for tomorrow; the same time never runs twice. | Requested: changing the time to later today should apply today. |
| JSearch now calls `/search-v2`: RapidAPI answered 404 "Endpoint /search does not exist" on every call (verified live; /search-v2 returns the v5 shape). | All JSearch calls were failing. |
| Adzuna: main city only (no alias searches), calls spaced ~2.6 s apart, a 503/429 retried once after 10 s, and Adzuna stops for the run after 3 busy searches in a row. | 88 back-to-back searches got HTTP 503 (per-minute limit) and would also exceed the weekly limit. Matching still accepts nearby areas. |
| Target roles can be a deliberate career move (e.g. developer → product/project management). The AI counts entry, associate, junior and "open to engineers" roles in the new field as suitable (not roles needing years of direct experience there), and the email connects real experience to the new role without claiming experience the user doesn't have. All target roles count equally when choosing what to screen; postings with an email address go first. | Requested: a developer moving into management wants those roles emailed too. |
| AI screening has no fixed cap (`MAX_SCREEN_PER_RUN`, default 0 = none): 10 postings per Gemini call until every posting is checked, the user's key hits its limit, or the run nears its 20-minute limit. Hitting the limit stops calmly: the run keeps what it made and its card says how many postings carry over (unchecked postings aren't marked seen). Order: application email > title close to a target role > JSearch (full description) > newest, so a limited key is spent on the best postings. | Requested: check as many as possible; 15 (then 60) missed good postings. |
| Target roles box: autocomplete from ~150 common titles, tolerant of spelling mistakes ("Assistant Producer Manager" → "Assistant Product Manager", "projct manger" → "Project Manager"), plus "Add … as typed" for custom titles. | Fewer typos, and titles that job sites actually use. |
