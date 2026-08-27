# Toptracer Range Analyzer — Design Spec

Date: 2026-08-26
Status: Approved design, access PROVEN end-to-end, ready for implementation planning
Related: `docs/research/toptracer-api-dossier.md` (initial research — partly superseded below)

---

## 1. Goal

A local web app: log in through a web page with the user's own Toptracer Range
credentials, download the user's own shot history, and produce custom visualizations
and filtrations — primarily **"how far does each of my clubs actually go"**, with a
clean-hit filter that removes mishits, and a dispersion view replicating the app's
Game Details screen.

Personal tool, runs on the user's machine. No credentials stored on disk.

## 2. Proven access (verified live this session — NOT assumptions)

The correct product (Toptracer **Range**, `com.toptracer.community`) was reached and real
data pulled. The APK on the user's Android device gave the exact OAuth config; no MITM needed.

**Auth — works headlessly:**
- Keycloak, realm `toptracer`, issuer `https://login.toptracer.com/realms/toptracer`.
- Range app client config, extracted verbatim from `base.apk` (`AppAuthConfig`):
  - `clientId = trca`
  - `redirectUri = com.toptracer.community.dev:/callback` (custom scheme; **loopback and
    all other redirects rejected** by Keycloak — only this one is registered)
  - `scope = openid offline_access`
  - Grant: **Authorization Code + PKCE** (ROPC/device-code disabled on all clients).
- Login form is **two-step**: `#username` → `#kc-login`, then `#password` → `#kc-login`.
- Because the redirect is a custom scheme (no browser return to a web app is possible), the
  login is completed by a **headless browser (Playwright/Chromium)** that drives the Keycloak
  form and captures the `code` from the 302 `Location` header. Verified end-to-end.
- Token: access token **~300s**; **refresh token does not expire** (`refresh_expires_in: 0`,
  `offline_access`). Log in once, refresh headlessly thereafter.

**Data API — the Range app's own GraphQL BFF:**
- `POST https://api.toptracer.com/api/appsbff/graphql`, `Authorization: Bearer <trca token>`
  (`aud: trca-backend`). Introspection is enabled.
- Verified live queries returning the user's real data:
  - `user { id email profileName distanceType speedUnitType ... }`
  - `userClubs(gameMode) { clubs { clubTypeDisplayName category nickname averages { carry total } } }`
    → real bag (Driver 108m/155m, 5-iron 103/123, 7-iron 82/103, 6-iron 78/97, 9-iron 87/92,
    PW 76/82, Lob wedge, …; meters).
  - `gameSessionsByGameMode(gameMode, offset, limit, shotFilter) { gameSessions { ... } }`
    → 8 `WhatsInMyBag` sessions, 1 `LaunchMonitor` (+ other modes empty).
  - `gameStats { totalShots rangesVisited totalDurationMinutes longestShot topBallSpeed topClubSpeed }`

**Key GraphQL types (introspected):**
- `Query.userClubs(gameMode: GameMode!) : UserClubsReply { clubs: [UserClubDto] }`
- `Query.gameSessionsByGameMode(gameMode: GameMode!, offset, limit, shotFilter) : GameSessionsOutput { gameSessions: [GameSession] }`
- `Query.gameSessionsByIds(gameSessionIds, shotFilter)`, `Query.userClubs`, `Query.clubCategories`,
  `Query.gameStats`, `Query.user`.
- `GameSession { id range{...} gameMode score tracedShots isFinished beginTimestamp timestamp
  courseName shots: [GameShot] hasLaunchMonitorStats }`
- `GameShot { id legacyId shotIndex gameMode isHidden clubType userClub{...}
  launchMonitorStats{spinRate clubHeadSpeed smashFactor} stats: GameShotStatsDto }`
- `GameShotStatsDto { total carry flatCarry ballSpeed launchAngle landingAngle curve height
  hangTime offTargetLine }`  ← the shot metrics driving every view
- `UserClubDto { id clubType clubTypeDisplayName category categoryDisplayName nickname
  displayOrder isDefault isHidden averages{carry total} }`
- `GameMode` enum: AngryBirds, ApproachShotChallenge, Assessment, AssessmentLite,
  CaptureTheFlag, ClosestToPin, CustomActivity, DrivingChallenge, GoFish, LaunchMonitor,
  LongDrive, PgaShowGame, PointsGame, PrecisionPro, PrecisionSeries, SwingCapture,
  VirtualGolf, WhatsInMyBag.
- Note: the API exposes a server-side `shotFilter` argument and an `isHidden` flag per shot —
  our clean-hit filter is applied client-side on top of the raw shots (we fetch all, filter
  ourselves) so filtering stays fully under our control.

## 3. Architecture

Single TypeScript monorepo, one `npm run dev`:

```
toptracer/
  packages/
    server/                       # Fastify + better-sqlite3 + Playwright
      src/
        auth/                     # login page flow, headless Keycloak login, token cache/refresh
        graphql/                  # typed GraphQL client + queries against appsbff
        sync/                     # fetch sessions+shots+clubs → SQLite
        stats/                    # gapping + clean-hit filters (pure, unit-tested)
        routes/                   # local REST API + login endpoints for the frontend
      data/toptracer.db           # gitignored
      data/session.json           # gitignored: refresh token only
    web/                          # Vite + React + D3/visx
      src/
        auth/                     # login screen (email+password → POST /api/login)
        views/                    # Gapping, Dispersion, Sessions
        filters/                  # filter UI + state
        charts/                   # polar dispersion scatter, gapping strip
  docs/
```

**Why:** one language; D3/visx for the polar dispersion scatter + ellipse; SQLite for
incremental sync and instant UI; local backend keeps the password/token on-machine and
avoids browser CORS. Playwright is used only to complete the custom-scheme OAuth login.

## 4. Auth flow (web-page login, no stored credentials)

The user's requested model: **log into a web page, then see the visualizations.**

1. Frontend shows a login screen (email + password) served from `127.0.0.1`.
2. `POST /api/login {email, password}` → backend runs the headless Playwright OAuth:
   - build authorize URL (`client_id=trca`, `redirect_uri=com.toptracer.community.dev:/callback`,
     PKCE S256, `scope=openid offline_access`),
   - drive the two-step Keycloak form with the submitted credentials,
   - capture `code` from the 302 `Location`, exchange for tokens.
   - **The password is held in memory for this single request only and never written to disk.**
3. Persist **only** the non-expiring refresh token (`data/session.json`, gitignored).
4. All later calls use `getAccessToken()` → refresh via `grant_type=refresh_token`. The user
   stays logged in across restarts; re-login is needed only if the refresh token is revoked
   (e.g., password change) — surfaced as a "log in again" state in the UI.
5. `GET /api/session` reports logged-in/out so the SPA shows login vs. dashboard.

Security notes: password transits our local backend once (unavoidable — `trca` is a native
client with only a custom-scheme redirect, so a browser round-trip to Toptracer's own login
page cannot return to a web app). It is never persisted or logged. Everything binds to
localhost. The `.env` used during verification is not required by the app and can be deleted.

## 5. Components

### 5.1 `auth`
- `login(email, password): Promise<void>` — headless OAuth, stores refresh token.
- `getAccessToken(): Promise<string>` — cached access token or refresh; throws `NotLoggedIn`
  if no valid refresh token (frontend routes to login screen).
- `logout()` — clears `session.json`.
- PKCE + two-step form automation; token/credential redaction on all error paths.

### 5.2 `graphql`
- Thin typed client: `gql(query, variables)` with bearer injection + backoff.
- Queries: `getUser`, `getUserClubs(gameMode)`, `getSessions(gameMode, offset, limit)`,
  `getSessionsByIds(ids)`, `getGameStats`, `getClubCategories`. Each requests exactly the
  fields above (no over-fetching).
- Iterate all relevant game modes to assemble full history (default: `WhatsInMyBag`,
  `LaunchMonitor`, plus any mode with sessions).

### 5.3 `sync`
- `syncAll()`: for each game mode → page sessions → fetch each session's `shots` → normalize
  → upsert into SQLite. Incremental via stored session ids + `timestamp`.
- **SQLite schema (core):**
  - `sessions(id PK, game_mode, range_name, begin_ts, ts, traced_shots, has_lm_stats, raw_json)`
  - `shots(id PK, session_id FK, shot_index, game_mode, club_type, club_display_name,
    club_category, is_hidden, carry, flat_carry, total, ball_speed, launch_angle,
    landing_angle, curve, height, hang_time, off_target_line, spin_rate, club_head_speed,
    smash_factor, raw_json)`
  - `clubs(id PK, club_display_name, category, nickname, display_order, avg_carry, avg_total)`
  - Keep `raw_json` so new fields never force a re-fetch.
- Units: API returns meters (`user.distanceType`). Store canonical meters; convert in UI.

### 5.4 `stats` — gapping & clean-hit filters (pure, TDD'd)
- **Clean-hit filter (per club, IQR-based — approved definition):** for each club compute
  Q1/Q3/IQR of the chosen metric; exclude outside `[Q1 − k·IQR, Q3 + k·IQR]`; same optionally
  on `off_target_line`. `k` = strictness slider (default 1.5, ~1.0–2.0). Clubs with fewer than
  `minShots` (default ~8) are shown but not trimmed, and flagged.
- Also respect the API's `is_hidden` flag (shots the user hid in the app) as a baseline exclude.
- Filters: date range, session set, club set, metric = flatCarry | total.
- Per-club aggregates: kept/excluded counts, mean, median, P25/P75 carry, std, lateral bias
  (mean `off_target_line`), dispersion width.
- All pure `(shots, options) => result`; exhaustively unit-tested (empty, single-shot, ties).

### 5.5 Views (React + D3/visx)
1. **Club Gapping (primary):** one row per club — avg/median carry, P25–P75 band, kept vs
   excluded — plus a horizontal gapping strip chart with overlaps. flatCarry/total toggle.
2. **Dispersion Scatter (screenshot replica):** polar plot, lateral (L/R) × distance, per-club
   color, dispersion ellipse, excluded shots greyed, metric toggle. Single- or multi-club.
3. **Sessions list:** date, range, mode, shot count → drill into a session.
- Shared filter panel drives all views.

### 5.6 `routes` — local API
- `POST /api/login`, `GET /api/session`, `POST /api/logout`.
- `POST /api/sync`, `GET /api/clubs`, `GET /api/sessions`, `GET /api/shots?...`,
  `GET /api/gapping?filters...`. Binds `127.0.0.1` only.

## 6. Data flow

```
login page (email+pass) ─▶ /api/login ─▶ auth (Playwright OAuth, in-memory pw)
                                             │  persists refresh token only
                                             ▼ access token
                                       graphql (appsbff)
                                             │ user, clubs, sessions, shots
                                             ▼
                                          sync ─▶ SQLite
                                             │
                               stats (clean-hit, gapping) ◀── filter UI
                                             ▼
                                   React views (D3/visx)
```

## 7. Testing

- `stats`/`filters`: TDD, pure-function unit tests (Vitest), incl. clean-hit edge cases.
- `graphql`: tested against recorded response fixtures captured this session (no network in tests).
- `auth`: refresh-path unit-tested with a mock token endpoint; headless login is a thin,
  manually-verified shell (already proven end-to-end).
- Smoke test: `login → getUser → getUserClubs` returns real bag (passing by hand).

## 8. Security & constraints

- No credentials on disk; only the refresh token in `data/session.json` (gitignored, alongside
  `data/*.db`). Password in memory for one request. Tokens/creds never logged. Localhost-only.
- Access is the user's own account via the same client the official app uses. Toptracer ToS not
  formally reviewed; personal, non-distributed use assumed.

## 9. Scope for v1 (YAGNI)

**In:** web-page login + refresh; sync to SQLite; IQR clean-hit filter with strictness slider;
club-gapping view; dispersion scatter replica; sessions list; flatCarry/total toggle;
date/session/club filters.

**Out (later):** trend-over-time; multi-account; deploy; shot-video/trace rendering; manual
per-shot tagging beyond the API's `is_hidden`.

## 10. Open items carried into implementation

- Confirm exact `range { name }` subfields and `beginTimestamp` formatting on first sync.
- Decide default set of game modes to sync (all non-empty vs. WhatsInMyBag+LaunchMonitor).
- Confirm the 149-shot "Game details" view is per-session vs. aggregated-across-sessions
  (affects whether gapping aggregates all sessions by default — current plan: aggregate all).
