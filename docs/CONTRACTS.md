# Module & API contracts (implementation)

All server types live in `packages/server/src/types.ts` and constants in
`packages/server/src/config.ts`. Import from there; do not redefine.

## Server module interfaces

### `src/auth/index.ts`
```ts
export class NotLoggedInError extends Error {}
// Runs headless Playwright OAuth (trca client, custom-scheme redirect), holds password in
// memory only, persists ONLY the refresh token to config.SESSION_PATH.
export async function login(email: string, password: string): Promise<void>;
export async function logout(): Promise<void>;
export async function isLoggedIn(): Promise<boolean>;
// Returns a valid access token, refreshing via grant_type=refresh_token when expired.
// Throws NotLoggedInError if there is no usable refresh token.
export async function getAccessToken(): Promise<string>;
```

### `src/graphql/index.ts`
```ts
import type { UserProfile, Club, Session, Shot } from '../types.js';
export class ToptracerGraphQLClient {
  constructor(getAccessToken: () => Promise<string>);
  gql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  getUser(): Promise<UserProfile>;
  getUserClubs(gameMode: string): Promise<Club[]>;
  // Returns sessions (for the given mode) each paired with its shots (shots are nested in the
  // GraphQL response). Handles paging internally until fewer than `limit` come back.
  getSessionsWithShots(gameMode: string): Promise<Array<{ session: Session; shots: Shot[] }>>;
  getGameStats(): Promise<Record<string, number>>;
}
```

### `src/sync/db.ts`
```ts
import type Database from 'better-sqlite3';
export function openDb(): Database.Database;      // opens config.DB_PATH, runs migrations
export function migrate(db: Database.Database): void;
```

### `src/sync/index.ts`
```ts
import type { Club, Session, Shot, FilterOptions } from '../types.js';
export async function syncAll(
  client: ToptracerGraphQLClient,
  opts?: { gameModes?: readonly string[] }
): Promise<{ sessions: number; shots: number; clubs: number }>;
export function getClubs(): Club[];
export function getSessions(): Session[];
export function getShots(): Shot[];               // all stored shots
```

### `src/stats/index.ts` (PURE — no I/O; TDD with vitest)
```ts
import type { Shot, Club, FilterOptions, GappingResult } from '../types.js';
export function computeGapping(shots: Shot[], clubs: Club[], opts: FilterOptions): GappingResult;
export const DEFAULT_FILTER: FilterOptions; // metric 'flatCarry', cleanHit {enabled:true,k:1.5,minShots:8,filterLateral:false}
```
Clean-hit rule: per club, with the chosen metric, exclude shots outside
`[Q1 - k*IQR, Q3 + k*IQR]`. If `filterLateral`, also exclude on `offTargetLine`. Clubs with
fewer than `minShots` valid shots are returned with `trimmed:false` and nothing excluded for
outliers. Shots with `isHidden` are always excluded (`excludeReason:'hidden'`). Shots with a
null metric value are excluded (`excludeReason:'noData'`). Aggregates computed over kept shots.

## Local REST API (server ↔ web)

Base: same origin (Vite dev proxies `/api` → `http://127.0.0.1:5174`). Bind server to `127.0.0.1`.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/login` | `{email, password}` | `200 {ok:true, profile}` or `401 {ok:false, error}` |
| GET | `/api/session` | — | `{loggedIn: boolean, profile?: UserProfile}` |
| POST | `/api/logout` | — | `{ok:true}` |
| POST | `/api/sync` | `{gameModes?}` | `{sessions, shots, clubs}` counts |
| GET | `/api/clubs` | — | `Club[]` |
| GET | `/api/sessions` | — | `Session[]` |
| POST | `/api/gapping` | `FilterOptions` | `GappingResult` |

## Frontend (`packages/web/src`)
- `main.tsx`, `App.tsx`: if `/api/session` shows logged-out → `auth/LoginScreen.tsx`
  (email+password → POST /api/login); else the dashboard.
- Dashboard: a **Sync** button (POST /api/sync), a shared **filter panel**
  (`filters/FilterPanel.tsx`: metric toggle flatCarry/total, clean-hit on/off + strictness
  slider k 1.0–2.0 + minShots, club multi-select, date range), and views:
  - `views/GappingView.tsx` + `charts/GappingStrip.tsx` (primary: per-club table + horizontal
    gapping strip chart).
  - `views/DispersionView.tsx` + `charts/DispersionScatter.tsx` (polar L/R × distance scatter,
    per-club color, dispersion ellipse, excluded shots greyed; metric toggle) — replicate the
    Toptracer "Game details" look (light card, blue points, dashed range arcs, L100..R100 axis).
  - `views/SessionsView.tsx` (list).
- `lib/api.ts`: typed fetch wrappers for every endpoint above; `lib/types.ts` re-exports the
  shapes (copy the relevant interfaces from server `types.ts`).
- All requests go through the Vite `/api` proxy. Meters throughout (label "m").
