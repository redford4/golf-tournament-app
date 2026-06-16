# ⛳ Golf Tournament Scoring App

A local-first, mobile-first web app for running multi-day golf tournaments —
golfer registration, WHS handicap calculations, hole-by-hole or summary score
entry, visual scorecards, and live leaderboards. Built to the
**Golf Tournament Scoring App PRD v1.1**.

No install, no server, no accounts. Everything runs in the browser and saves
on-device.

## Running it

### Option 1 — just open it (simplest)
Double-click **`index.html`**. It opens in your default browser and works
immediately. All data is saved in that browser via `localStorage`.

> Note: opened this way the app runs as a normal web page. To install it to your
> phone's home screen as a PWA (and use it offline), serve it over http instead —
> see Option 2.

### Option 2 — serve it (enables PWA install + offline)
From the `golf-app` folder, run the bundled PowerShell server:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8765
```

Then open **http://localhost:8765/** on this computer, or
`http://<your-computer-ip>:8765/` from a phone on the same Wi-Fi.
In a mobile browser, use "Add to Home Screen" to install it.

## First run

On the login screen, tap **✨ Load demo tournament** to populate sample players,
courses and scores so you can explore. Or start fresh:

1. On the login screen choose the **Admin** tab and enter the admin code
   (default `admin`).
2. **Tournament Setup** — set the name, number of rounds, and your own player /
   admin access codes.
3. **Course Configuration** — for each round, enter the course name, date,
   rating, slope, and the par + stroke index for every hole.
4. Share the **player access code** (default `golf`) with golfers. Each golfer
   picks **Register** on the login screen, enters the access code, then sets up
   their profile (name, handicap index, CDH ID) and a **username + password**.

After that, players just sign in on the **Player** tab with their username and
password — on any device.

**Default codes:** player access `golf`, admin `admin`. For the demo data, every
player's password is `golf` (usernames `rory`, `shane`, `scott`, `tommy`, `jon`).
Change all of these before a real event.

## What's included (per the PRD)

- **Player login with username + password** (chosen at registration), gated by a
  shared player access code so only invited golfers can join; separate admin code
  for management. Sessions expire after a configurable timeout. The admin can
  change any player's username or reset their password.
- **Golfer registration** with duplicate-CDH warnings and unique usernames; admin
  can edit anyone.
- **Tournament + per-round course configuration** (manual entry). Validates that
  stroke indexes are a complete 1–18 set and pars are plausible.
- **WHS handicap maths** — Course Handicap = HI × (Slope ÷ 113) + (Rating − Par),
  with correct per-hole shot allocation (including 2 shots for handicaps > 18).
- **Two score-entry modes** — hole-by-hole and quick summary entry, switchable
  with warnings. Hole-by-hole is built for speed: one-tap score chips (labelled
  Birdie/Par/Bogey…), +/− steppers, and keyboard flow where **Enter, Tab or ↓
  advance to the next hole** (Shift+Tab / ↑ go back). Auto Net + Stableford,
  pick-up/No-Return support, a live progress bar and front/back subtotals, and it
  reopens on the first hole still to be scored.
- **Visual scorecards** — traditional two-row layout, shot dots, colour-coded
  Stableford points, OUT/IN/total subtotals.
- **Leaderboards** — round and overall, sortable columns, tie handling (`=2`),
  incomplete-round (`*`) and summary-entry (`S`) markers. **Tap any player** to
  view their full scorecard (round view) or their whole tournament (overall view).
- **Admin tools** — score management (edit/override/lock any player), completion
  dashboard, audit log, CSV export, JSON backup/restore, and tournament reset.

## Going multi-device (shared live tournament)

By default the app stores data on each device. To run one **shared, live**
tournament that everyone opens from a web link — leaderboards updating across all
phones — connect it to a free Supabase database and host it for free. The app
detects this automatically once you fill in `js/config.js`; nothing else changes.

**Step-by-step (no coding, ~$0):** see **[SETUP-CLOUD.md](SETUP-CLOUD.md)**.

## Not yet wired up

- **AI scorecard scanning** (PRD §5A) is stubbed with a "Soon" button — course
  data is entered manually for now. The review/confidence UI can be layered on
  top of the existing course form when a vision model is connected.
- **Cross-device sync** is optional, not on by default. In local mode data is
  per-device (bridge it with **Admin → Setup → Backup/Restore JSON**). For true
  shared live sync, connect Supabase — see [SETUP-CLOUD.md](SETUP-CLOUD.md).

## Project layout

```
golf-app/
  index.html              app shell + script includes
  css/styles.css          all styling (mobile-first)
  js/
    config.js             cloud config (blank = on-device; fill in to share)
    golf.js               pure scoring engine (handicaps, shots, Stableford)
    db.js                 data layer (localStorage + optional cloud sync)
    core.js               DOM helpers, toast, modal, session, router
    cloud.js              optional Supabase adapter (shared live tournament)
    chrome.js             app bar + navigation drawer
    views-auth.js         login, registration, profile
    views-player.js       home, handicaps, round detail, scorecard + helpers
    views-score.js        score entry (modes A & B)
    views-admin.js        setup, courses, players, scores, export/reset
    views-leaderboard.js  round + overall leaderboards
    app.js                bootstrap + demo data seeding
  manifest.webmanifest    PWA manifest
  service-worker.js       offline cache (network-first; active when served)
  icons/                  app icons
  serve.ps1               optional local static server
  supabase-schema.sql     database setup (run once in Supabase)
  SETUP-CLOUD.md          step-by-step go-live guide
```

## Data & privacy

All data lives in your browser's `localStorage` for whichever origin you open
the app from (the `file://` page, or `http://localhost:8765`). Clearing browser
data removes it — export a JSON backup before doing so. Nothing is sent to any
server.

**Password note:** player passwords are stored as a salted hash (not plaintext),
so they can't be read back out of `localStorage` — the admin can reset a password
but not see it. Because this is a local-first app with no backend, that hash is
not a strong cryptographic defence; anyone with full access to the device's
storage could still attack it. Treat these passwords as convenience logins for a
friendly tournament, not as protection for sensitive data, and don't reuse a
password that matters elsewhere.
