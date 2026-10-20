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
│   │   ├── db/             pool, migrations v1 + v2 (schema_migrations), bootstrap
│   │   ├── http/           auth, profile/resume/preferences, automation, gmail OAuth, runs/history, account
│   │   ├── ai/             Gemini (model fallback, backoff), zod schemas, follow-up writer, mock
│   │   ├── resume/         PDF checks + text extraction, experience calculation
│   │   ├── jobs/           Adzuna, JSearch, mock source, shared 6-hour job_cache
│   │   ├── matching/       rule filters, excluded-company matching (Jaro-Winkler, domains)
│   │   ├── runs/           run pipeline, safety checks, send queue, tracking, follow-ups, scheduler
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

Each user picks a time (15-minute steps, any time of day, **India time**, default 9:00 AM). A cron job runs **every minute** under a DB lock and finds users who are due:
- automation is ON;
- the profile is complete;
- Gmail is connected with both permissions;
- their run time has passed within the last 3 hours;
- they have no scheduled run yet today (IST).

It claims each run with a database row that is unique per user per IST date, so nobody ever gets two scheduled runs in a day, even across restarts or several processes.

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
2. Fetch postings (Adzuna; JSearch if keyed). The cache is shared across users for 6 hours.
3. Rule filters, **excluded companies first**: past and current employers from the resume plus the user's "companies to skip", matched by normalised name, contained name, Jaro-Winkler ≥ 0.9, and email or URL domain. Then location, title, seniority, experience, salary, agencies, seen jobs, companies contacted in the last 60 days, and any address ever contacted.
4. Gemini check for at most 12 jobs. It returns suitability, a 0–100 confidence, scam/agency flags, the real employer behind a portal, the application email, and the subject and body.
5. Hard safety checks in code:
   - the email is verbatim in the posting and not noreply/example/test;
   - the employer isn't excluded;
   - the body names the company and role;
   - no placeholders, hype words, emojis or ALL CAPS, and no overstated experience;
   - salary is mentioned only if the posting asks for it;
   - the signature is built from the resume.
   A suitable job that fails a check becomes **Apply via link**.
6. Create the Gmail draft: a unique `Message-ID`, `Reply-To`, UTF-8 subject, plain text (no tracking, no links except LinkedIn) and the resume PDF attached. At most 10 new emails per run.
7. Classify: **auto-send** only if confidence ≥ 85, there are no flags, all checks passed, and the limits allow it (5 per run, 8 per IST day). Everything else stays a **draft**.

### Sending (fixed anti-spam policy, no settings)

- **Cancel window.** Auto-sends go out 30 minutes after the run finishes. The dashboard shows "Sending at 9:42 AM" with **Cancel** per email and **Cancel all** per run. A cancelled email stays a normal draft.
- **DB-backed queue.** It runs every minute under a lock and survives restarts. It sends one email at a time per user, with a random 2–4 minute gap, using Gmail's `drafts.send`.
- **Never twice.** Each item is claimed atomically (`scheduled → sending`), so an email can never be sent twice.
- **Retries.** At most 3 attempts, at least 15 minutes apart; then the item is **failed** for good.
- **Re-checks right before each send.** Automation is still ON, Gmail is connected, the draft still exists, the company isn't excluded, and the company/address wasn't contacted by another item.
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

After later updates: `git pull && cd jobdraft && npm run setup && npm run build && pm2 restart jobdraft-server jobdraft-client`.

Keep `jobdraft-server` at **one instance** so the cron jobs aren't duplicated. DB locks protect against duplicates anyway.

### nginx (example only, not applied)

```nginx
server {
    server_name jobdraft.example.com;
    client_max_body_size 6m;            # 5 MB resumes

    location /api/ {
        proxy_pass http://127.0.0.1:5055;
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
