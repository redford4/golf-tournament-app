# ⛳ Golf Tournament Scoring App

A mobile-first web app for running multi-day golf tournaments — registration,
WHS handicaps, hole-by-hole or summary scoring, visual scorecards, and live
leaderboards. Backed by Supabase so everyone shares one live tournament.

The app itself lives in **[`golf-app/`](golf-app/)** — see
[golf-app/README.md](golf-app/README.md) for features and how it works.

## Live site

This repo auto-deploys to **GitHub Pages** on every push to `main`
(see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). Once Pages
is enabled, the app is served from the `golf-app/` folder.

## Making changes

Edit files under `golf-app/`, then:

```bash
git add -A
git commit -m "Describe your change"
git push
```

Within a minute or two the live site updates automatically.

## Cloud setup

Shared data runs on Supabase. The connection lives in
[`golf-app/js/config.js`](golf-app/js/config.js) (the publishable key there is
safe to be public). Full walkthrough:
[`golf-app/SETUP-CLOUD.md`](golf-app/SETUP-CLOUD.md).
