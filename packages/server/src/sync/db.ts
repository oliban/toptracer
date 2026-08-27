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

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      game_mode TEXT,
      range_name TEXT,
      begin_ts TEXT,
      ts TEXT,
      traced_shots INTEGER,
      has_lm_stats INTEGER,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
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
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      club_display_name TEXT,
      category TEXT,
      nickname TEXT,
      display_order INTEGER,
      avg_carry REAL,
      avg_total REAL
    );

    CREATE INDEX IF NOT EXISTS idx_shots_session_id ON shots(session_id);
    CREATE INDEX IF NOT EXISTS idx_shots_club_display_name ON shots(club_display_name);
  `);
}

/** Reset the cached singleton (test helper). */
export function _resetDb(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
