// Overview analysis — PURE. Reuses GappingResult; adds practice scoring, gaps, trends.
import type {
  GappingResult, Club, Session, FilteredShot,
  OverviewResult, ClubInsight, PracticePriority, BagGap, ClubTrendPoint, TrendDirection,
} from '../types.js';
import { mean, median, std } from './math.js';

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
  return `${(days / 365).toFixed(days < 730 ? 1 : 0).replace(/\.0$/, '')}y`;
}

// linear-regression slope of y over x
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = mean(xs)!, my = mean(ys)!;
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
      const t0 = Date.parse(points[0].date);
      const xs = points.map((p) => (Date.parse(p.date) - t0) / (30 * DAY_MS));
      const m = slope(xs, points.map((p) => p.value));
      const eps = 0.15; // m of std change per month
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

  // inconsistency: mean of min-max normalized CV and min-max normalized lateral dispersion
  // (spec requires combining carry variability with lateral dispersion, not carry alone)
  const dispersionByClub = new Map<string, number | null>();
  for (const gap of gapping.clubs) dispersionByClub.set(gap.clubDisplayName, gap.dispersionWidth);

  const cvs = insights.map((i) => i.cv).filter((v): v is number => v != null);
  const cvMin = cvs.length ? Math.min(...cvs) : 0;
  const cvMax = cvs.length ? Math.max(...cvs) : 1;
  const cvRange = cvMax - cvMin || 1;

  const dispVals = insights
    .map((i) => dispersionByClub.get(i.clubDisplayName) ?? null)
    .filter((v): v is number => v != null);
  const dispMin = dispVals.length ? Math.min(...dispVals) : 0;
  const dispMax = dispVals.length ? Math.max(...dispVals) : 1;
  const dispRange = dispMax - dispMin || 1;

  const inconsistencyByClub = new Map<string, number>();
  for (const i of insights) {
    const cvN = i.cv != null ? clamp01((i.cv - cvMin) / cvRange) : null;
    const dw = dispersionByClub.get(i.clubDisplayName) ?? null;
    const dispN = dw != null ? clamp01((dw - dispMin) / dispRange) : null;
    const parts = [cvN, dispN].filter((v): v is number => v != null);
    inconsistencyByClub.set(i.clubDisplayName, parts.length ? mean(parts)! : 0);
  }

  // rank-based: top third of the bag (by inconsistency) get the "Inconsistent" reason chip
  const n = insights.length;
  const topThirdCount = Math.ceil(n / 3);
  const rankedByInconsistency = [...insights].sort(
    (a, b) => inconsistencyByClub.get(b.clubDisplayName)! - inconsistencyByClub.get(a.clubDisplayName)!,
  );
  const inconsistentSet = new Set(rankedByInconsistency.slice(0, topThirdCount).map((i) => i.clubDisplayName));

  const priorities: PracticePriority[] = insights.map((i) => {
    const staleness = i.lastHitDaysAgo == null ? 0.5 : clamp01(i.lastHitDaysAgo / STALE_FULL_DAYS);
    const sample = clamp01(1 - i.keptShots / SAMPLE_RELIABLE);
    const inconsistency = inconsistencyByClub.get(i.clubDisplayName)!;
    const gap = gapClubs.has(i.clubDisplayName) ? 1 : 0;
    const score = 0.25 * (staleness + sample + inconsistency + gap);
    const reasons: string[] = [];
    if (staleness > 0.33 && i.lastHitDaysAgo != null) reasons.push(`Not hit in ${daysAgoLabel(i.lastHitDaysAgo)}`);
    if (sample > 0.4) reasons.push(`Only ${i.keptShots} shots`);
    if (inconsistentSet.has(i.clubDisplayName)) reasons.push(i.carrySpread != null ? `Inconsistent (±${Math.round(i.carrySpread / 2)} m)` : 'Inconsistent');
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
