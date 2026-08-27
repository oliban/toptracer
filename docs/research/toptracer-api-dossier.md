# Toptracer Range API Dossier

Merged research on the Toptracer Range / Toptracer Coach data backend, focused on how a personal tool could log in as its own user and download individual shot data.

Last updated: 2026-08-26

---

## 1. Summary + overall confidence

**Overall confidence: HIGH on the API shape and auth model; MEDIUM on the single blocker (the mobile app's OAuth `client_id`) and on whether consumer Range shots land in this backend.**

The single biggest finding across all sweeps: **`game-data.toptracer.com` is a FastAPI service (`game-data-api` v0.1.0) that publishes a complete, PUBLIC, unauthenticated OpenAPI 3.1 spec** at `https://game-data.toptracer.com/openapi.json` (Swagger UI at `/docs`, ReDoc at `/redoc`). Every path, query parameter, and JSON field name in this dossier is copied directly from that live spec — not guessed — except where explicitly flagged UNKNOWN/GUESS.

- Auth is **self-hosted Keycloak**, realm `toptracer`, issuer `https://login.toptracer.com/realms/toptracer`. CONFIRMED live via OIDC discovery. Not Auth0/Firebase/Cognito.
- Data endpoints require a **Bearer JWT** (verified: unauthenticated calls return `401 {"detail":"Not authenticated"}` with `WWW-Authenticate: Bearer`). A **legacy** `x-api-key` + `x-user-id` header pair is also accepted but is partner-issued and not available to a normal consumer.
- The **shot export target** is `GET /sessions/{session_uuid}/shots`, returning `ShotWithFullData` objects with full ballistics (carry, flat carry, total, ball speed, launch, apex, hang time, spin, club, offline, etc.).
- Four sibling FastAPI hosts also ship public OpenAPI specs: `webster.toptracer.com` (shot images/media), `partner-gateway.toptracer.com` (B2B site ops), `eu.tres.toptracer.com` (event management). `api.toptracer.com` and `api.coach.toptracer.com` are AWS ELBs that 404 on all probed paths (path-prefix routed, no discoverable REST surface).

**The one blocker:** the OAuth `client_id` used by the Toptracer Range mobile app was NOT recovered from public sources. A guess of `toptracer-app` returned `invalid_client`. The public web client `pocket` (Toptracer Go SPA) IS confirmed and usable, and a client named `trca` was confirmed to exist in the realm (strong inference: the Range app), but neither's registered redirect URIs are confirmed. Recovering the real `client_id`/`redirect_uri` requires intercepting the app (mitmproxy) or decompiling the APK.

**Open assumption (why not fully HIGH):** `game-data.toptracer.com` is oriented toward the Coach/assignments product. It stores the sessions/shots/traces model and shares the Keycloak account system, but it was NOT positively confirmed that the **consumer** Range app (`com.toptracer.community`) writes personal range shots into THIS host versus a sibling behind `api.toptracer.com` / `eu.tres`. Verify by calling `GET /v1/players/{your_sub}/sessions` after a real login.

---

## 2. Auth flow

**Provider: self-hosted Keycloak. Realm: `toptracer`. — CONFIRMED (live OIDC discovery + OpenAPI securitySchemes, all four sweeps agree).**

Issuer: `https://login.toptracer.com/realms/toptracer`
OIDC discovery: `https://login.toptracer.com/realms/toptracer/.well-known/openid-configuration`

### Endpoints (CONFIRMED from discovery doc)

| Purpose | URL |
|---|---|
| Authorization | `https://login.toptracer.com/realms/toptracer/protocol/openid-connect/auth` |
| Token | `https://login.toptracer.com/realms/toptracer/protocol/openid-connect/token` |
| Userinfo | `https://login.toptracer.com/realms/toptracer/protocol/openid-connect/userinfo` |
| Logout / end session | `https://login.toptracer.com/realms/toptracer/protocol/openid-connect/logout` |
| JWKS (verify signatures) | `https://login.toptracer.com/realms/toptracer/protocol/openid-connect/certs` |
| Introspection | `https://login.toptracer.com/realms/toptracer/protocol/openid-connect/token/introspect` |
| Dynamic client registration | `.../clients-registrations/openid-connect` |

### Grants & scopes (CONFIRMED)

- `grant_types_supported`: `authorization_code`, `password` (ROPC), `client_credentials`, `implicit`, `refresh_token`, `urn:ietf:params:oauth:grant-type:device_code`, `token-exchange`, `uma-ticket`, `ciba`.
- PKCE: `code_challenge_methods_supported` = `S256`, `plain`. — CONFIRMED
- `scopes_supported`: `openid`, `profile`, `email`, `offline_access` (→ refresh token), `roles`, `groups`, `fullname`, `phone`, `address`, `basic`.
- `token_endpoint_auth_methods`: `client_secret_basic`/`post`, `private_key_jwt`, `client_secret_jwt`, `tls_client_auth`.
- ID token signing default: RS256.
- Login-page options (CONFIRMED from rendered Keycloak page, title "Sign in to Toptracer"): email+password, Continue with Google, Continue with Apple, Continue with GDO. No Facebook. ("GDO" = a third federated IdP, likely a golf account — MEDIUM confidence on what it stands for.)

### Client IDs

| client_id | Status | Notes |
|---|---|---|
| `pocket` | **CONFIRMED** public client | Toptracer Go SPA. Hard-coded in `app.pocket.toptracer.com/static/js/main.331c45bc.js` as `CLIENT_ID:"pocket"`. Uses Auth Code + PKCE (oidc-client-ts), scope `profile openid email roles basic offline_access`, authority `https://login.toptracer.com/realms/toptracer`. Most viable public path. |
| `trca` | **CONFIRMED exists** in realm | Strong inference this is the Toptracer Range app (matches Android pkg `com.toptracer.community` = "Toptracer Range Community App"). Confirmed via redirect_uri-vs-not-found error oracle. Its registered redirect_uri is UNKNOWN (`toptracerrange://oauth/callback` was rejected). Deep-link scheme is `toptracerrange://`. |
| `coach` | CONFIRMED exists | Toptracer Coach product. |
| `account`, `account-console`, `admin-cli` | CONFIRMED | Default Keycloak clients. |
| `toptracer-app` | **REJECTED** | Guess; returned `invalid_client`. Not the real one. |

Client enumeration used the authorize endpoint as an oracle: a real client returns "Invalid parameter: redirect_uri", a fake one returns "Client not found".

### Required headers on data hosts (CONFIRMED)

- `Authorization: Bearer <access_token>` — standard Keycloak JWT.
- Legacy alternative accepted by `game-data` and `webster` securitySchemes: `x-api-key` + `x-user-id` (apiKey headers, "legacy auth"). Partner/internal only — not obtainable by a normal consumer account.

### Your own `user_uuid`

`user_uuid` (needed for `/players/{user_uuid}/...` paths) = the JWT **`sub`** claim, also available from the `userinfo` endpoint or `GET /users/configuration`. — CONFIRMED (schema/claim level).

### Token lifetime — **UNKNOWN / not measured**

Not captured in any sweep. Keycloak defaults are typically ~5 min access token / ~30 min SSO session, but the realm's actual `access.token.lifespan` was not read. Request `offline_access` scope to get a long-lived refresh token, and refresh via `grant_type=refresh_token`. Verify actual lifetimes empirically once you have a token.

### Per-claim confidence

- Provider = Keycloak, realm `toptracer`, all endpoints: **HIGH (live fetch).**
- Grants incl. password + auth-code+PKCE + refresh, PKCE S256, scopes: **HIGH (discovery doc).**
- `pocket` client works end-to-end for `game-data`: **MEDIUM** — client confirmed, but token acceptance across products and its redirect_uris not verified end-to-end.
- `trca` = the Range app: **MEDIUM (strong naming inference).**
- Real Range-app `client_id` + `redirect_uri`: **UNKNOWN (blocker).**
- Whether `trca` permits Direct Access Grants (password grant) vs forcing browser auth-code: **UNKNOWN.**
- Token lifetimes: **UNKNOWN.**

---

## 3. Data endpoints

Host: `https://game-data.toptracer.com` unless noted. All non-health endpoints require `Authorization: Bearer <token>` (verified 401 without). All paths/params below are **CONFIRMED from `/openapi.json`**; response bodies are schema-derived (not observed live, since no token was available).

### Sessions list

- `GET /v1/players/{user_uuid}/sessions` — **preferred.** Paginated → `Page_ExtendedBaseSession`. Query: `game_mode` (enum), `limit`, `offset`, `use-mock-data` (bool).
- `GET /players/{user_uuid}/sessions` — older variant → `Sessions {user_uuid, game_mode, sessions[], total_count}`. Query: `game_mode`, `limit`, `offset`, `use-mock-data`; header `if-modified-since`.

This is the main entry point to enumerate a user's history.

### Session detail

- `GET /sessions/{session_uuid}` → `SingleSession` (full stats: range, timing, hcp, tee/approach dispersion, strokes gained, weather, activity, assignment). Query: `use-mock-data`; header `If-Modified-Since`.

### Shots — THE KEY ENDPOINT

- `GET /sessions/{session_uuid}/shots` → array of `ShotWithFullData` (full per-shot ballistics — see section 4). Query: `shot_type` (enum `tee | approach | drive`); header `If-Modified-Since`.

### Traces (ball-flight geometry)

- `GET /sessions/{session_uuid}/traces` → array of `ShotTraces` (`trace` coordinate array, `ball_speed`, `flat_carry`, `height`, `hole_idx`, `webster_id`). `webster_id` links to the Webster image API.

### Completed games

- `GET /players/{user_uuid}/completed-games` → array of `CompletedGameResponse` (`session_id`, `user_id`, `timestamp_end`, `game_mode`). Query: `start_date`, `end_date` (date-time, **required**).

### Aggregate stats

- `GET /players/{user_uuid}/sessions-stats` → `GeneralStats`. Query: `game-mode` (**required**).
- `GET /dashboard/stats` → `DashboardResponseStatsResponse` (`totalNumberOfSessions`, `totalNumberOfShots`, `totalDurationMinutes`, `rangeVisits`, `sessionDetails`, `startDate`, `endDate`). Query: `userIds` (UUID array), `timePeriod` (enum, required), `customFrom`, `customTo`.

### User profile / self

- `GET /players` — list players/self accessible to the authenticated user.
- `GET /players/{user_uuid}` → `PlayerSummaryResponse` / `CoachPlayerSummaryResponse` (`user_id`, `first_name`, `last_name`, `profile_name`, `email`, `last_activity`, `goal`, `coaches`).
- `GET /users/configuration` → `UserConfigurationResponse` (units etc.; `PATCH` to update). Units governed by `DistanceUnit`/`SpeedUnit`/`TemperatureUnit` enums.

### Clubs

**No dedicated `/clubs` endpoint exists in the spec.** Club information is embedded per-shot (`club`, `club_name`, `club_category`) and in per-club session breakdowns inside `SingleSession`. There is no standalone "list my clubs / what's-in-my-bag" resource confirmed; the `whats_in_my_bag` game mode surfaces club data through the sessions/shots model instead.

### Coach/admin-oriented (exist, mostly not consumer)

`/assignments`, `/players/{user_uuid}/assignments` (query `assignment_status`, `assignment_title`, `limit`, `offset`), `/drills`, `/coach`, `/admin/*`, `/features`.

### Health (unauthenticated — useful for connectivity checks)

- `GET /health` → `"Ok"`; `GET /health/ready` → `"All is good"`. Security: none. CONFIRMED 200.

### Token endpoint (repeat, for the request flow)

- `POST https://login.toptracer.com/realms/toptracer/protocol/openid-connect/token` — form-urlencoded. `grant_type=authorization_code` + `code` + `code_verifier` + `redirect_uri` + `client_id`, OR `grant_type=refresh_token` + `refresh_token` + `client_id`, OR `grant_type=password` + `username` + `password` + `client_id`. Add `scope=openid profile email offline_access`.

### Sibling hosts (public OpenAPI, Bearer-gated data)

- `webster.toptracer.com` — "Webster API" v0.1.0. `GET /image/{filepath}` (shot PNG from S3, `-` delimiter), `GET /images`, `GET /camera/metadata`, `GET /cameras/metadata`, `GET /health`. OAuth2 Bearer. Link via `ShotTraces.webster_id`.
- `partner-gateway.toptracer.com` — "Toptracer Partner Gateway" v0.1.1. B2B, keyed by `site_id`: `/bay-booking/sites`, `POST /bay-booking/sites/{site_id}/bays/{bay_nr}`, `/site/{site_id}/shots-to-target`, `/site/{site_id}/shot-statistics`, `/site/{site_id}/targets`, `/site/{site_id}/targets-map`, `/site/{site_id}/bay-sessions`, `/health`.
- `eu.tres.toptracer.com` — "TRES API" v1. Range event/challenge management: `GET/POST /event`, `/events`, `/event/{id}`, `/event/{id}/qr_code`, `/site/{site_code}/event...publish|unpublish|archive|end|sponsor`. Health at `/healthcheck` (not `/health`). Bare `tres.toptracer.com` is NXDOMAIN — only the `eu.` regional host resolves.

---

## 4. Shot data fields available

**CONFIRMED from `ShotWithFullData` schema (`GET /sessions/{session_uuid}/shots`).** snake_case throughout.

Requested checklist:

| Requested field | Available? | Field name(s) |
|---|---|---|
| Carry | Yes | `carry` (and `flat_carry`) |
| Flat carry | Yes | `flat_carry` |
| Total | Yes | `total_distance` (also `shot_distance`) |
| Lateral offset | Yes | `off_target_line` (+ right / − left), plus `curve` (+ right / − left) |
| Ball speed | Yes | `ball_speed` |
| Launch angle | Yes | `launch_angle` |
| Launch direction | Yes | `ball_horizontal_launch_angle` |
| Apex height | Yes | `height` |
| Hang time | Yes | `hang_time` |
| Spin | Yes | `ball_spin`, `ball_spin_axis`, `ball_side_spin`, `ball_back_spin` |
| Club id | Yes | `club`, `club_name`, `club_category` |
| Timestamp | Yes | `timestamp` |
| Bay / site | Partial | Bay is at session level (`bay_session_id`); site/range is `range_id` + `range_name` on the session, not on the shot |

**Full `ShotWithFullData` field list:**
`id`, `user_id`, `session_id`, `shot_number`, `shot_type`, `timestamp`, `club`, `club_name`, `club_category`, `activity_requirements_met`, `game_shot_id`, `resulting_lie`, `shot_distance`, `flat_carry`, `hang_time`, `total_distance`, `ball_speed`, `launch_angle`, `height`, `landing_angle`, `curve`, `performance_hcp`, `prox_to_hole`, `carry`, `strokes_gained`, `chart_coordinates`, `has_launch_monitor_stats`, `off_target_line`, `club_head_speed`, `club_vertical_path_angle`, `club_horizontal_path_angle`, `club_face_angle`, `club_lie`, `club_loft`, `club_f_angle`, `club_closure_rate`, `club_impact_location` (`Point2D {x,y}`), `ball_spin`, `ball_spin_axis`, `ball_horizontal_launch_angle`, `ball_flight_trace` (array of `[x,y]`), `ball_side_spin`, `ball_back_spin`, `club_smash_factor`, `club_face_to_path`.

**Important:** the `club_*` and spin fields are populated only when `has_launch_monitor_stats` is `true` (a launch-monitor bay). A plain camera bay leaves them `null`. This matches SwingSync's distinction between "original Toptracer metrics" (ball_speed, launch_angle, carry, offline, peak height, curve) and "predicted" club/spin metrics. Human-facing labels (help.toptracer.com article 65) map 1:1: Flat Carry, Total Distance, Ball Speed, Curve, Hang Time, Height (Apex), Offline, Landing Angle, Launch Angle; indoor adds Spin Rate, Spin Axis, Side/Back Spin, Launch Direction, Club Speed, Smash Factor, Attack Angle, Club Path, Face Angle, Face to Path, Lie Angle, Dynamic Loft, Closure Rate, Impact Location.

**`ShotTraces`:** `hole_idx`, `webster_id`, `right_hand_system`, `trace` (array of coordinate tuples — reported variously as `[x,y]` / `[x,y,z]` / 4-tuples across sweeps), `id`, `shot_number`, `ball_speed`, `flat_carry`, `height`.

**`SingleSession` / `ExtendedBaseSession` (session summary):** `id`, `user_id`, `game_mode`, `timestamp_start`, `timestamp_end`, `range_name`, `range_id`, `bay_session_id`, `longest_shot`, `performance_hcp`, `duration_minutes`, `number_of_shots`, `status`, `report_version`, `activity_id`, `activity_results`, `activity_title`, `tee_id`, `overall_performance_hcp`, `overall_strokes_gained`, `reference_hcp`, `hcp_buckets`, `tee_performance_hcp`, `tee_strokes_gained`, `average_tee_shot_distance`, `tee_longest_shot`, `tee_dispersion_fairway/left/right`, `dispersion_fairway_width`, `approach_performance_hcp`, `approach_strokes_gained`, `approach_green_diameter`, `approach_fairway_diameter`, `approach_average_from_pin`, `approach_accuracy_green/left/right/top/bottom`, `approach_birdie_opportunities_count/percentage`, `next_shot_webster_id/hole_index/type`, `weather`, `activity`, `assignment`.

**`WeatherResponse`:** `longitude`, `latitude`, `wind_speed`, `wind_deg`, `wind_direction`, `temperature`, `pressure`, `humidity`, `code`, `icon`, `description`, `main`.

**Enums:** `ShotType` = `tee | approach | drive`. Game modes include `launch_monitor`, `t30_lite`, `whats_in_my_bag`, `closest_to_pin`, `player_assessment`, `pga_show_game_assessment`, `custom_activity`.

**Naming note:** shot/session payloads use snake_case (`ball_speed`, `flat_carry`); dashboard payloads use camelCase (`totalNumberOfShots`).

---

## 5. Known gotchas

- **CORS is credentialed and origin-scoped.** `game-data` reflects the requesting `Origin` into `access-control-allow-origin` with `access-control-allow-credentials: true` — tested with `Origin: https://app.pocket.toptracer.com`. This is for known SPA origins; a browser-based tool from an arbitrary origin may not be trusted, but a server-side/CLI tool is unaffected (CORS is browser-enforced only).
- **Certificate pinning (mobile app).** NowSecure MARC flagged the iOS app; the app may pin certs, which breaks a plain mitmproxy MITM. Bypass needs Frida/objection (jailbreak/root or repackaging). The web SPA (`pocket`) has no such pinning — easier to observe.
- **App-only / legacy headers.** The `x-api-key` + `x-user-id` legacy auth path is partner-issued and not available to consumers — do not plan around it. Use OAuth.
- **`client_id` is mandatory.** The token endpoint returns `invalid_client` without a valid one — the core blocker.
- **Redirect URIs unknown.** `pocket`'s and `trca`'s registered redirect URIs are not confirmed; a loopback/custom URI may be rejected. `toptracerrange://oauth/callback` was rejected for the mobile scheme.
- **Product-boundary uncertainty.** `game-data` is Coach/assignments-oriented. Whether a plain consumer Range account has populated sessions/shots there is unconfirmed — verify with `GET /v1/players/{sub}/sessions` after login. Consumer data might instead flow through `api.toptracer.com` (AWS ELB, no discoverable REST surface, `/app/*` serves HTML deep-link pages) or `eu.tres`.
- **Token lifetime unknown** — build refresh handling; request `offline_access`.
- **Caching.** Respect `If-Modified-Since` on session/shots endpoints and `limit`/`offset` paging.
- **Rate limits — UNKNOWN.** No rate-limit headers or throttling behavior were observed. Be conservative; add backoff.
- **ToS considerations.** No official CSV export exists (multiple user reviews confirm the gap). This is you accessing your own account data the same way the app does — but Toptracer's Terms of Service / API terms were not reviewed here. Automated scraping may violate ToS even for your own data; review before distributing a tool. The only public third-party exporter, SwingSync, logs in with the user's own credentials stored on-device — indirect confirmation the login is scriptable, and of the credential-login model.
- **No public reverse-engineering writeup or GitHub client exists.** `magnus188/OpenCaddie` names the game-data OpenAPI URL but has not implemented the integration (partner-gated planning). `tgustafson75-sketch/smartplay` only OCR-parses screenshots via an LLM. The `r10progress` repo is Garmin R10, unrelated.
- **Backend stack (context).** Range mobile team backend = C#/.NET/Redis/SQL/Scala (REST over ASP.NET, not GraphQL/gRPC — `/graphql` 404s on game-data). Coach/data platform = Python + FastAPI (confirmed). No GraphQL/gRPC on the consumer path.

---

## 6. Recommended next step to gain access

Two tracks. Try Track A first (no phone, no MITM); fall back to Track B to recover the real mobile `client_id`.

### Track A — Try the confirmed public `pocket` client (fastest)

The `pocket` web client is confirmed public and uses Auth Code + PKCE. Do a one-time loopback browser login, cache the refresh token, then hit `game-data`.

1. Sanity-check connectivity (no auth):
   ```bash
   curl -s https://game-data.toptracer.com/health          # -> Ok
   curl -s https://login.toptracer.com/realms/toptracer/.well-known/openid-configuration | jq .token_endpoint
   ```
2. Generate PKCE and open the authorize URL in a browser (loopback redirect). Replace `REDIRECT` with a loopback like `http://localhost:8123/callback` (may be rejected if not registered — see Track B):
   ```bash
   CV=$(openssl rand -base64 64 | tr -d '\n=+/' | cut -c1-64)
   CC=$(printf '%s' "$CV" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
   echo "code_verifier=$CV"
   open "https://login.toptracer.com/realms/toptracer/protocol/openid-connect/auth?client_id=pocket&response_type=code&scope=openid%20profile%20email%20offline_access&redirect_uri=REDIRECT&code_challenge=$CC&code_challenge_method=S256&state=xyz"
   ```
3. Capture `code` from the redirect, exchange it:
   ```bash
   curl -s -X POST https://login.toptracer.com/realms/toptracer/protocol/openid-connect/token \
     -d grant_type=authorization_code -d client_id=pocket \
     -d code=THE_CODE -d code_verifier=$CV -d redirect_uri=REDIRECT | jq .
   ```
4. (Optional) Try ROPC directly — works only if the client permits Direct Access Grants:
   ```bash
   curl -s -X POST https://login.toptracer.com/realms/toptracer/protocol/openid-connect/token \
     -d grant_type=password -d client_id=pocket \
     -d username='you@example.com' -d password='YOURPASS' \
     -d scope='openid profile email offline_access' | jq .
   ```
5. Decode `sub` from the access token, then pull data:
   ```bash
   TOKEN=... ; SUB=$(printf %s "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq -r .sub)
   curl -s -H "Authorization: Bearer $TOKEN" https://game-data.toptracer.com/users/configuration | jq .
   curl -s -H "Authorization: Bearer $TOKEN" "https://game-data.toptracer.com/v1/players/$SUB/sessions?limit=50" | jq .
   SESSION=... # a session_uuid from the list
   curl -s -H "Authorization: Bearer $TOKEN" "https://game-data.toptracer.com/sessions/$SESSION/shots" | jq .
   curl -s -H "Authorization: Bearer $TOKEN" "https://game-data.toptracer.com/sessions/$SESSION/traces" | jq .
   ```
6. Refresh when needed:
   ```bash
   curl -s -X POST https://login.toptracer.com/realms/toptracer/protocol/openid-connect/token \
     -d grant_type=refresh_token -d client_id=pocket -d refresh_token=THE_REFRESH | jq .
   ```

If step 5 returns your real Range sessions, you're done — no phone needed. If it returns empty (consumer Range data lives elsewhere) or `pocket`'s redirect_uri is rejected, go to Track B.

### Track B — mitmproxy capture on the iPhone (recover the real Range-app `client_id`)

Goal: capture (1) the `client_id` + `redirect_uri` + `code_verifier` on the login call to `login.toptracer.com`, and (2) the subsequent Bearer-authenticated GETs to see which host serves consumer sessions/shots.

1. Install mitmproxy on your computer: `pip install mitmproxy` (or `brew install mitmproxy`). Run `mitmweb` (web UI) or `mitmproxy`.
2. Point the iPhone's Wi-Fi HTTP proxy at your computer's IP + port 8080 (Settings → Wi-Fi → your network → Configure Proxy → Manual).
3. On the iPhone, open Safari to `http://mitm.it`, download and install the mitmproxy CA profile, then **trust it**: Settings → General → About → Certificate Trust Settings → enable full trust for the mitmproxy cert. (Both install AND trust are required.)
4. Open the Toptracer Range app and sign in. Watch mitmproxy for:
   - `POST .../realms/toptracer/protocol/openid-connect/token` and the preceding `.../auth` — read `client_id`, `redirect_uri`, `code_challenge`.
   - The Bearer-authenticated GETs after login — note the **host** (`game-data` vs `api.toptracer.com` vs `eu.tres`) and exact paths that return session/shot history.
5. **Pitfall — certificate pinning.** The app may pin certs (NowSecure flagged it); if login traffic doesn't appear or fails only inside the app, pinning is blocking you. Bypass with Frida + objection (`objection -g com.toptracer.community explore` then `ios sslpinning disable`), which needs a jailbroken device or a repackaged/resigned IPA. This is the hardest step; try Track A and the web-app capture first.
6. **Easier variant — capture the web SPA instead.** `app.pocket.toptracer.com` (Toptracer Go) and `coach.toptracer.com` have no cert pinning. Proxy a desktop browser through mitmproxy, log in, and read the exact token request and API calls without touching the phone. This confirms `client_id=pocket`, the working redirect_uri, and which endpoints the SPA actually calls.
7. Once you have a valid `client_id` + `redirect_uri`, repeat Track A steps 2–6 with those values.

---

## 7. Sources

**Live, fetched this research (CONFIRMED):**
- https://game-data.toptracer.com/ (Welcome page), /openapi.json, /docs, /redoc, /health, /health/ready
- https://login.toptracer.com/realms/toptracer/.well-known/openid-configuration
- https://login.toptracer.com/realms/toptracer (realm info), /account/, /protocol/openid-connect/auth
- https://webster.toptracer.com/openapi.json, /docs, /health
- https://partner-gateway.toptracer.com/openapi.json, /health
- https://eu.tres.toptracer.com/, /openapi.json, /healthcheck
- https://api.toptracer.com/ (404), https://api.toptracer.com/app/event?eventid=20205683-be7e-4819-868c-91e8ee1bbeba (HTML deep-link)
- https://api.pocket.toptracer.com/ (locked, /health only), https://app.pocket.toptracer.com/ + /static/js/main.331c45bc.js (client_id=pocket)
- https://coach.toptracer.com/, https://api.coach.toptracer.com/ (404)
- https://trms.toptracer.com/welcome/ (301 → /trms), https://leaderboard.toptracer.com/ (301), https://static.trca.toptracer.com/ (S3 403)
- https://api.certspotter.com/v1/issuances?domain=toptracer.com&include_subdomains=true (subdomain enumeration)

**Supporting / context:**
- https://help.toptracer.com/article/65-understanding-shot-parameters-in-toptracer
- https://help.toptracer.com/article/55-navigate-the-dashboard
- https://swingsync.com/blog/export-from-toptracer
- https://careers.toptracer.com/departments/toptracer-range-mobile-app , /jobs/7887600-software-engineer
- https://github.com/magnus188/OpenCaddie/blob/HEAD/docs/integrations.md
- https://github.com/tgustafson75-sketch/smartplay/blob/HEAD/api/toptracer-parse.ts
- https://github.com/leverdeterre/shakeMyApps-appScan-blog/blob/HEAD/_pages/ios_apps/com.toptracer.community.md
- https://play.google.com/store/apps/details?id=com.toptracer.community
- https://apps.apple.com/us/app/toptracer-range/id1336223555
- https://www.appbrain.com/app/toptracer-range/com.toptracer.community , https://apkpure.com/... , https://appgoblin.info/apps/com.toptracer.community
- https://www.nowsecure.com/marc-app/toptracer-range-ios/
- https://toptracer.com/pdf/2023_PrivacyPolicy_TTR.pdf , https://toptracer.com/range/

---

## What is known vs unknown (honesty check)

**KNOWN (HIGH):** the full endpoint surface and every shot/session/trace field name (public OpenAPI); the auth provider (Keycloak), realm, all OIDC endpoints, grants, scopes, PKCE; that data endpoints need a Bearer token; the `pocket` client_id; existence of `trca`/`coach` clients; four sibling FastAPI hosts and their specs; CORS behavior.

**UNKNOWN / UNVERIFIED:** the Range mobile app's real `client_id` and `redirect_uri` (the blocker); whether `trca`/`pocket` permit password grant; whether a token minted for `pocket` is accepted by `game-data` end-to-end; whether consumer Range shots actually live in `game-data` vs a host behind `api.toptracer.com`/`eu.tres`; token lifetimes; rate limits; exact ToS position. All of these are resolvable with one real login (Track A) or one app capture (Track B).
