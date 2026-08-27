import { describe, it, expect } from 'vitest';
import { computeGapping, DEFAULT_FILTER } from './index.js';
import type { Shot, Club, FilterOptions } from '../types.js';

let idCounter = 0;
function shot(partial: Partial<Shot>): Shot {
  idCounter += 1;
  return {
    id: `s${idCounter}`,
    sessionId: 'sess1',
    shotIndex: idCounter,
    gameMode: 'range',
    clubType: null,
    clubDisplayName: '7-iron',
    clubCategory: 'Iron',
    isHidden: false,
    carry: null,
    flatCarry: 100,
    total: null,
    ballSpeed: null,
    launchAngle: null,
    landingAngle: null,
    curve: null,
    height: null,
    hangTime: null,
    offTargetLine: null,
    spinRate: null,
    clubHeadSpeed: null,
    smashFactor: null,
    ...partial,
  };
}

function club(partial: Partial<Club>): Club {
  return {
    id: 'c1',
    clubDisplayName: '7-iron',
    category: 'Iron',
    nickname: null,
    displayOrder: 0,
    avgCarry: null,
    avgTotal: null,
    ...partial,
  };
}

function filter(
  partial: Partial<Omit<FilterOptions, 'cleanHit'>> & {
    cleanHit?: Partial<FilterOptions['cleanHit']>;
  } = {},
): FilterOptions {
  return {
    ...DEFAULT_FILTER,
    ...partial,
    cleanHit: { ...DEFAULT_FILTER.cleanHit, ...(partial.cleanHit ?? {}) },
  };
}

describe('DEFAULT_FILTER', () => {
  it('matches the spec', () => {
    expect(DEFAULT_FILTER).toEqual({
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
    });
  });
});

describe('computeGapping — empty input', () => {
  it('returns empty clubs and shots', () => {
    const opts = filter();
    const res = computeGapping([], [], opts);
    expect(res.clubs).toEqual([]);
    expect(res.shots).toEqual([]);
    expect(res.appliedFilter).toBe(opts);
  });
});

describe('computeGapping — distance outlier trimming', () => {
  const carries = [100, 101, 99, 102, 98, 100, 101, 5];
  const shots = carries.map((c) => shot({ flatCarry: c }));

  it('excludes the obvious low outlier as distanceOutlier and trims=true', () => {
    const res = computeGapping(shots, [], filter());
    expect(res.clubs).toHaveLength(1);
    const g = res.clubs[0];
    expect(g.trimmed).toBe(true);
    expect(g.totalShots).toBe(8);
    expect(g.keptShots).toBe(7);
    expect(g.excludedShots).toBe(1);

    // the '5' shot is excluded with reason distanceOutlier
    const five = res.shots.find((s) => s.flatCarry === 5)!;
    expect(five.excluded).toBe(true);
    expect(five.excludeReason).toBe('distanceOutlier');

    // aggregates over the remaining 7 [100,101,99,102,98,100,101]
    expect(g.mean).toBeCloseTo(100.142857, 5);
    expect(g.median).toBe(100);
    expect(g.p25).toBe(99.5);
    expect(g.p75).toBe(101);
    expect(g.std).toBeCloseTo(1.34518, 4);
  });
});

describe('computeGapping — below minShots is not trimmed', () => {
  it('keeps everything and trimmed=false even with an outlier present', () => {
    const shots = [100, 101, 99, 102, 5].map((c) => shot({ flatCarry: c }));
    const res = computeGapping(shots, [], filter());
    const g = res.clubs[0];
    expect(g.trimmed).toBe(false);
    expect(g.keptShots).toBe(5);
    expect(g.excludedShots).toBe(0);
    expect(res.shots.every((s) => !s.excluded)).toBe(true);
    // mean includes the 5: (100+101+99+102+5)/5 = 81.4
    expect(g.mean).toBeCloseTo(81.4, 10);
  });
});

describe('computeGapping — hidden shots always excluded', () => {
  it('marks hidden shots with reason hidden and drops from kept', () => {
    const shots = [
      shot({ flatCarry: 100 }),
      shot({ flatCarry: 101, isHidden: true }),
      shot({ flatCarry: 99 }),
    ];
    const res = computeGapping(shots, [], filter({ cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    const hidden = res.shots.find((s) => s.isHidden)!;
    expect(hidden.excluded).toBe(true);
    expect(hidden.excludeReason).toBe('hidden');
    const g = res.clubs[0];
    expect(g.keptShots).toBe(2);
    expect(g.mean).toBeCloseTo(99.5, 10); // (100+99)/2
  });
});

describe('computeGapping — null metric excluded as noData', () => {
  it('excludes shots whose chosen metric is null', () => {
    const shots = [
      shot({ flatCarry: 100 }),
      shot({ flatCarry: null }),
    ];
    const res = computeGapping(shots, [], filter({ cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    const noData = res.shots.find((s) => s.flatCarry === null)!;
    expect(noData.excluded).toBe(true);
    expect(noData.excludeReason).toBe('noData');
    expect(noData.distance).toBeNull();
    expect(res.clubs[0].keptShots).toBe(1);
  });
});

describe('computeGapping — metric toggle flatCarry vs total', () => {
  it('uses flatCarry or total per opts.metric', () => {
    const shots = [shot({ flatCarry: 100, total: 150 })];
    const flatRes = computeGapping(shots, [], filter({ metric: 'flatCarry', cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    expect(flatRes.shots[0].distance).toBe(100);
    expect(flatRes.clubs[0].mean).toBe(100);

    const totalRes = computeGapping(shots, [], filter({ metric: 'total', cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    expect(totalRes.shots[0].distance).toBe(150);
    expect(totalRes.clubs[0].mean).toBe(150);
  });
});

describe('computeGapping — filterLateral', () => {
  it('excludes a wild offTargetLine as lateralOutlier', () => {
    const lats = [1, 2, -1, 0, 1, -2, 1, 50];
    const shots = lats.map((l) => shot({ flatCarry: 100, offTargetLine: l }));
    const res = computeGapping(
      shots,
      [],
      filter({ cleanHit: { enabled: true, k: 1.5, minShots: 8, filterLateral: true } }),
    );
    const wild = res.shots.find((s) => s.offTargetLine === 50)!;
    expect(wild.excluded).toBe(true);
    expect(wild.excludeReason).toBe('lateralOutlier');
    const g = res.clubs[0];
    expect(g.keptShots).toBe(7);
    // lateralBias = mean of remaining offTargetLine [1,2,-1,0,1,-2,1] = 2/7
    expect(g.lateralBias).toBeCloseTo(2 / 7, 10);
  });
});

describe('computeGapping — club + session membership filtering', () => {
  const shots = [
    shot({ clubDisplayName: '7-iron', sessionId: 'A', flatCarry: 100 }),
    shot({ clubDisplayName: 'Driver', sessionId: 'A', flatCarry: 220 }),
    shot({ clubDisplayName: '7-iron', sessionId: 'B', flatCarry: 105 }),
  ];

  it('filters by club allow-list', () => {
    const res = computeGapping(shots, [], filter({ clubs: ['7-iron'], cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    expect(res.clubs).toHaveLength(1);
    expect(res.clubs[0].clubDisplayName).toBe('7-iron');
    expect(res.shots).toHaveLength(2);
  });

  it('filters by sessionId allow-list', () => {
    const res = computeGapping(shots, [], filter({ sessionIds: ['A'], cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    expect(res.shots).toHaveLength(2);
    const names = res.clubs.map((c) => c.clubDisplayName).sort();
    expect(names).toEqual(['7-iron', 'Driver']);
  });
});

describe('computeGapping — sorting + category resolution + unknown club', () => {
  it('sorts by Club.displayOrder when available', () => {
    const shots = [
      shot({ clubDisplayName: 'Driver', flatCarry: 220 }),
      shot({ clubDisplayName: '7-iron', flatCarry: 150 }),
    ];
    const clubs = [
      club({ id: 'a', clubDisplayName: 'Driver', displayOrder: 1, category: 'Wood' }),
      club({ id: 'b', clubDisplayName: '7-iron', displayOrder: 5, category: 'Iron' }),
    ];
    const res = computeGapping(shots, clubs, filter({ cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    expect(res.clubs.map((c) => c.clubDisplayName)).toEqual(['Driver', '7-iron']);
    expect(res.clubs[0].category).toBe('Wood');
  });

  it('falls back to mean-carry desc when no displayOrder', () => {
    const shots = [
      shot({ clubDisplayName: 'Y', flatCarry: 90 }),
      shot({ clubDisplayName: 'X', flatCarry: 200 }),
    ];
    const res = computeGapping(shots, [], filter({ cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    // 'X' mean 200 comes before 'Y' mean 90
    expect(res.clubs.map((c) => c.clubDisplayName)).toEqual(['X', 'Y']);
  });

  it('drops unattributed shots (no club) entirely', () => {
    const shots = [
      shot({ clubDisplayName: null, flatCarry: 90 }),
      shot({ clubDisplayName: 'X', flatCarry: 200 }),
    ];
    const res = computeGapping(shots, [], filter({ cleanHit: { enabled: false, k: 1.5, minShots: 8, filterLateral: false } }));
    expect(res.clubs.map((c) => c.clubDisplayName)).toEqual(['X']);
    expect(res.shots).toHaveLength(1); // the null-club shot is not present at all
  });
});

describe('manual mode (user-defined bad hits)', () => {
  function shot(id: string, club: string, flatCarry: number, offTargetLine: number): Shot {
    return {
      id, sessionId: 'S', shotIndex: 0, gameMode: 'WhatsInMyBag',
      clubType: club, clubDisplayName: club, clubCategory: 'Iron', isHidden: false,
      carry: flatCarry, flatCarry, total: flatCarry + 10, ballSpeed: null,
      launchAngle: null, landingAngle: null, curve: null, height: null, hangTime: null,
      offTargetLine, spinRate: null, clubHeadSpeed: null, smashFactor: null,
    };
  }

  it('flags shots too far out wide as tooWide (spread)', () => {
    const shots = [
      shot('a', '7-iron', 100, 5),
      shot('b', '7-iron', 101, -8),
      shot('c', '7-iron', 99, 50),   // way wide
      shot('d', '7-iron', 100, 12),
    ];
    const res = computeGapping(shots, [], filter({
      cleanHit: { enabled: true, mode: 'manual', maxOffline: 20, shortfallPct: 100 },
    }));
    const byId = new Map(res.shots.map((s) => [s.id, s]));
    expect(byId.get('c')!.excluded).toBe(true);
    expect(byId.get('c')!.excludeReason).toBe('tooWide');
    expect(byId.get('a')!.excluded).toBe(false);
    expect(byId.get('d')!.excluded).toBe(false);
    expect(res.clubs[0].keptShots).toBe(3);
  });

  it('flags only SHORT shots as tooShort; long shots are kept', () => {
    const shots = [
      shot('a', '7-iron', 100, 0),
      shot('b', '7-iron', 102, 0),
      shot('c', '7-iron', 98, 0),
      shot('d', '7-iron', 60, 0),    // chunked, 40m short of ~100 median -> bad
      shot('e', '7-iron', 101, 0),
      shot('f', '7-iron', 140, 0),   // flushed 40m LONG -> NOT a bad hit
    ];
    const res = computeGapping(shots, [], filter({
      cleanHit: { enabled: true, mode: 'manual', maxOffline: 1000, shortfallPct: 20 },
    }));
    const byId = new Map(res.shots.map((s) => [s.id, s]));
    expect(byId.get('d')!.excluded).toBe(true);
    expect(byId.get('d')!.excludeReason).toBe('tooShort');
    expect(byId.get('f')!.excluded).toBe(false); // long shot kept
    expect(res.clubs[0].keptShots).toBe(5);
  });

  it('spread takes priority over length when both apply', () => {
    const shots = [
      shot('a', '7-iron', 100, 0),
      shot('b', '7-iron', 100, 0),
      shot('c', '7-iron', 40, 60),   // both too short AND too wide
    ];
    const res = computeGapping(shots, [], filter({
      cleanHit: { enabled: true, mode: 'manual', maxOffline: 20, shortfallPct: 20 },
    }));
    const c = res.shots.find((s) => s.id === 'c')!;
    expect(c.excluded).toBe(true);
    expect(c.excludeReason).toBe('tooWide');
  });
});
