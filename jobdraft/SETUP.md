# JobDraft setup: keys and Google Cloud

Every value below goes into **`jobdraft/server/.env`**, except `NEXT_PUBLIC_API_URL`, which goes in `jobdraft/client/.env.local`. Restart the server after editing (`Ctrl+C`, then `npm run dev`). If a key appears twice in `.env`, the **last** line wins.

MySQL and Cloudinary are already filled in, copied from Tradenaya's `.env.local`. `JWT_SECRET` and `ENCRYPTION_KEY` were generated automatically. **Never change `ENCRYPTION_KEY` once users have connected Gmail**, because their stored tokens could no longer be decrypted.

> **Upgrading from the first version?** JobDraft now also needs the `gmail.metadata` permission (to track replies). Existing Gmail connections show **"Reconnect Gmail and allow all permissions"**, and automation was switched OFF. Add the scope (step 1.5), reconnect in Setup, then turn automation back on.

---

## 1. Google Cloud: Gmail access

1. Open https://console.cloud.google.com/ and sign in.
2. **Create a project**: project picker (top bar) → **New project** → name it `JobDraft` → **Create**, then select it.
3. **Enable the Gmail API**: search "Gmail API" in the top bar → **Enable**.
4. **OAuth consent screen**: ☰ → **APIs & Services → OAuth consent screen**, which newer consoles call **Google Auth Platform**. Click **Get started**:
   - App name `JobDraft`, support email: yours → Next.
   - Audience **External** → Next.
   - Contact email: yours → Next → agree → **Create**.
5. **Data access** (left menu) → **Add or remove scopes** → tick `openid` and `.../auth/userinfo.email`, then paste these two in **Manually add scopes** → **Add to table** → **Update** → **Save**:
   - `https://www.googleapis.com/auth/gmail.compose`: creates drafts and sends them (the strongest matches and follow-ups).
   - `https://www.googleapis.com/auth/gmail.metadata`: reads **headers only** (sender, date, Message-ID, labels) to see whether an application was sent, replied to or bounced. It can't read message bodies, and the app never searches the mailbox.
6. **Publishing status**. **Audience** (left menu) shows it.
   - **In production** (recommended): click **Publish app**. Google first requires a public **homepage URL** and **privacy-policy URL** on the **Branding** page, so this is only possible once JobDraft runs on a real domain. Without it, Google expires refresh tokens after **7 days**.
   - **Testing** (fine for trying it on your PC): under **Test users** → **Add users**, add every Gmail address that will connect (up to 100). Gmail access then expires every 7 days, and the dashboard shows **"Gmail access expired — please reconnect"**; click **Reconnect Gmail** once a week.
7. **Create the OAuth client**: **Clients** (or **APIs & Services → Credentials**) → **Create client** → **Web application**, name `JobDraft web`. Under **Authorised redirect URIs** add exactly:
   - Local: `http://localhost:5055/api/gmail/callback`
   - Production: `https://YOUR-DOMAIN/api/gmail/callback`

   Then click **Create** and copy the **Client ID** and **Client secret**.
8. In `server/.env`:
   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   GOOGLE_REDIRECT_URI=http://localhost:5055/api/gmail/callback
   ```

**Unverified app warning.** `gmail.compose` and `gmail.metadata` are restricted scopes. Until Google verifies the app (a security assessment), users see **"Google hasn't verified this app"**:
- In Testing mode, they tap **Continue**.
- Otherwise, they tap **Advanced → Go to JobDraft (unsafe)**.

On the next screen they must **tick every permission box**. If one is left unticked, JobDraft shows "needs reconnect" and automation can't be turned on.

**100-user cap.** An unverified app can be authorised by at most **100 Google accounts** over its lifetime.

---

## 2. Gemini API key

1. Open https://aistudio.google.com/app/apikey → **Create API key** (name it anything, e.g. `JobDraft`; pick the JobDraft project) → copy it.
2. In `server/.env`:
   ```
   GEMINI_API_KEY=…
   GEMINI_MODELS=gemini-flash-latest,gemini-flash-lite-latest,gemini-3.8-flash,gemini-3.5-flash-lite
   ```
   Models are tried left to right, falling back on errors. Only the key is needed: no project ID or number.

---

## 3. Adzuna (main job source)

1. Register at https://developer.adzuna.com/signup, then click the **activation link** in the email (check Spam). Until then, login says "Your account isn't active".
2. **Dashboard → API Access Details** → copy the **Application ID** and **Application Key**.
3. In `server/.env`: `ADZUNA_APP_ID=…` and `ADZUNA_APP_KEY=…`

Adzuna's API returns a **short snippet** of each posting, so many postings have no visible application email and end up as "Apply via link".

---

## 4. JSearch on RapidAPI (optional, full descriptions)

1. Sign up at https://rapidapi.com → open **JSearch** → **Subscribe** to the free **Basic** plan.
2. Copy your **X-RapidAPI-Key** into `RAPIDAPI_KEY=…`. Optionally set `JSEARCH_MAX_CALLS_PER_RUN` (default 4).

The free quota is small (about 200 requests a month). Results are cached for 6 hours and shared between users.

---

## 5. Everything in `server/.env`

| Key | Local value | Production value |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `PORT` | `5055` | `5055` |
| `CLIENT_URL` | `http://localhost:3055` | `https://YOUR-DOMAIN` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` | copied from Tradenaya | your server's MySQL (8.0.16+) |
| `DB_NAME` | `jobdraft` | `jobdraft` |
| `JWT_SECRET`, `ENCRYPTION_KEY` | auto-generated | auto-generated on the server (keep them) |
| `CLOUDINARY_*` | copied from Tradenaya | same |
| `GEMINI_API_KEY`, `GEMINI_MODELS` | step 2 | same |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | step 1 | production redirect URI |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `RAPIDAPI_KEY` | steps 3–4 | same |
| `MOCK_EXTERNAL` | `false` (`true` = demo, no real email) | `false` |

The MySQL user needs permission to create the `jobdraft` database (and `jobdraft_test` for tests). If it can't, the server log prints the exact `GRANT` statement to run.

`client/.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:5055` (production: `https://YOUR-DOMAIN`).

## 6. Try it

1. In PowerShell: `cd C:\Users\HP\Desktop\trade\tradenaya\jobdraft` → `npm run dev` → open http://localhost:3055.
2. Register → **Setup**:
   1. Upload a text-based PDF resume and check the summary. Your past employers appear under **Companies to skip**.
   2. Adjust roles and locations, set the salary and the **daily run time**, then **Save preferences**.
   3. **Connect Gmail** → Continue → tick every box.
3. **Dashboard** → switch **Automation ON**. The first run happens at your run time (it never starts immediately), or press **Run now**.
4. Strong matches appear under **Upcoming sends** for 30 minutes, so you can cancel them. Everything else is in **Open Gmail drafts** for you to review and send.
