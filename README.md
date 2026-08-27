# Toptracer Range Analyzer

A local web app that logs into your own Toptracer **Range** account, downloads your shot
history, and shows custom club-gapping and dispersion visualizations with a clean-hit filter.

## What it does
- **Web-page login** with your Toptracer Range credentials (email + password). The password is
  used once, in memory, to complete the OAuth login (via the official `trca` client); only a
  refresh token is stored locally in `packages/server/data/session.json`. No credentials on disk.
- **Sync** pulls all your sessions + shots + clubs from the Range GraphQL API into local SQLite.
- **Club Gapping** view: per-club mean/median/P25–P75 carry, kept-vs-excluded counts, lateral
  bias, and a gapping strip chart — the "how far does each club go" answer.
- **Dispersion** view: a replica of the app's Game Details scatter (distance × L/R offset), with
  per-club 1σ ellipses and excluded shots greyed out.
- **Clean-hit filter**: per-club IQR outlier removal on the chosen distance metric (Flat Carry
  or Total), with a strictness slider and a min-shots guard. Fully custom filtering: metric,
  clubs, sessions, date range.

## Run
```bash
npm install          # once
npm run dev          # starts server (127.0.0.1:5174) + web (127.0.0.1:5173)
```
Open http://localhost:5173, log in, click **Sync**, then explore.

Build/test:
```bash
npm run build
npm test             # server unit tests (stats, filters, db)
```

## Layout
- `packages/server` — Fastify API, Keycloak headless-OAuth login (Playwright), typed GraphQL
  client, SQLite sync, pure stats/gapping (unit-tested).
- `packages/web` — Vite + React + D3 UI.
- `docs/` — design spec, API dossier, module/REST contracts.

## Notes
- Data units are meters. All traffic stays on localhost; the server only talks to Toptracer's
  own API with your token. Personal use.

## Deploy to fly.io

The app is packaged as a single container (Fastify serves both the API and the built web
SPA; headless Chromium is included for the Toptracer login). Files: `Dockerfile`, `fly.toml`,
`.dockerignore`.

```bash
fly launch --no-deploy      # first time: creates the app + the toptracer_data volume
fly secrets set APP_PASSWORD='choose-a-strong-password'   # protect the public URL (see below)
fly deploy
```

- **Region/app name:** edit `app` and `primary_region` in `fly.toml` (defaults: `toptracer`, `arn`/Stockholm).
- **Persistence:** the `toptracer_data` volume mounts at `/data`; the SQLite cache and the
  refresh token live there and survive deploys.
- **Memory:** 1 GB — headless Chromium needs the headroom.

### Security — read before deploying publicly
This app has **no built-in user accounts** and the login flow sends your Toptracer password
through the backend. On a public URL that means anyone who finds it could reach the login page
and your cached shot data. Mitigations:
- **Always set `APP_PASSWORD`** (a fly secret) — it enables HTTP Basic Auth on every request,
  so the browser prompts for a password before anything loads.
- Consider keeping the app private (fly private networking / `fly proxy` for on-demand access)
  if you don't want it internet-reachable at all.
- It remains a **single-user** tool: one cached account per deployment.

Run `fly deploy` yourself when ready — it is not run automatically.
