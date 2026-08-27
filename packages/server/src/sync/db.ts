import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from '../config.js';

let singleton: Database.Database | null = null;

/**
 * Open a SQLite database at an explicit path (used by openDb and tests).
 * Ensures WAL mode and runs migrations. Does not use the singleton.
 */
export function openDbAt(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

/**
 * Open the app database at config.DB_PATH, ensuring DATA_DIR exists and
 * migrations are applied. Reuses a singleton connection across calls.
 */
export function openDb(): Database.Database {
  if (singleton) return singleton;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  singleton = openDbAt(DB_PATH);
  return singleton;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export function migrate(db: Database.Database): void {
  // Multi-tenant migration: the shot data tables gained a user_id. If an old
  // single-user table exists without it, drop and recreate (cache re-syncs per user).
  for (const t of ['sessions', 'shots', 'clubs']) {
    const exists = (db
      .prepare(`SELECT count(*) n FROM sqlite_master WHERE type='table' AND name=?`)
      .get(t) as { n: number }).n > 0;
    if (exists && !hasColumn(db, t, 'user_id')) db.exec(`DROP TABLE ${t}`);
  }

  db.exec(`
    -- One row per Toptracer user (keyed by JWT sub). Holds their refresh token.
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT,
      profile_name TEXT,
      refresh_token TEXT,
      obtained_at INTEGER
    );

    -- One row per browser session (random sid cookie -> user).
    CREATE TABLE IF NOT EXISTS app_sessions (
      sid TEXT PRIMARY KEY,
      user_id TEXT,
      created_at INTEGER,
      last_seen INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      user_id TEXT,
      id TEXT,
      game_mode TEXT,
      range_name TEXT,
      begin_ts TEXT,
      ts TEXT,
      traced_shots INTEGER,
      has_lm_stats INTEGER,
      raw_json TEXT,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS shots (
      user_id TEXT,
      id TEXT,
      session_id TEXT,
      shot_index INTEGER,
      game_mode TEXT,
      club_type TEXT,
      club_display_name TEXT,
      club_category TEXT,
      is_hidden INTEGER,
      carry REAL,
      flat_carry REAL,
      total REAL,
      ball_speed REAL,
      launch_angle REAL,
      landing_angle REAL,
      curve REAL,
      height REAL,
      hang_time REAL,
      off_target_line REAL,
      spin_rate REAL,
      club_head_speed REAL,
      smash_factor REAL,
      raw_json TEXT,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS clubs (
      user_id TEXT,
      id TEXT,
      club_display_name TEXT,
      category TEXT,
      nickname TEXT,
      display_order INTEGER,
      avg_carry REAL,
      avg_total REAL,
      PRIMARY KEY (user_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_shots_user ON shots(user_id);
    CREATE INDEX IF NOT EXISTS idx_shots_user_session ON shots(user_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_clubs_user ON clubs(user_id);
    CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);
  `);
}

/** Reset the cached singleton (test helper). */
export function _resetDb(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
