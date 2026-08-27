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
