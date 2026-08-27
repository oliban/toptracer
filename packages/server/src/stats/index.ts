// STATS / clean-hit-filter / gapping module — PURE, deterministic, no I/O.
// Given raw shots + clubs + filter options, produces per-club gapping aggregates
// and a per-shot excluded/kept breakdown (for scatter plots).

import type {
  Shot,
  Club,
  FilterOptions,
  DistanceMetric,
  ClubGap,
  FilteredShot,
  GappingResult,
} from '../types.js';
import { mean, median, percentile, std, quartiles } from './math.js';

export const DEFAULT_FILTER: FilterOptions = {
  metric: 'flatCarry',
  clubs: undefined,
  sessionIds: undefined,
  dateFrom: undefined,
  dateTo: undefined,
  cleanHit: {
    enabled: true,
    mode: 'iqr',
    k: 1.5,
    minShots: 8,
    filterLateral: false,
    maxOffline: 30,
    shortfallPct: 25,
  },
};

const UNKNOWN_CLUB = '(unknown)';

type ExcludeReason = FilteredShot['excludeReason'];

interface WorkingShot {
  shot: Shot;
  distance: number | null; // metric value (null when noData)
  excluded: boolean;
  reason: ExcludeReason;
}

function groupKey(shot: Shot): string {
  const name = shot.clubDisplayName;
  if (name === null || name === undefined || name === '') return UNKNOWN_CLUB;
  return name;
}

function metricValue(shot: Shot, metric: DistanceMetric): number | null {
  const v = metric === 'total' ? shot.total : shot.flatCarry;
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return v;
}

export function computeGapping(
  shots: Shot[],
  clubs: Club[],
  opts: FilterOptions,
): GappingResult {
  // ---- 1. Pre-filter by clubs + sessionIds membership. ----
  // NOTE: dateFrom/dateTo are accepted in FilterOptions but intentionally IGNORED
  // here — a Shot carries no timestamp of its own; the caller pre-filters by session.
  const clubAllow = opts.clubs && opts.clubs.length > 0 ? new Set(opts.clubs) : null;
  const sessionAllow =
    opts.sessionIds && opts.sessionIds.length > 0 ? new Set(opts.sessionIds) : null;

  const preFiltered = shots.filter((s) => {
    // Drop unattributed shots (no club) — e.g. Launch Monitor sessions record no club per
    // shot, so they cannot be gapped. They would otherwise form a meaningless '(unknown)' group.
    if (s.clubDisplayName === null || s.clubDisplayName === undefined || s.clubDisplayName === '')
      return false;
    if (clubAllow && !clubAllow.has(s.clubDisplayName)) return false;
    if (sessionAllow && !sessionAllow.has(s.sessionId)) return false;
    return true;
  });

  // ---- 2. Group by clubDisplayName (null/empty -> '(unknown)'). ----
  const groups = new Map<string, WorkingShot[]>();
  for (const shot of preFiltered) {
    const key = groupKey(shot);
    const distance = metricValue(shot, opts.metric);

    // ---- 3 & 4. Metric value + hidden/noData exclusion (priority order). ----
    let excluded = false;
    let reason: ExcludeReason = null;
    if (shot.isHidden) {
      excluded = true;
      reason = 'hidden';
    } else if (distance === null) {
      excluded = true;
      reason = 'noData';
    }

    const ws: WorkingShot = { shot, distance, excluded, reason };
    const arr = groups.get(key);
    if (arr) arr.push(ws);
    else groups.set(key, [ws]);
  }

  const clubByName = new Map<string, Club>();
  for (const c of clubs) clubByName.set(c.clubDisplayName, c);

  const clubGaps: Array<{ gap: ClubGap; club: Club | undefined }> = [];
  const outShots: FilteredShot[] = [];

  for (const [key, members] of groups) {
    // ---- 5. Clean-hit trimming per club. ----
    let trimmed = false;
    if (opts.cleanHit.enabled && opts.cleanHit.mode === 'manual') {
      // MANUAL mode: you define bad hits with absolute thresholds.
      //  - SPREAD: |offTargetLine| beyond maxOffline meters  -> tooWide
      //  - LENGTH: distance shortfallPct% (or more) SHORT of the club's typical (median)
      //            distance -> tooShort (long shots are never bad hits)
      const survivors = members.filter((m) => !m.excluded && m.distance !== null);
      if (survivors.length > 0) {
        trimmed = true;
        const clubMedian = median(survivors.map((m) => m.distance!) as number[]) ?? 0;
        for (const m of survivors) {
          const off = m.shot.offTargetLine;
          if (off !== null && off !== undefined && Math.abs(off) > opts.cleanHit.maxOffline) {
            m.excluded = true;
            m.reason = 'tooWide';
            continue;
          }
          if (m.distance! < clubMedian * (1 - opts.cleanHit.shortfallPct / 100)) {
            m.excluded = true;
            m.reason = 'tooShort';
          }
        }
      }
    } else if (opts.cleanHit.enabled) {
      // Shots still kept (not hidden/noData) with a metric value.
      const survivors = members.filter((m) => !m.excluded && m.distance !== null);
      if (survivors.length >= opts.cleanHit.minShots) {
        trimmed = true;
        const values = survivors.map((m) => m.distance!) as number[];
        const q = quartiles(values)!;
        const lo = q.q1 - opts.cleanHit.k * q.iqr;
        const hi = q.q3 + opts.cleanHit.k * q.iqr;
        for (const m of survivors) {
          const v = m.distance!;
          if (v < lo || v > hi) {
            m.excluded = true;
            m.reason = 'distanceOutlier';
          }
        }

        // Optional lateral IQR trim on offTargetLine.
        if (opts.cleanHit.filterLateral) {
          const lateralSurvivors = members.filter(
            (m) => !m.excluded && m.shot.offTargetLine !== null && m.shot.offTargetLine !== undefined,
          );
          if (lateralSurvivors.length >= opts.cleanHit.minShots) {
            const lat = lateralSurvivors.map((m) => m.shot.offTargetLine!) as number[];
            const lq = quartiles(lat)!;
            const llo = lq.q1 - opts.cleanHit.k * lq.iqr;
            const lhi = lq.q3 + opts.cleanHit.k * lq.iqr;
            for (const m of lateralSurvivors) {
              const v = m.shot.offTargetLine!;
              if (v < llo || v > lhi) {
                m.excluded = true;
                m.reason = 'lateralOutlier';
              }
            }
          }
        }
      }
    }

    // ---- 6. FilteredShot[] for every shot in the group. ----
    for (const m of members) {
      outShots.push({
        ...m.shot,
        distance: m.distance,
        excluded: m.excluded,
        excludeReason: m.reason,
      });
    }

    // ---- 7. ClubGap over kept shots. ----
    const kept = members.filter((m) => !m.excluded);
    const keptValues = kept
      .map((m) => m.distance)
      .filter((v): v is number => v !== null);
    const lateralValues = kept
      .map((m) => m.shot.offTargetLine)
      .filter((v): v is number => v !== null && v !== undefined);
    const carryValues = kept
      .map((m) => m.shot.flatCarry)
      .filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
    const totalValues = kept
      .map((m) => m.shot.total)
      .filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));

    const club = clubByName.get(key);
    const category =
      club?.category ?? kept.find((m) => m.shot.clubCategory)?.shot.clubCategory ?? null;

    const gap: ClubGap = {
      clubDisplayName: key,
      category,
      metric: opts.metric,
      totalShots: members.length,
      keptShots: kept.length,
      excludedShots: members.length - kept.length,
      trimmed,
      mean: keptValues.length ? mean(keptValues) : null,
      median: keptValues.length ? median(keptValues) : null,
      p25: keptValues.length ? percentile(keptValues, 0.25) : null,
      p75: keptValues.length ? percentile(keptValues, 0.75) : null,
      std: keptValues.length ? std(keptValues) : null,
      lateralBias: lateralValues.length ? mean(lateralValues) : null,
      dispersionWidth:
        lateralValues.length
          ? percentile(lateralValues, 0.75)! - percentile(lateralValues, 0.25)!
          : null,
      medianCarry: carryValues.length ? median(carryValues) : null,
      medianTotal: totalValues.length ? median(totalValues) : null,
    };

    clubGaps.push({ gap, club });
  }

  // ---- 8. Sort: by Club.displayOrder when available, else by mean carry desc. ----
  clubGaps.sort((a, b) => {
    const ao = a.club?.displayOrder;
    const bo = b.club?.displayOrder;
    if (ao !== undefined && bo !== undefined) return ao - bo;
    if (ao !== undefined) return -1; // clubs with a known order come first
    if (bo !== undefined) return 1;
    // Both unknown order: mean carry desc (nulls last).
    const am = a.gap.mean;
    const bm = b.gap.mean;
    if (am === null && bm === null) return 0;
    if (am === null) return 1;
    if (bm === null) return -1;
    return bm - am;
  });

  return {
    clubs: clubGaps.map((c) => c.gap),
    shots: outShots,
    appliedFilter: opts,
  };
}
