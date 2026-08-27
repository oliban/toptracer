# Overview Tab — Design Spec

Date: 2026-08-27
Status: Approved design, ready for implementation plan
Related: `2026-08-26-toptracer-range-analyzer-design.md`

## Goal

A new **Overview** tab (the app's default landing view) that analyses the user's current
situation: how each club performs, how consistent/fresh the data is, gaps in the bag, and a
ranked **"bring to the range next"** practice list. Reuses existing per-club gapping stats and
the clean-hit filter; adds scoring, distance-gap detection, and per-club trends over time.

## Placement & data flow

- Tabs become: **Overview** (default) · Gapping · Dispersion · Sessions.
- Respects the shared Filters panel (metric, clean-hit) so analysis matches the other tabs.
- Backend endpoint `POST /api/overview` (body = `FilterOptions`):
  1. `g = computeGapping(getShots(), getClubs(), filter)` — reuse clean-hit + per-club stats.
  2. `computeOverview(g, getClubs(), getSessions())` → `OverviewResult`.
- Frontend `OverviewView` fetches its own overview on mount + when the filter changes.

## Practice-need scoring (balanced weighting)

Per club, four signals normalized to 0..1 (higher = more need), weighted **equally (0.25 each)**:

- **Staleness** `= min(daysSinceLastHit / 180, 1)`; unknown date → 0.5.
- **Thin sample** `= clamp(1 − keptShots / 25, 0, 1)` (≥25 clean shots ⇒ reliable).
- **Inconsistency** = combine carry CV (`std/median`) and lateral dispersion width, min–max
  normalized **across the current bag** so the worst club ≈ 1, the tightest ≈ 0.
- **Gap-adjacency** = 1 if the club borders a flagged distance gap, else 0.

`score = 0.25 * (staleness + sample + inconsistency + gap)`, ranked descending.

**Reason chips** emitted when a component crosses a threshold:
- staleness > 0.33 → "Not hit in {label}" (e.g. "1.2y", "51d")
- sample > 0.4 → "Only {n} shots"
- inconsistency in top third of the bag → "Inconsistent (±{spread} m)"
- gap-adjacent → "Borders a {gap} m gap"

Top ~3–5 clubs surface as highlighted cards; the rest listed compactly.

## Distance-gap detection

Sort clubs by `medianCarry` desc; `gaps` = consecutive differences. `typicalGap = median(gaps)`.
Flag a gap where `gap > max(1.6 * typicalGap, 12 m)`. Each `BagGap` = `{ upperClub, upperCarry,
lowerClub, lowerCarry, gapMeters }`; both bordering clubs get gap-adjacency = 1.

## Trends over time (consistency)

For each club: group its **kept** shots by `sessionId`; for sessions with ≥ 3 of that club's
shots, compute that session's carry **std** (lower = tighter = better). Order points by session
date → `trend.points[] = { date, value, shots }`. Direction from the linear slope of `value`
over time:
- slope < −ε → **improving** (tightening), slope > +ε → **declining**, else **steady**.
- < 3 points → **insufficient** ("not enough history").

The summary table shows a small consistency sparkline + direction arrow per club.

## Types (add to `types.ts`, mirror in web `lib/types.ts`)

```ts
type TrendDirection = 'improving' | 'declining' | 'steady' | 'insufficient';
interface ClubTrendPoint { date: string; value: number; shots: number; }
interface ClubTrend { direction: TrendDirection; points: ClubTrendPoint[]; }

interface ClubInsight {
  clubDisplayName: string; category: string | null;
  medianCarry: number | null; medianTotal: number | null; roll: number | null;
  carrySpread: number | null;  // p75 − p25 of carry
  cv: number | null;           // carry std / median
  keptShots: number; lastHitDaysAgo: number | null; sessionsWithData: number;
  trend: ClubTrend;
}
interface PracticePriority {
  clubDisplayName: string; score: number; reasons: string[];
  components: { staleness: number; sample: number; inconsistency: number; gap: number };
}
interface BagGap { upperClub: string; upperCarry: number; lowerClub: string; lowerCarry: number; gapMeters: number; }
interface OverviewHeadline {
  clubsTracked: number; totalCleanShots: number;
  mostConsistentClub: string | null; biggestGapMeters: number | null; clubsNeedingAttention: number;
}
interface OverviewResult {
  clubs: ClubInsight[];          // sorted by carry desc
  priorities: PracticePriority[]; // ranked by score desc
  gaps: BagGap[];
  headline: OverviewHeadline;
}
```

`computeOverview` needs session dates → it maps `sessionId → timestamp` from the passed
`Session[]`. It reads per-shot data from `GappingResult.shots` (kept flag, carry, total,
offTargetLine, sessionId) and per-club aggregates from `GappingResult.clubs`.

## UI (`views/OverviewView.tsx`)

1. **Insight tiles** (`InsightTiles`): clubs tracked · clean shots · most consistent club ·
   biggest gap · clubs needing attention.
2. **Bring to the range next** (`PracticePriorityList`): ranked cards — club, severity, reason
   chips, freshness dot, mini consistency sparkline. Top few emphasized.
3. **Distance gaps** (`GapsCallout`): the flagged gaps in plain language.
4. **Bag summary** (`BagSummaryTable`): all clubs by carry — carry, total, roll, consistency
   (±m / CV), shots, last hit, trend arrow + `TrendSparkline`.

Empty state when unsynced. Meters throughout.

## Files

Backend: `stats/overview.ts` (+ `overview.test.ts`), `types.ts`, `routes/index.ts`.
Frontend: `views/OverviewView.tsx`, `components/{InsightTiles,PracticePriorityList,GapsCallout,BagSummaryTable}.tsx`,
`charts/TrendSparkline.tsx`, `lib/api.ts` (`overview()`), `lib/types.ts`, `Dashboard.tsx`
(add `overview` tab, default), `styles.css`.

## Testing (TDD on `computeOverview`)

- staleness reason fires for an old last-hit; not for a recent one.
- thin-sample reason fires under 25 shots.
- inconsistency ranks the widest-dispersion club highest.
- gap detection flags a big gap and marks both bordering clubs gap-adjacent.
- trend: a club whose per-session std decreases over time → `improving`; < 3 sessions →
  `insufficient`.
- headline aggregates (mostConsistentClub, biggestGapMeters, clubsNeedingAttention).

## Out of scope (v1)

Configurable weights UI; recommending *which distance* a gap needs; cross-club correlations.
