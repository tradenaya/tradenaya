# JobDraft

JobDraft is a small multi-user web app. Each user uploads a resume, picks target roles, locations, an expected salary and a **daily run time** (9:00 AM India time by default), and connects their Gmail.

Once a day, at that user's time and only while their **automation switch is ON**, the server looks for genuine job postings that accept applications **by email**. For each match it writes a tailored email, with the resume attached, in the user's **own Gmail**:

- **Strong, high-confidence matches are sent automatically**: slowly, a few at a time, after a 30-minute cancel window.
- **Everything else is saved as a Gmail draft** for the user to review and send.
- JobDraft **never contacts a company the user has worked for**.
- It tracks whether each application was sent, replied to or bounced. With no reply, it sends **at most two polite follow-ups, ever** (around day 7 and day 14), as replies in the same thread. After that the application is marked "No response" and never contacted again.

It lives inside the Tradenaya repository but is completely separate: its own packages, lockfiles, env files, MySQL database (`jobdraft`), ports and pm2 processes.

```
jobdraft/
├── package.json            setup / dev / build / start / test / test:e2e
├── ecosystem.config.cjs    pm2: jobdraft-server (single instance), jobdraft-client
├── README.md · SETUP.md · DECISIONS.md
├── server/                 Express + TypeScript API, cron jobs, MySQL migrations
│   ├── src/
│   │   ├── index.ts        startup: env → create DB + migrate → HTTP → cron jobs
│   │   ├── app.ts          Express app (helmet, CORS, rate limits, routes)
│   │   ├── config/         env loading, auto-generated secrets, feature flags
│   │   ├── db/             pool, migrations v1–v3 (schema_migrations), bootstrap
│   │   ├── http/           auth, profile/resume/preferences, automation, gmail OAuth, runs/history, account
│   │   ├── ai/             Gemini (model fallback, backoff), zod schemas, follow-up writer, mock
│   │   ├── resume/         PDF checks + text extraction, experience calculation
│   │   ├── jobs/           Adzuna, JSearch v5, query planning, daily call caps, shared job_cache
│   │   ├── matching/       rule filters, role families, industry check, excluded companies
│   │   ├── runs/           run pipeline + funnel, safety checks, send queue, tracking, follow-ups, scheduler
│   │   ├── cli/            diagnose (npm run diagnose: why each user is / isn't due)
│   │   ├── gmail/          OAuth, drafts/send/threads (headers only), MIME builder, mock Gmail
│   │   ├── storage/        Cloudinary private raw files (real + mock)
│   │   └── lib/            clock (fake-able), IST scheduling (luxon), job locks, crypto, logger
│   ├── test/unit/          pure logic (no database)
│   ├── test/integration/   supertest + fake clock against jobdraft_test (auto-created/dropped)
│   └── scripts/            drop-test-db.ts
└── client/                 Next.js (App Router) + TypeScript + Tailwind, mobile-first, light/dark
    ├── src/app/            (auth)/login|register, (app)/dashboard|history|setup|account
    ├── src/components/     shell (bottom tabs on phones), automation switch, run-time picker, …
    ├── src/data/           indian-cities.json (bundled; no paid places API)
    └── e2e/                Playwright at 375×812 and 1280×800
```

## Ports

| What | Port |
|---|---|
| JobDraft API (`jobdraft-server`) | **5055** |
| JobDraft web (`jobdraft-client`) | **3055** |
| E2E test servers (temporary) | 5056 / 3056 |
| Tradenaya (untouched) | 3000 |

## Run locally

Prerequisites: Node.js 20.11+ (tested on 22), and MySQL 8.0.16+ (needed for CHECK constraints) whose user may create databases. Tradenaya's local Docker MySQL works.

```powershell
cd jobdraft
npm run setup          # installs root, server and client dependencies
npm run dev            # API on :5055 + web on :3055
```

Open http://localhost:3055. On first start the server creates the `jobdraft` database and its tables and generates `JWT_SECRET` / `ENCRYPTION_KEY` in `server/.env` if missing. There are no manual SQL scripts.

`server/.env` already holds MySQL and Cloudinary values copied from Tradenaya; see [SETUP.md](SETUP.md) for the other keys. To try everything **without any keys**, set `MOCK_EXTERNAL=true`: Gemini, Gmail (threads, replies, bounces), Cloudinary and the job APIs are simulated, and no real email is ever sent. Missing keys never crash the app; the dashboard shows a "Not configured" banner and that feature is skipped.

## Tests

```powershell
npm test               # type-check + lint (server and client), then all server tests
npm run test:e2e       # Playwright: production build + mock servers, in the installed Edge
npm run test:unit --prefix server   # pure logic only (works without MySQL)
```

- Server tests run with `MOCK_EXTERNAL=true` against **`jobdraft_test`**. It is dropped and re-created through the real migrations at the start of the run, and dropped at the end. A fake clock simulates weeks of cron activity (daily runs, sends, follow-ups).
- E2E reuses Microsoft Edge (`PW_CHANNEL=chrome` for Chrome), so no browser download is needed. Its server exposes a clock-advance helper that exists only with `NODE_ENV=test` and `MOCK_EXTERNAL=true`.

## How it works

### Daily run time

Each user picks a time (15-minute steps, any time of day, **India time**, default 9:00 AM). A cron job runs **every minute**. Under a short DB lock it looks at **every user with automation ON** whose run time has passed within the last 3 hours and who has no scheduled run yet today (IST):
- if the profile is complete and Gmail is connected with both permissions, it claims the run;
- if something blocks it (Gmail access expired, a permission missing, setup incomplete), it records a **failed run card** saying exactly what to fix: "Today's run couldn't start: reconnect gmail (access expired)…". A missed day is never silent.

Claims are a database row unique per user per IST date, so nobody ever gets two scheduled runs in a day, even across restarts or several processes. The runs themselves are processed **outside** the lock (2 at a time per process), so a slow run never blocks the next minute's pass. Every pass also closes runs stuck in "running" for over 45 minutes, and a run stops itself after 20 minutes. The server logs the registered cron jobs at startup; with `LOG_LEVEL=debug` it also logs each minute how many users were due, blocked or waiting.

**Diagnosis:** `npm run diagnose` (server folder, after a build) prints, for each automation-ON user, their run time, Gmail state, what blocks them, the next run time and their last runs, plus locks and today's job-source usage. It is read-only and prints IDs only.

- **Missed runs.** If the server was down at the user's time, the run happens once when it is back, if that is within 3 hours. Otherwise today is skipped and the next run is tomorrow.
- **Changing the time.** The new time applies today only if it is still ahead and today's run hasn't happened. Saving never triggers an immediate run, and neither does turning automation on.
- **Next run hint.** The "Next run" hint in the UI and the scheduler use the **same function** (`nextRunAt` in `server/src/lib/time.ts`).
- **Run now.** A manual extra run (automation ON), limited to once per 30 minutes. It doesn't replace the day's scheduled run.

### The automation switch

This is the user's master switch ("I got a job, stop searching"). Turning it **ON** needs a complete profile and Gmail with both permissions; the UI lists what's missing.

While it's **OFF**:
- no job fetching, AI calls, drafts, sends or follow-ups happen for that user;
- every scheduled send and follow-up is cancelled immediately and kept as a Gmail draft;
- "Run now" is disabled;
- history is kept, and reply tracking continues read-only.

Turning it back ON resumes at the next run time and never revives cancelled follow-ups. Every step (scheduler, pipeline, send queue, follow-ups) re-checks the switch right before acting.

### A run

1. Track existing applications first.
2. Fetch postings from every configured source (see **Job sources** below), with a shared cache and daily call caps.
3. Rule filters, **excluded companies first**: past and current employers from the resume plus the user's "companies to skip", matched by normalised name, contained name, Jaro-Winkler ≥ 0.9, and email or URL domain. Then seen jobs, location (incl. nearby areas such as Navi Mumbai/Thane, Pimpri-Chinchwad, Secunderabad), title (role families: "Product Owner" = "Product Manager", "Technical Program Manager" = "Project Manager"…), non-software domains, seniority (director/head/VP/principal only skipped under 5 years), stated minimum experience (kept if ≤ yours + 2; unstated is kept), salary, agencies, and companies contacted in the last 60 days.
4. **AI screen**: up to 15 postings per run, 5 per Gemini call, postings that state an email address first. It returns suitability, a 0–100 confidence, scam/agency flags and the real employer behind a portal.
5. For each **suitable** posting that states an application email: a second Gemini call writes the email (subject, body, the verbatim address). Suitable postings without an email go to **Apply via link** with their apply URL.
6. Hard safety checks in code:
   - the email is verbatim in the posting and not noreply/example/test;
   - the employer isn't excluded;
   - the body names the company and role;
   - no placeholders, hype words, emojis or ALL CAPS, and no overstated experience;
   - salary is mentioned only if the posting asks for it;
   - the signature is built from the resume.
   A suitable job that fails a check becomes **Apply via link**.
7. Create the Gmail draft: a unique `Message-ID`, `Reply-To`, UTF-8 subject, plain text (no tracking, no links except LinkedIn) and the resume PDF attached. At most 10 new emails per run.
8. Classify by the user's **sending mode** (below). In every mode, scam- or agency-flagged emails are never auto-sent, and anything over the daily cap stays a **draft**.

Every run stores a **funnel** (shown in History, see below), and a run that fetches nothing says why on its card ("Adzuna error 401", "JSearch quota exhausted", "No job source is configured"…).

### Job sources

- **Adzuna** (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`): one search per (role, area) with the role words in the title (`title_only`), `where=<area>`, last 7 days, 50 newest. Areas include alternate names: Bengaluru + Bangalore, Mumbai + Navi Mumbai + Thane, Pune + Pimpri-Chinchwad, Hyderabad + Secunderabad. "Remote (India)" = the role plus "remote" and plus "work from home", keeping only postings that say remote/WFH. Cached 6 hours across users; at most `ADZUNA_DAILY_CAP` (230) calls a day across all users. Adzuna gives description excerpts, so its jobs mostly become **Apply via link**.
- **JSearch** (RapidAPI v5, `RAPIDAPI_KEY`): always `country=in`, `date_posted=week`, `num_pages=1`, `language=en`; jobs from `data.jobs`, India only, direct apply links preferred, full descriptions (so application emails can be found). Besides the plain search it rotates variants that surface email-apply postings from smaller employers: "startup", "hiring immediate joiner", "send resume", "walk-in". The free quota is small: cached 12 hours, at most `JSEARCH_DAILY_CAP` (6) calls a day across all users and `JSEARCH_MAX_CALLS_PER_RUN` (4) per run, least-recently-searched combinations first. A second page only when the first had 5+ relevant postings. A missing key or a used-up quota is skipped and noted in the funnel.

### Reading the funnel (History)

Each run card shows one line: **Fetched 84 → after filters 12 → suitable 5 → emails 1 → link-only 4**.
- **Fetched**: unique postings from all sources.
- **After filters**: what survived the rule filters (tap the funnel to see how many each step removed: already seen, outside your locations, title, not a software role, seniority, experience, salary, agency, past employers, recently emailed, duplicates).
- **Suitable**: what the AI judged a real fit (up to 15 screened per run; the rest wait for the next run).
- **Emails**: applications created (drafts + auto-sends). Only postings that state an application email can become emails.
- **Link-only**: suitable jobs to apply for on the company's site.

Tap **How this run went** for per-source counts and errors, which search variants found email-apply jobs, and every search that ran.

### Sending modes (per user, Setup → under the automation switch)

| Mode | What is sent automatically | Cancel window | Daily cap (IST) |
|---|---|---|---|
| **Drafts only** | Nothing. Every email and follow-up is a Gmail draft. | — | — |
| **Smart send** (default, recommended) | Confidence ≥ 85, no flags, all checks passed (5 per run). | 30 min | 8 |
| **Send all** | Every suitable email that passes all hard checks. | 30 min | 15 |
| **Send all instantly** | Every suitable email that passes all hard checks, queued as the run finishes (asks for confirmation). | none (2–4 min gap kept) | 15 |

- The mode only applies while automation is ON; when it's OFF the selector is greyed out ("Turn on automation to use") and the choice is kept. The dashboard shows the current mode next to the switch, with a **Change** link.
- Changing the mode affects only emails created afterwards. Switching to **Drafts only** cancels every scheduled send and follow-up at once (they stay drafts); switching to a send mode never sends existing drafts.
- Each email stores the mode it was created in (`run_items.send_mode`) and who sent it (`sent_by`: the queue, or the user by hand). History shows "Sent automatically", "Sent by you" or "Draft – waiting for you".
- Follow-ups (max 2) are sent automatically only if the original was; in Drafts only they are always drafts. Auto follow-ups get the 30-minute window in Smart send and Send all, none in Send all instantly.
- Unchanged in every mode: all hard safety checks, excluded companies, 60-day company cooldown, never the same address twice, 10 new emails per run, the 2–4 minute gap, and the 24-hour pause on Gmail rate limits.

### Sending queue

- **Cancel window.** Auto-sends go out 30 minutes after the run finishes (at once in Send all instantly). The dashboard shows "Sending at 9:42 AM" with **Cancel** per email and **Cancel all** per run. A cancelled email stays a normal draft.
- **DB-backed queue.** It runs every minute under a lock and survives restarts. It sends one email at a time per user, with a random 2–4 minute gap, using Gmail's `drafts.send`.
- **Never twice.** Each item is claimed atomically (`scheduled → sending`), so an email can never be sent twice.
- **Retries.** At most 3 attempts, at least 15 minutes apart; then the item is **failed** for good.
- **Re-checks right before each send.** Automation is still ON, the user's **current** mode isn't Drafts only (else: skipped, "mode changed to drafts only"), Gmail is connected, the draft still exists, the company isn't excluded, and the company/address wasn't contacted by another item.
- **Gmail rate limits.** A rate-limit or quota error pauses all sending for that user for 24 hours. Remaining items stay drafts and the dashboard shows a warning.

### Tracking (headers only)

At the start of each run and every 2 hours, JobDraft reads **only the threads it created**, using `threads.get` with `format: "metadata"` (the `gmail.metadata` permission can't search the mailbox and never sees bodies). It detects:
- **sent**: including drafts the user sent by hand;
- **removed**: the draft was deleted and nothing was sent;
- **replied**: a message from someone else after ours;
- **bounced**: mailer-daemon/postmaster, or a delivery-failure subject.

A run becomes **Completed** when every application in it reaches a final state.

### Follow-ups: at most 2 per application, ever

Three layers enforce the limit:
1. **Database:** `UNIQUE(run_item_id, sequence)` and `CHECK(sequence IN (1,2))`.
2. **Code:** N=2 only if follow-up 1 was **sent**, `followup_count < 2`, and follow-ups aren't stopped.
3. **Atomic insert first:** the follow-up row is inserted before anything else, so duplicate cron firings, restarts and parallel workers can never create extras.

Timing and content:
- **Follow-up 1** is due 7 days after the original was sent; **follow-up 2**, 7 days after follow-up 1 was sent.
- Each is moved to the next weekday, at a random minute between 10:00 and 11:30 AM IST.
- At most 5 follow-ups per user per day; the rest move to the next weekday, never earlier.
- Each is a reply in the same thread (`In-Reply-To`, `References`, "Re:" once), with no attachment.
- 7 days after follow-up 2 with no reply, the application is marked **No response** and closed forever.

Before creating and again before sending, JobDraft re-checks for replies. A reply or bounce cancels pending follow-ups and deletes their drafts.

Mode follows the original email:
- **Auto-sent originals** get auto follow-ups, with the same 30-minute cancel window.
- **Drafts the user sent by hand** get follow-up **drafts**. These expire after 7 days if unsent, which closes the application as No response.

**Stop follow-ups** on any application stops everything for it.

## Deploy with pm2 (on the VPS)

JobDraft is **not** part of Tradenaya's GitHub Actions deploy. Tradenaya's type check and lint ignore `jobdraft/`. Deploy it by hand:

```bash
cd ~/tradenaya/jobdraft
npm run setup
# server/.env: NODE_ENV=production, CLIENT_URL=https://your-domain,
#   GOOGLE_REDIRECT_URI=https://your-domain/api/gmail/callback, plus the keys in SETUP.md
# client/.env.local: NEXT_PUBLIC_API_URL=https://your-domain   (baked in at build time)
npm run build
pm2 start ecosystem.config.cjs     # jobdraft-server (one instance) + jobdraft-client
pm2 save
```

That first setup is done by hand once. After it, **updates deploy automatically**:
1. Merge to `main`.
2. Tradenaya's "Deploy to VPS" runs as usual and pulls the code.
3. When it finishes, **"Deploy JobDraft"** (`.github/workflows/jobdraft-deploy.yml`) runs `jobdraft/scripts/deploy.sh` on the server. The script:
   - skips quickly if nothing under `jobdraft/` changed;
   - installs packages only when a lockfile changed;
   - builds beside the live app, swaps the build in, and restarts `jobdraft-server` / `jobdraft-client`;
   - health-checks both, and restores the previous build if the new one doesn't answer.

How it stays out of Tradenaya's way:
- It never runs at the same time as Tradenaya's deploy and never cancels it.
- It runs no git commands on the server and modifies no tracked file.
- It reuses the existing `DEPLOY_*` secrets.

To redeploy by hand: **Actions → Deploy JobDraft → Run workflow** (tick "force" to rebuild anyway), or on the server: `bash ~/tradenaya/jobdraft/scripts/deploy.sh`. The last run's log is in `~/tradenaya/jobdraft/.deploy.log`.

Keep `jobdraft-server` at **one instance** so the cron jobs aren't duplicated. DB locks protect against duplicates anyway.

### nginx (example only, not applied)

```nginx
server {
    server_name jobdraft.example.com;
    client_max_body_size 6m;            # 5 MB resumes

    location /api/ {
        proxy_pass http://127.0.0.1:5055;
        proxy_read_timeout 120s;        # resume reading waits on the AI
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:3055;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # listen 443 ssl; … (e.g. certbot --nginx)
}
```

Use `CLIENT_URL=https://jobdraft.example.com` and `NEXT_PUBLIC_API_URL=https://jobdraft.example.com`. Production cookies are `Secure`, so HTTPS is required.
