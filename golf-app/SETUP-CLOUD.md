# Going live: shared cloud tournament (free)

This guide takes the app from "works on my phone only" to "everyone opens the
same live tournament from a web link." It uses two free services:

- **Supabase** — the shared database (+ live updates)
- **Netlify** — free public hosting (a web link anyone can open)

No coding required. Budget: **$0**. Set aside about 20–30 minutes.

> You only do this **once**. After it's set up, players just open the link.

> **Images (photos & maps):** to enable the tournament photo, course layout map
> and per-hole photos, also run **`supabase-storage.sql`** once in the Supabase
> SQL Editor. It creates a public `images` bucket and the upload permissions.

---

## Before you start

You'll need to edit one small file, `golf-app/js/config.js`, in a plain text
editor (Notepad is fine). Everything else is done in your web browser.

---

## Step 1 — Create the database (Supabase)

1. Go to **https://supabase.com** and click **Start your project** → sign in
   with GitHub or email (free).
2. Click **New project**.
   - **Name:** anything, e.g. `golf-tournament`
   - **Database Password:** pick one and save it somewhere (you won't need it for
     the app, but Supabase wants one)
   - **Region:** choose the one closest to you
   - Click **Create new project** and wait ~2 minutes while it sets up.
3. In the left sidebar, open the **SQL Editor** → **New query**.
4. Open the file **`golf-app/supabase-schema.sql`** (in this project) in Notepad,
   copy **everything**, paste it into the Supabase SQL editor, and click **Run**.
   You should see "Success. No rows returned." That built your tables.

---

## Step 2 — Get your two keys

1. In Supabase, click the gear icon → **Project Settings** → **API**.
2. Copy these two values:
   - **Project URL** — looks like `https://abcdwxyz.supabase.co`
   - **anon public** key (under "Project API keys") — a long string starting
     `eyJ...`

> The **anon** key is meant to live in a web page and is safe to share. Do **not**
> use the `service_role` key — that one is secret.

---

## Step 3 — Put the keys in the app

1. Open **`golf-app/js/config.js`** in Notepad.
2. Paste your two values between the quotes:

   ```js
   window.GT.CONFIG = {
     SUPABASE_URL: 'https://abcdwxyz.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOiJI...your-long-key...'
   };
   ```

3. Save the file.

That's it — the app is now in **shared cloud mode**. (If you ever want to go back
to on-device-only, just blank out those two values again.)

---

## Step 4 — Put it on the web (Netlify, free)

The easiest no-account-needed-first option:

1. Go to **https://app.netlify.com/drop**.
2. Drag the whole **`golf-app`** folder onto the page.
3. Netlify uploads it and gives you a link like
   `https://random-name-123.netlify.app`.
4. Click **Sign up** (free) to keep the site permanently, and you can rename it to
   something like `marbella-golf.netlify.app` under **Site settings → Change site
   name**.

Open that link on your phone — it's the real app, now shared. On iPhone/Android
use the browser's **"Add to Home Screen"** to install it like a normal app.

> **Updating later:** if I change the app code, just drag the `golf-app` folder
> onto Netlify again (or, on a named site, use **Deploys → drag-and-drop**).

### Alternatives (also free)
- **Cloudflare Pages** — `dash.cloudflare.com` → Workers & Pages → Create →
  Pages → upload the `golf-app` folder. Very fast, generous limits.
- **GitHub Pages** — if you keep the code on GitHub, enable Pages in the repo
  settings. Best if you're comfortable with GitHub.

---

## Step 5 — Run your tournament

1. Open your link, choose **Admin**, sign in with the admin code (default
   `admin` — change it in **Tournament Setup**).
2. Set up the tournament name, rounds, courses, and your two access codes.
3. Share the **link** + the **player access code** with your golfers. They tap
   **Register**, enter the code, and create their username + password.
4. Everyone's scores and the leaderboards now update **live** across all phones.

---

## Good to know

- **Free Supabase projects pause after ~1 week of no activity.** If the app can't
  load after a quiet spell, open your Supabase dashboard and click **Restore /
  Resume** — it's back in a minute. (During an active golf week this never
  happens.) Free tier also includes 500 MB of database — far more than a
  tournament needs.
- **Works offline-ish:** each device keeps a local copy, so brief signal drops on
  the course are fine; changes sync when the connection returns.
- **Backups:** Admin → Setup → **Backup (JSON)** downloads the whole tournament
  any time.

## Security note (please read)

The app talks to the database with the public **anon** key, and the database
policies are open, so anyone who has your link can read and write tournament
data. That's a deliberate trade-off for a simple, free, friends-and-family golf
app — it is **not** suitable for sensitive information.

Player passwords are stored only as a salted hash (never plaintext), but because
this is a public-key setup, treat them as casual logins — **don't reuse a
password that matters elsewhere.**

If you later want it properly locked down (real accounts, per-user permissions),
that's a bigger upgrade using Supabase's built-in authentication — ask and it can
be added.
