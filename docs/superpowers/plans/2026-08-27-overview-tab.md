# Overview Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default "Overview" tab that analyses each club's performance, freshness, consistency trend, and bag gaps, and ranks which clubs to practise next.

**Architecture:** A pure backend function `computeOverview(gapping, clubs, sessions)` reuses the existing `computeGapping` output (clean-hit filtered) and adds practice-need scoring, distance-gap detection, and per-club consistency trends. Exposed as `POST /api/overview`. A React `OverviewView` renders insight tiles, a ranked practice list, a gaps callout, and a bag summary table with trend sparklines.

**Tech Stack:** TypeScript, Fastify, better-sqlite3 (existing), Vitest, React 18, D3 scales.

**Spec:** `docs/superpowers/specs/2026-08-27-overview-tab-design.md`

## Global Constraints

- ESM modules; relative imports use `.js` extensions in server code (e.g. `from '../types.js'`).
- Server pure-logic files do NOT use `Date.now()` inside `computeOverview` — the caller passes `nowMs`, so the function stays deterministic and testable.
- Meters throughout; balanced practice weighting (0.25 each of staleness, sample, inconsistency, gap).
- Trend metric is **consistency** (per-session carry std; lower = better).
- Reuse `computeGapping` — do not re-implement clean-hit filtering.
- Do not run `npm install` (deps already present). Verify server with `npx tsc -p tsconfig.json --noEmit` and `npx vitest run` from `packages/server`; web with `npx tsc --noEmit -p tsconfig.json` and `npx vite build` from `packages/web`.

---

## File Structure

- `packages/server/src/types.ts` — add Overview types (TrendDirection, ClubTrendPoint, ClubTrend, ClubInsight, PracticePriority, BagGap, OverviewHeadline, OverviewResult).
- `packages/server/src/stats/overview.ts` — `computeOverview` + helpers (pure).
- `packages/server/src/stats/overview.test.ts` — TDD tests.
- `packages/server/src/routes/index.ts` — add `POST /api/overview`.
- `packages/web/src/lib/types.ts` — mirror Overview types.
- `packages/web/src/lib/api.ts` — `overview(filter)`.
- `packages/web/src/charts/TrendSparkline.tsx` — small consistency sparkline.
- `packages/web/src/components/{InsightTiles,PracticePriorityList,GapsCallout,BagSummaryTable}.tsx`.
- `packages/web/src/views/OverviewView.tsx` — composes the above; fetches overview.
- `packages/web/src/Dashboard.tsx` — add `overview` tab as default.
- `packages/web/src/styles.css` — Overview styles.

---

## Task 1: Overview types (server + web)

**Files:**
- Modify: `packages/server/src/types.ts` (append after `GappingResult`)
- Modify: `packages/web/src/lib/types.ts` (append after `GappingResult`)

**Interfaces:**
- Produces: the types below, imported by every later task.

- [ ] **Step 1: Add types to `packages/server/src/types.ts`**

```ts
export type TrendDirection = 'improving' | 'declining' | 'steady' | 'insufficient';

export interface ClubTrendPoint {
  date: string;   // ISO session date
  value: number;  // per-session carry std (meters); lower = tighter
  shots: number;
}

export interface ClubTrend {
  direction: TrendDirection;
  points: ClubTrendPoint[];
}

export interface ClubInsight {
  clubDisplayName: string;
  category: string | null;
  medianCarry: number | null;
  medianTotal: number | null;
  roll: number | null;          // medianTotal - medianCarry
  carrySpread: number | null;   // p75 - p25 of carry
  cv: number | null;            // carry std / median
  keptShots: number;
  lastHitDaysAgo: number | null;
  sessionsWithData: number;
  trend: ClubTrend;
}

export interface PracticePriority {
  clubDisplayName: string;
  score: number; // 0..1
  reasons: string[];
  components: { staleness: number; sample: number; inconsistency: number; gap: number };
}

export interface BagGap {
  upperClub: string;
  upperCarry: number;
  lowerClub: string;
  lowerCarry: number;
  gapMeters: number;
}

export interface OverviewHeadline {
  clubsTracked: number;
  totalCleanShots: number;
  mostConsistentClub: string | null;
  biggestGapMeters: number | null;
  clubsNeedingAttention: number;
}

export interface OverviewResult {
  clubs: ClubInsight[];
  priorities: PracticePriority[];
  gaps: BagGap[];
  headline: OverviewHeadline;
}
```

- [ ] **Step 2: Copy the same interfaces into `packages/web/src/lib/types.ts`** (identical shapes; web file already mirrors server domain types).

- [ ] **Step 3: Typecheck both**

Run: `cd packages/server && npx tsc -p tsconfig.json --noEmit` → PASS
Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json` → PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/types.ts packages/web/src/lib/types.ts
git commit -m "feat(overview): add Overview result types"
```

---

## Task 2: `computeOverview` — scoring, gaps, trends (TDD)

**Files:**
- Create: `packages/server/src/stats/overview.ts`
- Test: `packages/server/src/stats/overview.test.ts`

**Interfaces:**
- Consumes: `GappingResult`, `Club`, `Session` from `../types.js`; `computeGapping`, `DEFAULT_FILTER` from `./index.js`; `mean`, `median`, `std`, `percentile` from `./math.js`.
- Produces:
  ```ts
  export function computeOverview(
    gapping: GappingResult,
    clubs: Club[],
    sessions: Session[],
    nowMs: number,
  ): OverviewResult;
  ```

- [ ] **Step 1: Write the failing test** — `packages/server/src/stats/overview.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeGapping, DEFAULT_FILTER } from './index.js';
import { computeOverview } from './overview.js';
import type { Shot, Club, Session } from '../types.js';

let n = 0;
function shot(p: Partial<Shot>): Shot {
  n += 1;
  return {
    id: `s${n}`, sessionId: 'A', shotIndex: n, gameMode: 'WhatsInMyBag',
    clubType: null, clubDisplayName: '7-iron', clubCategory: 'Iron', isHidden: false,
    carry: 100, flatCarry: 100, total: 110, ballSpeed: null, launchAngle: null,
    landingAngle: null, curve: null, height: null, hangTime: null, offTargetLine: 0,
    spinRate: null, clubHeadSpeed: null, smashFactor: null, ...p,
  };
}
function club(p: Partial<Club>): Club {
  return { id: 'c', clubDisplayName: '7-iron', category: 'Iron', nickname: null, displayOrder: 0, avgCarry: null, avgTotal: null, ...p };
}
function session(id: string, iso: string): Session {
  return { id, gameMode: 'WhatsInMyBag', rangeName: 'R', beginTimestamp: iso, timestamp: iso, tracedShots: null, hasLaunchMonitorStats: false };
}
const NOW = Date.parse('2026-08-27T00:00:00Z');

function overviewFor(shots: Shot[], clubs: Club[], sessions: Session[]) {
  const g = computeGapping(shots, clubs, { ...DEFAULT_FILTER, cleanHit: { ...DEFAULT_FILTER.cleanHit, enabled: false } });
  return computeOverview(g, clubs, sessions, NOW);
}

describe('computeOverview — staleness', () => {
  it('flags a club not hit in a long time', () => {
    const shots = Array.from({ length: 12 }, () => shot({ sessionId: 'OLD' }));
    const sessions = [session('OLD', '2025-01-01T00:00:00Z')];
    const res = overviewFor(shots, [club({})], sessions);
    const p = res.priorities.find((x) => x.clubDisplayName === '7-iron')!;
    expect(p.components.staleness).toBeGreaterThan(0.9); // ~600 days -> capped 1
    expect(p.reasons.some((r) => /Not hit/i.test(r))).toBe(true);
  });
});

describe('computeOverview — thin sample', () => {
  it('flags a club with few shots', () => {
    const shots = Array.from({ length: 5 }, () => shot({ sessionId: 'A' }));
    const res = overviewFor(shots, [club({})], [session('A', '2026-08-25T00:00:00Z')]);
    const p = res.priorities[0];
    expect(p.components.sample).toBeGreaterThan(0.7); // 1 - 5/25 = 0.8
    expect(p.reasons.some((r) => /Only 5 shots/i.test(r))).toBe(true);
  });
});

describe('computeOverview — inconsistency ranking', () => {
  it('ranks the widest-dispersion club highest on inconsistency', () => {
    const tight = Array.from({ length: 12 }, (_, i) => shot({ clubDisplayName: 'Tight', clubCategory: 'Iron', flatCarry: 100 + (i % 2), carry: 100 }));
    const wild = Array.from({ length: 12 }, (_, i) => shot({ clubDisplayName: 'Wild', clubCategory: 'Iron', flatCarry: 80 + i * 6, carry: 100 }));
    const clubs = [club({ id: 't', clubDisplayName: 'Tight', displayOrder: 1 }), club({ id: 'w', clubDisplayName: 'Wild', displayOrder: 2 })];
    const res = overviewFor([...tight, ...wild], clubs, [session('A', '2026-08-25T00:00:00Z')]);
    const wild_i = res.priorities.find((p) => p.clubDisplayName === 'Wild')!;
    const tight_i = res.priorities.find((p) => p.clubDisplayName === 'Tight')!;
    expect(wild_i.components.inconsistency).toBeGreaterThan(tight_i.components.inconsistency);
    expect(res.headline.mostConsistentClub).toBe('Tight');
  });
});

describe('computeOverview — distance gaps', () => {
  it('flags a big gap and marks both bordering clubs', () => {
    const near = (name: string, carry: number) => Array.from({ length: 10 }, () => shot({ clubDisplayName: name, flatCarry: carry, carry }));
    const clubs = [
      club({ id: 'a', clubDisplayName: 'A', displayOrder: 1 }),
      club({ id: 'b', clubDisplayName: 'B', displayOrder: 2 }),
      club({ id: 'c', clubDisplayName: 'C', displayOrder: 3 }),
    ];
    // carries 150, 145, 100 -> big gap between B(145) and C(100)
    const shots = [...near('A', 150), ...near('B', 145), ...near('C', 100)];
    const res = overviewFor(shots, clubs, [session('A', '2026-08-25T00:00:00Z')]);
    expect(res.gaps.length).toBe(1);
    expect(res.gaps[0].upperClub).toBe('B');
    expect(res.gaps[0].lowerClub).toBe('C');
    expect(res.gaps[0].gapMeters).toBeCloseTo(45, 0);
    const b = res.priorities.find((p) => p.clubDisplayName === 'B')!;
    const c = res.priorities.find((p) => p.clubDisplayName === 'C')!;
    expect(b.components.gap).toBe(1);
    expect(c.components.gap).toBe(1);
  });
});

describe('computeOverview — trend', () => {
  it('reports improving when per-session std decreases over time', () => {
    // session S1 wide, S2 medium, S3 tight
    const s1 = Array.from({ length: 5 }, (_, i) => shot({ sessionId: 'S1', flatCarry: 80 + i * 10, carry: 100 }));
    const s2 = Array.from({ length: 5 }, (_, i) => shot({ sessionId: 'S2', flatCarry: 90 + i * 5, carry: 100 }));
    const s3 = Array.from({ length: 5 }, (_, i) => shot({ sessionId: 'S3', flatCarry: 99 + (i % 2), carry: 100 }));
    const sessions = [
      session('S1', '2026-06-01T00:00:00Z'),
      session('S2', '2026-07-01T00:00:00Z'),
      session('S3', '2026-08-01T00:00:00Z'),
    ];
    const res = overviewFor([...s1, ...s2, ...s3], [club({})], sessions);
    const insight = res.clubs.find((c) => c.clubDisplayName === '7-iron')!;
    expect(insight.trend.points.length).toBe(3);
    expect(insight.trend.direction).toBe('improving');
  });

  it('reports insufficient with fewer than 3 qualifying sessions', () => {
    const shots = Array.from({ length: 10 }, () => shot({ sessionId: 'A' }));
    const res = overviewFor(shots, [club({})], [session('A', '2026-08-25T00:00:00Z')]);
    expect(res.clubs[0].trend.direction).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && npx vitest run src/stats/overview` → FAIL ("Cannot find module './overview.js'")

- [ ] **Step 3: Implement `packages/server/src/stats/overview.ts`**

```ts
// Overview analysis — PURE. Reuses GappingResult; adds practice scoring, gaps, trends.
import type {
  GappingResult, Club, Session, FilteredShot,
  OverviewResult, ClubInsight, PracticePriority, BagGap, ClubTrendPoint, TrendDirection,
} from '../types.js';
import { mean, median, std, percentile } from './math.js';

const DAY_MS = 86_400_000;
const STALE_FULL_DAYS = 180;
const SAMPLE_RELIABLE = 25;
const GAP_FACTOR = 1.6;
const GAP_MIN_M = 12;
const MIN_TREND_SESSIONS = 3;
const MIN_SESSION_SHOTS = 3;

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function daysAgoLabel(days: number): string {
  if (days < 60) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(days < 730 ? 1 : 0)}y`;
}

// linear-regression slope of y over x
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

export function computeOverview(
  gapping: GappingResult,
  clubs: Club[],
  sessions: Session[],
  nowMs: number,
): OverviewResult {
  const sessionMs = new Map<string, number>();
  for (const s of sessions) {
    const iso = s.timestamp ?? s.beginTimestamp;
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(t)) sessionMs.set(s.id, t);
  }
  const clubMeta = new Map(clubs.map((c) => [c.clubDisplayName, c]));

  // group kept shots by club
  const keptByClub = new Map<string, FilteredShot[]>();
  for (const sh of gapping.shots) {
    if (sh.excluded || sh.clubDisplayName == null) continue;
    const arr = keptByClub.get(sh.clubDisplayName) ?? [];
    arr.push(sh);
    keptByClub.set(sh.clubDisplayName, arr);
  }

  // per-club insight (carry-based)
  const insights: ClubInsight[] = [];
  for (const gap of gapping.clubs) {
    const name = gap.clubDisplayName;
    const shots = keptByClub.get(name) ?? [];
    const carries = shots.map((s) => s.flatCarry).filter((v): v is number => v != null && !Number.isNaN(v));
    const carryStd = carries.length >= 2 ? std(carries) : null;
    const medCarry = gap.medianCarry;
    const cv = carryStd != null && medCarry ? carryStd / medCarry : null;

    // last hit
    let lastMs: number | null = null;
    for (const s of shots) { const t = sessionMs.get(s.sessionId); if (t != null && (lastMs == null || t > lastMs)) lastMs = t; }
    const lastHitDaysAgo = lastMs != null ? Math.max(0, Math.round((nowMs - lastMs) / DAY_MS)) : null;

    // trend: per-session carry std over time
    const bySession = new Map<string, number[]>();
    for (const s of shots) {
      if (s.flatCarry == null) continue;
      const arr = bySession.get(s.sessionId) ?? [];
      arr.push(s.flatCarry);
      bySession.set(s.sessionId, arr);
    }
    const points: ClubTrendPoint[] = [];
    for (const [sid, vals] of bySession) {
      const t = sessionMs.get(sid);
      if (t == null || vals.length < MIN_SESSION_SHOTS) continue;
      points.push({ date: new Date(t).toISOString(), value: std(vals) ?? 0, shots: vals.length });
    }
    points.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    let direction: TrendDirection = 'insufficient';
    if (points.length >= MIN_TREND_SESSIONS) {
      const xs = points.map((_, i) => i);
      const m = slope(xs, points.map((p) => p.value));
      const eps = 0.15; // m of std change per session
      direction = m < -eps ? 'improving' : m > eps ? 'declining' : 'steady';
    }

    insights.push({
      clubDisplayName: name,
      category: gap.category,
      medianCarry: medCarry,
      medianTotal: gap.medianTotal,
      roll: medCarry != null && gap.medianTotal != null ? gap.medianTotal - medCarry : null,
      carrySpread: gap.p25 != null && gap.p75 != null ? gap.p75 - gap.p25 : null,
      cv,
      keptShots: gap.keptShots,
      lastHitDaysAgo,
      sessionsWithData: bySession.size,
      trend: { direction, points },
    });
  }

  // sort by carry desc
  insights.sort((a, b) => (b.medianCarry ?? -Infinity) - (a.medianCarry ?? -Infinity));

  // distance gaps
  const gaps: BagGap[] = [];
  const ranked = insights.filter((i) => i.medianCarry != null);
  const diffs: number[] = [];
  for (let i = 0; i < ranked.length - 1; i++) diffs.push(ranked[i].medianCarry! - ranked[i + 1].medianCarry!);
  const typical = diffs.length ? median(diffs) ?? 0 : 0;
  const gapClubs = new Set<string>();
  for (let i = 0; i < ranked.length - 1; i++) {
    const g = ranked[i].medianCarry! - ranked[i + 1].medianCarry!;
    if (g > Math.max(GAP_FACTOR * typical, GAP_MIN_M)) {
      gaps.push({ upperClub: ranked[i].clubDisplayName, upperCarry: ranked[i].medianCarry!, lowerClub: ranked[i + 1].clubDisplayName, lowerCarry: ranked[i + 1].medianCarry!, gapMeters: g });
      gapClubs.add(ranked[i].clubDisplayName);
      gapClubs.add(ranked[i + 1].clubDisplayName);
    }
  }

  // inconsistency: min-max normalize CV across the bag (fallback to carrySpread)
  const cvs = insights.map((i) => i.cv).filter((v): v is number => v != null);
  const cvMin = cvs.length ? Math.min(...cvs) : 0;
  const cvMax = cvs.length ? Math.max(...cvs) : 1;
  const cvRange = cvMax - cvMin || 1;

  const priorities: PracticePriority[] = insights.map((i) => {
    const staleness = i.lastHitDaysAgo == null ? 0.5 : clamp01(i.lastHitDaysAgo / STALE_FULL_DAYS);
    const sample = clamp01(1 - i.keptShots / SAMPLE_RELIABLE);
    const inconsistency = i.cv != null ? clamp01((i.cv - cvMin) / cvRange) : 0.5;
    const gap = gapClubs.has(i.clubDisplayName) ? 1 : 0;
    const score = 0.25 * (staleness + sample + inconsistency + gap);
    const reasons: string[] = [];
    if (staleness > 0.33 && i.lastHitDaysAgo != null) reasons.push(`Not hit in ${daysAgoLabel(i.lastHitDaysAgo)}`);
    if (sample > 0.4) reasons.push(`Only ${i.keptShots} shots`);
    if (inconsistency >= 2 / 3) reasons.push(i.carrySpread != null ? `Inconsistent (±${Math.round(i.carrySpread / 2)} m)` : 'Inconsistent');
    if (gap === 1) {
      const bg = gaps.find((g) => g.upperClub === i.clubDisplayName || g.lowerClub === i.clubDisplayName)!;
      reasons.push(`Borders a ${Math.round(bg.gapMeters)} m gap`);
    }
    return { clubDisplayName: i.clubDisplayName, score, reasons, components: { staleness, sample, inconsistency, gap } };
  });
  priorities.sort((a, b) => b.score - a.score);

  // headline
  const withCv = insights.filter((i) => i.cv != null);
  const mostConsistent = withCv.length ? withCv.reduce((a, b) => (a.cv! <= b.cv! ? a : b)).clubDisplayName : null;
  const biggestGap = gaps.length ? Math.max(...gaps.map((g) => g.gapMeters)) : null;
  const needAttention = priorities.filter((p) => p.score >= 0.4).length;

  return {
    clubs: insights,
    priorities,
    gaps,
    headline: {
      clubsTracked: insights.length,
      totalCleanShots: gapping.shots.filter((s) => !s.excluded && s.clubDisplayName != null).length,
      mostConsistentClub: mostConsistent,
      biggestGapMeters: biggestGap,
      clubsNeedingAttention: needAttention,
    },
  };
}
```

Note: `percentile` import may be unused; drop it if the linter/tsc complains.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/stats/overview` → PASS (all cases)

- [ ] **Step 5: Run the full server suite to confirm no regressions**

Run: `cd packages/server && npx tsc -p tsconfig.json --noEmit && npx vitest run` → PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/stats/overview.ts packages/server/src/stats/overview.test.ts
git commit -m "feat(overview): add computeOverview scoring/gaps/trends with tests"
```

---

## Task 3: `POST /api/overview` endpoint

**Files:**
- Modify: `packages/server/src/routes/index.ts`

**Interfaces:**
- Consumes: `computeOverview` from `../stats/overview.js`; existing `computeGapping`, `DEFAULT_FILTER`, `getShots`, `getClubs`, `getSessions`.
- Produces: HTTP `POST /api/overview` returning `OverviewResult`.

- [ ] **Step 1: Add imports** at the top of `routes/index.ts`

```ts
import { computeOverview } from '../stats/overview.js';
import { getShots } from '../sync/index.js'; // ensure getShots/getSessions/getClubs are imported
```

(If `getShots`/`getSessions` are already imported, skip duplicates.)

- [ ] **Step 2: Add the route** next to `/api/gapping`

```ts
app.post<{ Body: FilterOptions }>('/api/overview', async (req) => {
  const filter: FilterOptions = { ...DEFAULT_FILTER, ...(req.body ?? {}) };
  const g = computeGapping(getShots(), getClubs(), filter);
  return computeOverview(g, getClubs(), getSessions(), Date.now());
});
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/server && npx tsc -p tsconfig.json --noEmit` → PASS

- [ ] **Step 4: Manual smoke test**

Run (server started separately): `curl -s -X POST http://127.0.0.1:5174/api/overview -H 'content-type: application/json' --data '{"metric":"flatCarry","cleanHit":{"enabled":true,"mode":"iqr","k":1.5,"minShots":8,"filterLateral":false,"maxOffline":30,"shortfallPct":25}}' | head -c 400`
Expected: JSON with `priorities`, `gaps`, `headline`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/index.ts
git commit -m "feat(overview): add POST /api/overview endpoint"
```

---

## Task 4: web API client + TrendSparkline

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/charts/TrendSparkline.tsx`

**Interfaces:**
- Consumes: `OverviewResult`, `FilterOptions`, `ClubTrendPoint` from `../lib/types`.
- Produces: `api.overview(filter)`, `<TrendSparkline points direction />`.

- [ ] **Step 1: Add `overview` to `lib/api.ts`**

```ts
import type { OverviewResult } from './types';
export function overview(filter: FilterOptions): Promise<OverviewResult> {
  return request<OverviewResult>('/overview', { method: 'POST', body: JSON.stringify(filter) });
}
```

(`FilterOptions` is already imported in this file; if not, add it.)

- [ ] **Step 2: Create `charts/TrendSparkline.tsx`**

```tsx
import { scaleLinear } from 'd3-scale';
import type { ClubTrendPoint, TrendDirection } from '../lib/types';

interface Props { points: ClubTrendPoint[]; direction: TrendDirection; }
const W = 90, H = 24, PAD = 3;

export default function TrendSparkline({ points, direction }: Props) {
  if (points.length < 2) return <span className="trend-none">—</span>;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value); // consistency std; lower = better
  const x = scaleLinear().domain([0, xs.length - 1]).range([PAD, W - PAD]);
  const y = scaleLinear().domain([Math.min(...ys), Math.max(...ys) || 1]).range([H - PAD, PAD]);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const cls = direction === 'improving' ? 'spark-good' : direction === 'declining' ? 'spark-bad' : 'spark-flat';
  return (
    <svg width={W} height={H} className={`trend-spark ${cls}`} aria-label={`consistency trend ${direction}`}>
      <path d={d} fill="none" strokeWidth={2} />
    </svg>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json` → PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/charts/TrendSparkline.tsx
git commit -m "feat(overview): web overview() client + TrendSparkline"
```

---

## Task 5: Overview presentational components

**Files:**
- Create: `packages/web/src/components/InsightTiles.tsx`
- Create: `packages/web/src/components/PracticePriorityList.tsx`
- Create: `packages/web/src/components/GapsCallout.tsx`
- Create: `packages/web/src/components/BagSummaryTable.tsx`

**Interfaces:**
- Consumes: `OverviewResult` and its member types; `TrendSparkline`.
- Produces: four components rendered by `OverviewView`.

- [ ] **Step 1: `InsightTiles.tsx`**

```tsx
import type { OverviewHeadline } from '../lib/types';
export default function InsightTiles({ h }: { h: OverviewHeadline }) {
  const tiles = [
    { label: 'Clubs tracked', value: String(h.clubsTracked) },
    { label: 'Clean shots', value: String(h.totalCleanShots) },
    { label: 'Most consistent', value: h.mostConsistentClub ?? '—' },
    { label: 'Biggest gap', value: h.biggestGapMeters != null ? `${Math.round(h.biggestGapMeters)} m` : '—' },
    { label: 'Need attention', value: String(h.clubsNeedingAttention) },
  ];
  return (
    <div className="insight-tiles">
      {tiles.map((t) => (
        <div key={t.label} className="insight-tile">
          <div className="tile-value">{t.value}</div>
          <div className="tile-label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `PracticePriorityList.tsx`**

```tsx
import type { PracticePriority } from '../lib/types';
function level(score: number): string { return score >= 0.6 ? 'sev-high' : score >= 0.4 ? 'sev-mid' : 'sev-low'; }
export default function PracticePriorityList({ items }: { items: PracticePriority[] }) {
  const ranked = items.filter((p) => p.reasons.length > 0);
  if (ranked.length === 0) return <p className="muted">Everything looks up to date. Nice.</p>;
  return (
    <ol className="priority-list">
      {ranked.map((p, idx) => (
        <li key={p.clubDisplayName} className={`priority-card ${level(p.score)}`}>
          <span className="priority-rank">{idx + 1}</span>
          <div className="priority-body">
            <div className="priority-club">{p.clubDisplayName}</div>
            <div className="reason-chips">
              {p.reasons.map((r) => <span key={r} className="reason-chip">{r}</span>)}
            </div>
          </div>
          <span className="priority-score">{Math.round(p.score * 100)}</span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: `GapsCallout.tsx`**

```tsx
import type { BagGap } from '../lib/types';
export default function GapsCallout({ gaps }: { gaps: BagGap[] }) {
  if (gaps.length === 0) return <p className="muted">No large distance gaps in your bag.</p>;
  return (
    <ul className="gaps-list">
      {gaps.map((g) => (
        <li key={`${g.upperClub}-${g.lowerClub}`}>
          <strong>{Math.round(g.gapMeters)} m</strong> gap between {g.upperClub}{' '}
          ({Math.round(g.upperCarry)} m) and {g.lowerClub} ({Math.round(g.lowerCarry)} m)
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: `BagSummaryTable.tsx`**

```tsx
import type { ClubInsight } from '../lib/types';
import TrendSparkline from '../charts/TrendSparkline';
const m = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} m`);
const arrow = (d: string) => (d === 'improving' ? '▲' : d === 'declining' ? '▼' : d === 'steady' ? '~' : '');
export default function BagSummaryTable({ clubs }: { clubs: ClubInsight[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Club</th><th className="num">Carry</th><th className="num">Total</th>
            <th className="num">Roll</th><th className="num">Spread</th>
            <th className="num">Shots</th><th className="num">Last hit</th><th>Consistency trend</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((c) => (
            <tr key={c.clubDisplayName}>
              <td className="strong">{c.clubDisplayName}</td>
              <td className="num">{m(c.medianCarry)}</td>
              <td className="num">{m(c.medianTotal)}</td>
              <td className="num">{c.roll == null ? '—' : `${Math.round(c.roll)} m`}</td>
              <td className="num">{c.carrySpread == null ? '—' : `±${Math.round(c.carrySpread / 2)} m`}</td>
              <td className="num">{c.keptShots}</td>
              <td className="num">{c.lastHitDaysAgo == null ? '—' : `${c.lastHitDaysAgo}d`}</td>
              <td>
                <span className={`trend-arrow trend-${c.trend.direction}`}>{arrow(c.trend.direction)}</span>{' '}
                <TrendSparkline points={c.trend.points} direction={c.trend.direction} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json` → PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/
git commit -m "feat(overview): insight tiles, priority list, gaps, bag table"
```

---

## Task 6: OverviewView + wire into Dashboard as default tab

**Files:**
- Create: `packages/web/src/views/OverviewView.tsx`
- Modify: `packages/web/src/Dashboard.tsx`
- Modify: `packages/web/src/styles.css`

**Interfaces:**
- Consumes: `api.overview`, the four components, `FilterOptions`.
- Produces: `<OverviewView filter onSessionExpired />`; `Tab` type gains `'overview'`.

- [ ] **Step 1: Create `views/OverviewView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { FilterOptions, OverviewResult } from '../lib/types';
import InsightTiles from '../components/InsightTiles';
import PracticePriorityList from '../components/PracticePriorityList';
import GapsCallout from '../components/GapsCallout';
import BagSummaryTable from '../components/BagSummaryTable';
import Spinner from '../components/Spinner';

interface Props { filter: FilterOptions; onSessionExpired: (err: unknown) => boolean; }

export default function OverviewView({ filter, onSessionExpired }: Props) {
  const [data, setData] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.overview(filter)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((err) => { if (!onSessionExpired(err)) { /* leave stale */ } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter, onSessionExpired]);

  if (!data) return loading ? <Spinner small label="Analysing…" /> : <p className="muted">No data yet — click Sync.</p>;

  return (
    <div className="overview-view">
      <InsightTiles h={data.headline} />
      <div className="card">
        <div className="card-header"><h2>Bring to the range next</h2>
          <span className="card-sub">Ranked by staleness, sample size, consistency, and bag gaps</span></div>
        <div className="card-pad"><PracticePriorityList items={data.priorities} /></div>
      </div>
      <div className="card">
        <div className="card-header"><h2>Distance gaps</h2></div>
        <div className="card-pad"><GapsCallout gaps={data.gaps} /></div>
      </div>
      <div className="card">
        <div className="card-header"><h2>Your bag</h2>
          <span className="card-sub">Consistency trend = per-session carry spread over time (▲ tighter)</span></div>
        <BagSummaryTable clubs={data.clubs} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `Dashboard.tsx`** — extend the tab type, default, nav, and render.

Change the tab type:
```ts
type Tab = 'overview' | 'gapping' | 'dispersion' | 'sessions';
```
Change the default:
```ts
const [tab, setTab] = useState<Tab>('overview');
```
Add the import:
```ts
import OverviewView from './views/OverviewView';
```
Add the first nav button (before the Gapping tab button):
```tsx
<button className={tab === 'overview' ? 'tab active' : 'tab'} onClick={() => setTab('overview')}>
  Overview
</button>
```
Add the render branch (in the tab content area, first):
```tsx
{tab === 'overview' ? (
  <OverviewView filter={filter} onSessionExpired={onSessionExpired} />
) : null}
```

- [ ] **Step 3: Add styles to `styles.css`**

```css
/* ---------- overview ---------- */
.overview-view { display: flex; flex-direction: column; gap: 4px; }
.insight-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 18px; }
.insight-tile { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px 16px; }
.tile-value { font-size: 22px; font-weight: 700; }
.tile-label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.card-pad { padding: 14px 18px; }

.priority-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.priority-card { display: flex; align-items: center; gap: 12px; border: 1px solid var(--border); border-left-width: 4px; border-radius: 10px; padding: 10px 14px; }
.priority-card.sev-high { border-left-color: #e05d5d; }
.priority-card.sev-mid { border-left-color: #e0a63a; }
.priority-card.sev-low { border-left-color: #9aa6b2; }
.priority-rank { font-weight: 700; color: var(--text-muted); width: 20px; text-align: center; }
.priority-body { flex: 1; min-width: 0; }
.priority-club { font-weight: 700; margin-bottom: 4px; }
.reason-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.reason-chip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 20px; padding: 2px 9px; font-size: 12px; color: var(--text-muted); }
.priority-score { font-weight: 700; font-size: 15px; color: var(--text-muted); }

.gaps-list { margin: 0; padding-left: 18px; line-height: 1.7; }
.trend-spark path { stroke: #9aa6b2; }
.trend-spark.spark-good path { stroke: #35b46a; }
.trend-spark.spark-bad path { stroke: #e05d5d; }
.trend-spark.spark-flat path { stroke: #9aa6b2; }
.trend-none { color: var(--text-muted); }
.trend-arrow.trend-improving { color: #2e9e5e; }
.trend-arrow.trend-declining { color: #d24b4b; }
.trend-arrow.trend-steady { color: var(--text-muted); }
```

- [ ] **Step 4: Typecheck + build**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json && npx vite build` → PASS

- [ ] **Step 5: Live visual check**

Start server + web; load `http://localhost:5173`; confirm the Overview tab is default and shows tiles, a ranked practice list with reason chips, the gaps callout, and the bag table with trend sparklines. Capture a screenshot; check for console errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/views/OverviewView.tsx packages/web/src/Dashboard.tsx packages/web/src/styles.css
git commit -m "feat(overview): Overview tab as default landing view"
```

---

## Self-Review notes

- **Spec coverage:** scoring (Task 2) · gaps (Task 2) · trends/consistency (Task 2) · endpoint (Task 3) · tiles/priority/gaps/table/sparkline (Tasks 4–5) · Overview default tab (Task 6). All spec sections covered.
- **Type consistency:** `computeOverview(gapping, clubs, sessions, nowMs)` used identically in Task 2 (def) and Task 3 (call). `OverviewResult`/`ClubInsight`/`PracticePriority`/`BagGap`/`OverviewHeadline` defined in Task 1, consumed unchanged in Tasks 2–6. `api.overview(filter)` defined Task 4, used Task 6.
- **Filter reuse:** `/api/overview` merges body onto `DEFAULT_FILTER` exactly like `/api/gapping`.
