import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDbAt } from './db.js';
import { syncAll, getShots, getSessions, _setTestDb, type SyncClient, type SessionSummary } from './index.js';
import type { Club, Session, Shot } from '../types.js';

function shot(id: string, sessionId: string): Shot {
  return {
    id, sessionId, shotIndex: 0, gameMode: 'WhatsInMyBag', clubType: '7i',
    clubDisplayName: '7-iron', clubCategory: 'Iron', isHidden: false,
    carry: 100, flatCarry: 100, total: 110, ballSpeed: 50, launchAngle: 20,
    landingAngle: 45, curve: 0, height: 25, hangTime: 5, offTargetLine: 2,
    spinRate: null, clubHeadSpeed: null, smashFactor: null,
  };
}
function session(id: string, tracedShots: number): Session {
  return {
    id, gameMode: 'WhatsInMyBag', rangeName: 'Range', beginTimestamp: '2026-01-01T00:00:00Z',
    timestamp: '2026-01-01T00:00:00Z', tracedShots, hasLaunchMonitorStats: false,
  };
}
const club: Club = {
  id: 'c1', clubDisplayName: '7-iron', category: 'Iron', nickname: null,
  displayOrder: 0, avgCarry: 100, avgTotal: 110,
};

/** Mock client whose backing "server" data can change between syncs. */
class MockClient implements SyncClient {
  summariesFetched = 0;
  byIdsFetched: string[][] = [];
  fullFetched = 0;
  constructor(public server: Map<string, { summary: SessionSummary; shots: Shot[] }>) {}
  async getUserClubs(): Promise<Club[]> {
    return [club];
  }
  async getSessionSummaries(): Promise<SessionSummary[]> {
    this.summariesFetched++;
    return [...this.server.values()].map((v) => v.summary);
  }
  async getSessionsWithShotsByIds(ids: string[]): Promise<Array<{ session: Session; shots: Shot[] }>> {
    this.byIdsFetched.push(ids);
    return ids
      .map((id) => this.server.get(id))
      .filter((v): v is NonNullable<typeof v> => !!v)
      .map((v) => ({ session: session(v.summary.id, v.summary.tracedShots ?? 0), shots: v.shots }));
  }
  async getSessionsWithShots(): Promise<Array<{ session: Session; shots: Shot[] }>> {
    this.fullFetched++;
    return [...this.server.values()].map((v) => ({
      session: session(v.summary.id, v.summary.tracedShots ?? 0),
      shots: v.shots,
    }));
  }
}

let db: Database.Database;
const U = 'user-1';
beforeEach(() => {
  db = openDbAt(':memory:');
  _setTestDb(db);
});
afterEach(() => {
  _setTestDb(null);
  db.close();
});

describe('syncAll — incremental caching', () => {
  it('fetches everything the first time, then skips cached sessions', async () => {
    const server = new Map([
      ['A', { summary: { id: 'A', tracedShots: 2, isFinished: true, timestamp: '2026-01-01' }, shots: [shot('a1', 'A'), shot('a2', 'A')] }],
      ['B', { summary: { id: 'B', tracedShots: 1, isFinished: true, timestamp: '2026-01-02' }, shots: [shot('b1', 'B')] }],
    ]);
    const client = new MockClient(server);

    const first = await syncAll(client, U, { gameModes: ['WhatsInMyBag'] });
    expect(first.newSessions).toBe(2);
    expect(first.shots).toBe(3);
    expect(first.skipped).toBe(0);
    expect(getShots(U)).toHaveLength(3);

    // Second sync: nothing changed → all skipped, no by-ids fetch.
    client.byIdsFetched = [];
    const second = await syncAll(client, U, { gameModes: ['WhatsInMyBag'] });
    expect(second.skipped).toBe(2);
    expect(second.newSessions).toBe(0);
    expect(second.shots).toBe(0);
    expect(client.byIdsFetched.flat()).toEqual([]); // nothing re-downloaded
  });

  it('fetches a newly added session only', async () => {
    const server = new Map([
      ['A', { summary: { id: 'A', tracedShots: 2, isFinished: true, timestamp: '2026-01-01' }, shots: [shot('a1', 'A'), shot('a2', 'A')] }],
    ]);
    const client = new MockClient(server);
    await syncAll(client, U, { gameModes: ['WhatsInMyBag'] });

    // A new session C appears on the server.
    server.set('C', { summary: { id: 'C', tracedShots: 1, isFinished: true, timestamp: '2026-02-01' }, shots: [shot('c1', 'C')] });
    client.byIdsFetched = [];
    const res = await syncAll(client, U, { gameModes: ['WhatsInMyBag'] });

    expect(res.newSessions).toBe(1);
    expect(res.skipped).toBe(1); // A skipped
    expect(client.byIdsFetched.flat()).toEqual(['C']); // only C downloaded
    expect(getSessions(U).map((s) => s.id).sort()).toEqual(['A', 'C']);
    expect(getShots(U)).toHaveLength(3);
  });

  it('re-fetches a session whose traced-shot count grew', async () => {
    const server = new Map([
      ['A', { summary: { id: 'A', tracedShots: 1, isFinished: false, timestamp: '2026-01-01' }, shots: [shot('a1', 'A')] }],
    ]);
    const client = new MockClient(server);
    await syncAll(client, U, { gameModes: ['WhatsInMyBag'] });
    expect(getShots(U)).toHaveLength(1);

    // The in-progress session gained a shot.
    server.set('A', { summary: { id: 'A', tracedShots: 2, isFinished: true, timestamp: '2026-01-01' }, shots: [shot('a1', 'A'), shot('a2', 'A')] });
    client.byIdsFetched = [];
    const res = await syncAll(client, U, { gameModes: ['WhatsInMyBag'] });

    expect(res.skipped).toBe(0);
    expect(client.byIdsFetched.flat()).toEqual(['A']); // re-downloaded because it changed
    expect(getShots(U)).toHaveLength(2);
  });
});

describe('syncAll — per-user isolation', () => {
  it('keeps two users\' data separate', async () => {
    const serverA = new Map([
      ['A', { summary: { id: 'A', tracedShots: 2, isFinished: true, timestamp: '2026-01-01' }, shots: [shot('a1', 'A'), shot('a2', 'A')] }],
    ]);
    const serverB = new Map([
      ['B', { summary: { id: 'B', tracedShots: 1, isFinished: true, timestamp: '2026-01-02' }, shots: [shot('b1', 'B')] }],
    ]);
    await syncAll(new MockClient(serverA), 'user-A', { gameModes: ['WhatsInMyBag'] });
    await syncAll(new MockClient(serverB), 'user-B', { gameModes: ['WhatsInMyBag'] });

    expect(getShots('user-A').map((s) => s.id).sort()).toEqual(['a1', 'a2']);
    expect(getShots('user-B').map((s) => s.id)).toEqual(['b1']);
    expect(getSessions('user-A').map((s) => s.id)).toEqual(['A']);
    expect(getSessions('user-B').map((s) => s.id)).toEqual(['B']);
    // A user with no data sees nothing.
    expect(getShots('user-C')).toHaveLength(0);
  });
});
