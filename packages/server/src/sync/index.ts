import type Database from 'better-sqlite3';
import type { Club, Session, Shot } from '../types.js';
import { DEFAULT_GAME_MODES } from '../config.js';
import { openDb } from './db.js';

// Minimal structural view of graphql's ToptracerGraphQLClient — only the methods
// syncAll needs. The real client (src/graphql/index.ts) is structurally compatible;
// declared locally so this module typechecks before that module exists.
export interface SessionSummary {
  id: string;
  tracedShots: number | null;
  isFinished: boolean;
  timestamp: string | null;
}

export interface SyncClient {
  getUserClubs(gameMode: string): Promise<Club[]>;
  getSessionsWithShots(
    gameMode: string
  ): Promise<Array<{ session: Session; shots: Shot[] }>>;
  getSessionSummaries(gameMode: string): Promise<SessionSummary[]>;
  getSessionsWithShotsByIds(
    ids: string[]
  ): Promise<Array<{ session: Session; shots: Shot[] }>>;
}

// ---- DB resolution (overridable for tests) ----

let testDb: Database.Database | null = null;

/** Point the sync module at a specific DB connection (test helper). */
export function _setTestDb(db: Database.Database | null): void {
  testDb = db;
}

function resolveDb(): Database.Database {
  return testDb ?? openDb();
}

// ---- helpers ----

const bit = (b: boolean | null | undefined): number => (b ? 1 : 0);
const num = (n: number | null | undefined): number | null =>
  n === undefined ? null : n;
const str = (s: string | null | undefined): string | null =>
  s === undefined ? null : s;

// ---- upserts ----

export function upsertClub(db: Database.Database, userId: string, club: Club): void {
  db.prepare(
    `INSERT OR REPLACE INTO clubs
      (user_id, id, club_display_name, category, nickname, display_order, avg_carry, avg_total)
     VALUES (@user_id, @id, @club_display_name, @category, @nickname, @display_order, @avg_carry, @avg_total)`
  ).run({
    user_id: userId,
    id: club.id,
    club_display_name: club.clubDisplayName,
    category: club.category,
    nickname: str(club.nickname),
    display_order: club.displayOrder,
    avg_carry: num(club.avgCarry),
    avg_total: num(club.avgTotal),
  });
}

export function upsertSession(db: Database.Database, userId: string, session: Session): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions
      (user_id, id, game_mode, range_name, begin_ts, ts, traced_shots, has_lm_stats, raw_json)
     VALUES (@user_id, @id, @game_mode, @range_name, @begin_ts, @ts, @traced_shots, @has_lm_stats, @raw_json)`
  ).run({
    user_id: userId,
    id: session.id,
    game_mode: session.gameMode,
    range_name: str(session.rangeName),
    begin_ts: str(session.beginTimestamp),
    ts: str(session.timestamp),
    traced_shots: num(session.tracedShots),
    has_lm_stats: bit(session.hasLaunchMonitorStats),
    raw_json: JSON.stringify(session),
  });
}

export function upsertShot(db: Database.Database, userId: string, shot: Shot): void {
  db.prepare(
    `INSERT OR REPLACE INTO shots
      (user_id, id, session_id, shot_index, game_mode, club_type, club_display_name, club_category,
       is_hidden, carry, flat_carry, total, ball_speed, launch_angle, landing_angle, curve,
       height, hang_time, off_target_line, spin_rate, club_head_speed, smash_factor, raw_json)
     VALUES
      (@user_id, @id, @session_id, @shot_index, @game_mode, @club_type, @club_display_name, @club_category,
       @is_hidden, @carry, @flat_carry, @total, @ball_speed, @launch_angle, @landing_angle, @curve,
       @height, @hang_time, @off_target_line, @spin_rate, @club_head_speed, @smash_factor, @raw_json)`
  ).run({
    user_id: userId,
    id: shot.id,
    session_id: shot.sessionId,
    shot_index: shot.shotIndex,
    game_mode: shot.gameMode,
    club_type: str(shot.clubType),
    club_display_name: str(shot.clubDisplayName),
    club_category: str(shot.clubCategory),
    is_hidden: bit(shot.isHidden),
    carry: num(shot.carry),
    flat_carry: num(shot.flatCarry),
    total: num(shot.total),
    ball_speed: num(shot.ballSpeed),
    launch_angle: num(shot.launchAngle),
    landing_angle: num(shot.landingAngle),
    curve: num(shot.curve),
    height: num(shot.height),
    hang_time: num(shot.hangTime),
    off_target_line: num(shot.offTargetLine),
    spin_rate: num(shot.spinRate),
    club_head_speed: num(shot.clubHeadSpeed),
    smash_factor: num(shot.smashFactor),
    raw_json: JSON.stringify(shot),
  });
}

// ---- sync ----

/** Map of stored session id -> traced_shots for a user, to detect new/changed sessions. */
function storedSessionShotCounts(db: Database.Database, userId: string): Map<string, number | null> {
  const rows = db.prepare(`SELECT id, traced_shots FROM sessions WHERE user_id = ?`).all(userId) as Array<{
    id: string;
    traced_shots: number | null;
  }>;
  const m = new Map<string, number | null>();
  for (const r of rows) m.set(r.id, r.traced_shots);
  return m;
}

/**
 * Incremental sync: only downloads sessions we don't already have (or whose shot count
 * changed). Already-cached sessions are skipped, so repeat syncs are cheap. Clubs (with
 * their averages) are always refreshed since they're small and change with any new shot.
 *
 * `full: true` forces a re-fetch of every session (ignores the cache).
 */
export async function syncAll(
  client: SyncClient,
  userId: string,
  opts?: { gameModes?: readonly string[]; full?: boolean }
): Promise<{ sessions: number; shots: number; clubs: number; newSessions: number; skipped: number }> {
  const modes = opts?.gameModes ?? DEFAULT_GAME_MODES;
  const db = resolveDb();

  const shotIds = new Set<string>();
  const clubIds = new Set<string>();
  let newSessions = 0;
  let skipped = 0;
  let totalSessionsSeen = 0;

  const stored = storedSessionShotCounts(db, userId);

  for (const mode of modes) {
    try {
      // Clubs are cheap + change with any new shot → always refresh.
      const clubs = await client.getUserClubs(mode);

      // Decide which sessions to actually download.
      let toFetch: Array<{ session: Session; shots: Shot[] }>;
      if (opts?.full) {
        toFetch = await client.getSessionsWithShots(mode);
        totalSessionsSeen += toFetch.length;
      } else {
        const summaries = await client.getSessionSummaries(mode);
        totalSessionsSeen += summaries.length;
        const staleIds: string[] = [];
        for (const s of summaries) {
          const have = stored.has(s.id);
          // Re-fetch only if we've never seen this session, or its traced-shot count changed
          // (i.e. shots were added since we cached it). Otherwise it's fully cached → skip.
          const changed = have && stored.get(s.id) !== s.tracedShots;
          if (!have || changed) staleIds.push(s.id);
          else skipped++;
        }
        toFetch = await client.getSessionsWithShotsByIds(staleIds);
      }

      const write = db.transaction(() => {
        for (const club of clubs) {
          upsertClub(db, userId, club);
          clubIds.add(club.id);
        }
        for (const { session, shots } of toFetch) {
          const isNew = !stored.has(session.id);
          upsertSession(db, userId, session);
          if (isNew) newSessions++;
          for (const shot of shots) {
            upsertShot(db, userId, shot);
            shotIds.add(shot.id);
          }
        }
      });
      write();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[sync] game mode "${mode}" failed, skipping: ${msg}`);
    }
  }

  return {
    sessions: totalSessionsSeen,
    shots: shotIds.size,
    clubs: clubIds.size,
    newSessions,
    skipped,
  };
}

// ---- readers (row -> domain mapping) ----

interface ClubRow {
  id: string;
  club_display_name: string;
  category: string;
  nickname: string | null;
  display_order: number;
  avg_carry: number | null;
  avg_total: number | null;
}

interface SessionRow {
  id: string;
  game_mode: string;
  range_name: string | null;
  begin_ts: string | null;
  ts: string | null;
  traced_shots: number | null;
  has_lm_stats: number;
  raw_json: string;
}

interface ShotRow {
  id: string;
  session_id: string;
  shot_index: number;
  game_mode: string;
  club_type: string | null;
  club_display_name: string | null;
  club_category: string | null;
  is_hidden: number;
  carry: number | null;
  flat_carry: number | null;
  total: number | null;
  ball_speed: number | null;
  launch_angle: number | null;
  landing_angle: number | null;
  curve: number | null;
  height: number | null;
  hang_time: number | null;
  off_target_line: number | null;
  spin_rate: number | null;
  club_head_speed: number | null;
  smash_factor: number | null;
  raw_json: string;
}

function mapClub(r: ClubRow): Club {
  return {
    id: r.id,
    clubDisplayName: r.club_display_name,
    category: r.category,
    nickname: r.nickname,
    displayOrder: r.display_order,
    avgCarry: r.avg_carry,
    avgTotal: r.avg_total,
  };
}

function mapSession(r: SessionRow): Session {
  return {
    id: r.id,
    gameMode: r.game_mode,
    rangeName: r.range_name,
    beginTimestamp: r.begin_ts,
    timestamp: r.ts,
    tracedShots: r.traced_shots,
    hasLaunchMonitorStats: r.has_lm_stats === 1,
  };
}

function mapShot(r: ShotRow): Shot {
  return {
    id: r.id,
    sessionId: r.session_id,
    shotIndex: r.shot_index,
    gameMode: r.game_mode,
    clubType: r.club_type,
    clubDisplayName: r.club_display_name,
    clubCategory: r.club_category,
    isHidden: r.is_hidden === 1,
    carry: r.carry,
    flatCarry: r.flat_carry,
    total: r.total,
    ballSpeed: r.ball_speed,
    launchAngle: r.launch_angle,
    landingAngle: r.landing_angle,
    curve: r.curve,
    height: r.height,
    hangTime: r.hang_time,
    offTargetLine: r.off_target_line,
    spinRate: r.spin_rate,
    clubHeadSpeed: r.club_head_speed,
    smashFactor: r.smash_factor,
  };
}

export function getClubs(userId: string): Club[] {
  const db = resolveDb();
  const rows = db
    .prepare(`SELECT * FROM clubs WHERE user_id = ? ORDER BY display_order ASC`)
    .all(userId) as ClubRow[];
  return rows.map(mapClub);
}

export function getSessions(userId: string): Session[] {
  const db = resolveDb();
  const rows = db
    .prepare(`SELECT * FROM sessions WHERE user_id = ? ORDER BY ts DESC`)
    .all(userId) as SessionRow[];
  return rows.map(mapSession);
}

export function getShots(userId: string): Shot[] {
  const db = resolveDb();
  const rows = db
    .prepare(`SELECT * FROM shots WHERE user_id = ? ORDER BY session_id ASC, shot_index ASC`)
    .all(userId) as ShotRow[];
  return rows.map(mapShot);
}
