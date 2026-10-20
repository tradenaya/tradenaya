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

## Sending policy (v2, fixed)

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
