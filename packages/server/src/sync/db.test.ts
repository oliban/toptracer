import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Club, Session, Shot } from '../types.js';
import { openDbAt } from './db.js';
import {
  _setTestDb,
  getClubs,
  getSessions,
  getShots,
  upsertClub,
  upsertSession,
  upsertShot,
} from './index.js';

let db: Database.Database;
const U = 'user-1';

const sampleClubs: Club[] = [
  {
    id: 'club-driver',
    clubDisplayName: 'Driver',
    category: 'Wood',
    nickname: 'Big Dog',
    displayOrder: 1,
    avgCarry: 210.5,
    avgTotal: 235.0,
  },
  {
    id: 'club-7i',
    clubDisplayName: '7-iron',
    category: 'Iron',
    nickname: null, // null round-trip
    displayOrder: 0,
    avgCarry: null, // null round-trip
    avgTotal: 150.2,
  },
];

const sampleSessions: Session[] = [
  {
    id: 'sess-a',
    gameMode: 'WhatsInMyBag',
    rangeName: 'Home Range',
    beginTimestamp: '2026-08-01T10:00:00.000Z',
    timestamp: '2026-08-01T10:30:00.000Z',
    tracedShots: 12,
    hasLaunchMonitorStats: false, // boolean round-trip
  },
  {
    id: 'sess-b',
    gameMode: 'LaunchMonitor',
    rangeName: null,
    beginTimestamp: null,
    timestamp: '2026-08-05T09:00:00.000Z',
    tracedShots: null,
    hasLaunchMonitorStats: true, // boolean round-trip
  },
];

const sampleShots: Shot[] = [
  {
    id: 'shot-1',
    sessionId: 'sess-a',
    shotIndex: 1,
    gameMode: 'WhatsInMyBag',
    clubType: 'Driver',
    clubDisplayName: 'Driver',
    clubCategory: 'Wood',
    isHidden: false,
    carry: 205.1,
    flatCarry: 203.0,
    total: 230.4,
    ballSpeed: 65.2,
    launchAngle: 12.3,
    landingAngle: 38.0,
    curve: -2.1,
    height: 25.0,
    hangTime: 6.1,
    offTargetLine: -3.4,
    spinRate: null,
    clubHeadSpeed: null,
    smashFactor: null,
  },
  {
    id: 'shot-2',
    sessionId: 'sess-a',
    shotIndex: 0,
    gameMode: 'WhatsInMyBag',
    clubType: 'Iron',
    clubDisplayName: '7-iron',
    clubCategory: 'Iron',
    isHidden: true, // hidden boolean round-trip
    carry: 148.0,
    flatCarry: 147.2,
    total: 152.0,
    ballSpeed: 48.0,
    launchAngle: 18.0,
    landingAngle: 45.0,
    curve: 1.0,
    height: 30.0,
    hangTime: 5.5,
    offTargetLine: 2.0,
    spinRate: 6500,
    clubHeadSpeed: 38.0,
    smashFactor: 1.35,
  },
  {
    id: 'shot-3',
    sessionId: 'sess-b',
    shotIndex: 0,
    gameMode: 'LaunchMonitor',
    clubType: null,
    clubDisplayName: null,
    clubCategory: null,
    isHidden: false,
    carry: null,
    flatCarry: null,
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
  },
];

beforeEach(() => {
  db = openDbAt(':memory:');
  _setTestDb(db);
  for (const c of sampleClubs) upsertClub(db, U, c);
  for (const s of sampleSessions) upsertSession(db, U, s);
  for (const s of sampleShots) upsertShot(db, U, s);
});

afterEach(() => {
  _setTestDb(null);
  db.close();
});

describe('sync db round-trip', () => {
  it('round-trips clubs ordered by displayOrder, preserving nulls', () => {
    const clubs = getClubs(U);
    expect(clubs.map((c) => c.id)).toEqual(['club-7i', 'club-driver']);
    const iron = clubs[0];
    expect(iron.nickname).toBeNull();
    expect(iron.avgCarry).toBeNull();
    expect(iron.avgTotal).toBe(150.2);
    const driver = clubs[1];
    expect(driver).toEqual(sampleClubs[0]);
  });

  it('round-trips sessions ordered by ts desc, with boolean and null handling', () => {
    const sessions = getSessions(U);
    expect(sessions.map((s) => s.id)).toEqual(['sess-b', 'sess-a']);
    const b = sessions[0];
    expect(b.hasLaunchMonitorStats).toBe(true);
    expect(typeof b.hasLaunchMonitorStats).toBe('boolean');
    expect(b.rangeName).toBeNull();
    expect(b.beginTimestamp).toBeNull();
    expect(b.tracedShots).toBeNull();
    const a = sessions[1];
    expect(a.hasLaunchMonitorStats).toBe(false);
    expect(a).toEqual(sampleSessions[0]);
  });

  it('round-trips shots ordered by session_id, shot_index, with boolean and null handling', () => {
    const shots = getShots(U);
    expect(shots.map((s) => s.id)).toEqual(['shot-2', 'shot-1', 'shot-3']);
    const hidden = shots[0];
    expect(hidden.isHidden).toBe(true);
    expect(typeof hidden.isHidden).toBe('boolean');
    expect(hidden.spinRate).toBe(6500);
    const notHidden = shots[1];
    expect(notHidden.isHidden).toBe(false);
    expect(notHidden).toEqual(sampleShots[0]);
    const nullShot = shots[2];
    expect(nullShot.clubDisplayName).toBeNull();
    expect(nullShot.carry).toBeNull();
    expect(nullShot.smashFactor).toBeNull();
    expect(nullShot).toEqual(sampleShots[2]);
  });

  it('INSERT OR REPLACE upserts by id', () => {
    upsertClub(db, U, { ...sampleClubs[0], nickname: 'Updated' });
    const clubs = getClubs(U);
    expect(clubs).toHaveLength(2);
    expect(clubs.find((c) => c.id === 'club-driver')?.nickname).toBe('Updated');
  });
});
