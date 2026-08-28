// Shared domain types — the contract every server module builds against.

export interface Club {
  id: string;
  clubDisplayName: string;   // e.g. "7-wood", "Driver"
  category: string;          // e.g. "Wood", "Iron", "Wedge"
  nickname: string | null;
  displayOrder: number;
  avgCarry: number | null;   // meters, from API
  avgTotal: number | null;   // meters
}

export interface Shot {
  id: string;
  sessionId: string;
  shotIndex: number;
  gameMode: string;
  clubType: string | null;
  clubDisplayName: string | null;
  clubCategory: string | null;
  isHidden: boolean;         // user hid this shot in the app
  // GameShotStatsDto (meters / m/s / degrees / seconds), any may be null
  carry: number | null;
  flatCarry: number | null;
  total: number | null;
  ballSpeed: number | null;
  launchAngle: number | null;
  landingAngle: number | null;
  curve: number | null;
  height: number | null;
  hangTime: number | null;
  offTargetLine: number | null;  // + right, - left
  // LaunchMonitorStats (only when session.hasLaunchMonitorStats)
  spinRate: number | null;
  clubHeadSpeed: number | null;
  smashFactor: number | null;
}

export interface Session {
  id: string;
  gameMode: string;
  rangeName: string | null;
  beginTimestamp: string | null; // ISO
  timestamp: string | null;      // ISO
  tracedShots: number | null;
  hasLaunchMonitorStats: boolean;
}

export interface UserProfile {
  id: string;
  email: string | null;
  profileName: string | null;
  distanceUnit: string | null;   // e.g. "Meters"
  speedUnit: string | null;
}

// ---- Filtering & gapping (stats module) ----

// 'consistency' is not a per-shot distance; it reshapes the gapping view to rank clubs by
// overall tightness. The distance pipeline (filtering, dispersion axis) treats it as flatCarry.
export type DistanceMetric = 'flatCarry' | 'total' | 'consistency';

export interface FilterOptions {
  metric: DistanceMetric;
  clubs?: string[];              // clubDisplayName allow-list; undefined = all
  sessionIds?: string[];         // undefined = all
  dateFrom?: string;             // ISO inclusive
  dateTo?: string;               // ISO inclusive
  cleanHit: {
    enabled: boolean;
    mode: 'iqr' | 'manual';      // 'iqr' = statistical outlier trim; 'manual' = your own thresholds
    // --- statistical (iqr) mode ---
    k: number;                   // IQR multiplier, default 1.5
    minShots: number;            // clubs below this are shown but not trimmed
    filterLateral: boolean;      // also IQR-trim on offTargetLine
    // --- manual mode (you define what a bad hit is) ---
    maxOffline: number;          // SPREAD: |offTargetLine| beyond this many meters = bad hit
    shortfallPct: number;        // LENGTH: distance this % (or more) SHORT of the club's
                                 //         typical (median) distance = bad hit. e.g. 20 means
                                 //         anything under 80% of the median. Long shots kept.
  };
}

export interface ClubGap {
  clubDisplayName: string;
  category: string | null;
  metric: DistanceMetric;
  totalShots: number;
  keptShots: number;
  excludedShots: number;
  trimmed: boolean;              // false when below minShots
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  std: number | null;
  lateralBias: number | null;    // mean offTargetLine of kept shots
  dispersionWidth: number | null;// p75-p25 of offTargetLine
  medianCarry: number | null;    // median flatCarry of kept shots (for roll visualization)
  medianTotal: number | null;    // median total distance of kept shots
  carryStd: number | null;       // std of kept flatCarry (± m) — distance consistency
  offlineStd: number | null;     // std of kept offTargetLine (± m) — direction consistency
  consistencyScore: number | null; // 0..100 overall tightness (higher = more consistent)
}

export interface FilteredShot extends Shot {
  distance: number | null;       // the chosen metric value
  excluded: boolean;
  excludeReason:
    | 'hidden'
    | 'distanceOutlier'   // iqr mode: distance is a statistical outlier
    | 'lateralOutlier'    // iqr mode: offline is a statistical outlier
    | 'tooWide'           // manual mode: |offline| exceeds your spread limit
    | 'tooShort'          // manual mode: distance falls short of the club's typical length
    | 'noData'
    | null;
}

export interface GappingResult {
  clubs: ClubGap[];
  shots: FilteredShot[];         // all shots with excluded flag (for scatter)
  appliedFilter: FilterOptions;
}

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
