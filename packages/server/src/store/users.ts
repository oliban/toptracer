// Per-user token storage + browser session mapping (multi-tenant).
import type Database from 'better-sqlite3';
import { openDb } from '../sync/db.js';

let testDb: Database.Database | null = null;
/** Point the user store at a specific DB (test helper). */
export function _setUserTestDb(db: Database.Database | null): void {
  testDb = db;
}
function db(): Database.Database {
  return testDb ?? openDb();
}

export interface StoredUser {
  userId: string;
  email: string | null;
  profileName: string | null;
}

/** Insert/update a user and their refresh token. */
export function upsertUser(u: {
  userId: string;
  email: string | null;
  profileName: string | null;
  refreshToken: string;
  obtainedAt: number;
}): void {
  db()
    .prepare(
      `INSERT INTO users (user_id, email, profile_name, refresh_token, obtained_at)
       VALUES (@user_id, @email, @profile_name, @refresh_token, @obtained_at)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email,
         profile_name = excluded.profile_name,
         refresh_token = excluded.refresh_token,
         obtained_at = excluded.obtained_at`,
    )
    .run({
      user_id: u.userId,
      email: u.email,
      profile_name: u.profileName,
      refresh_token: u.refreshToken,
      obtained_at: u.obtainedAt,
    });
}

export function getRefreshToken(userId: string): string | null {
  const row = db().prepare(`SELECT refresh_token FROM users WHERE user_id = ?`).get(userId) as
    | { refresh_token: string | null }
    | undefined;
  return row?.refresh_token ?? null;
}

/** Store a rotated refresh token (login stays valid). */
export function updateRefreshToken(userId: string, refreshToken: string, obtainedAt: number): void {
  db()
    .prepare(`UPDATE users SET refresh_token = ?, obtained_at = ? WHERE user_id = ?`)
    .run(refreshToken, obtainedAt, userId);
}

/** Drop a user's refresh token (logout) — keeps their cached shot data. */
export function clearRefreshToken(userId: string): void {
  db().prepare(`UPDATE users SET refresh_token = NULL WHERE user_id = ?`).run(userId);
}

export function getUser(userId: string): StoredUser | null {
  const row = db().prepare(`SELECT user_id, email, profile_name FROM users WHERE user_id = ?`).get(userId) as
    | { user_id: string; email: string | null; profile_name: string | null }
    | undefined;
  if (!row) return null;
  return { userId: row.user_id, email: row.email, profileName: row.profile_name };
}

/** Delete all cached shot data for a user (wipe-on-logout option; not default). */
export function deleteUserData(userId: string): void {
  const d = db();
  const tx = d.transaction(() => {
    d.prepare(`DELETE FROM shots WHERE user_id = ?`).run(userId);
    d.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
    d.prepare(`DELETE FROM clubs WHERE user_id = ?`).run(userId);
  });
  tx();
}

// ---- browser sessions ----

export function createSession(sid: string, userId: string, now: number): void {
  db()
    .prepare(`INSERT OR REPLACE INTO app_sessions (sid, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)`)
    .run(sid, userId, now, now);
}

/** Return the user for a session id, or null. Also refreshes last_seen. */
export function getSessionUser(sid: string, now: number): string | null {
  const row = db().prepare(`SELECT user_id FROM app_sessions WHERE sid = ?`).get(sid) as
    | { user_id: string }
    | undefined;
  if (!row) return null;
  db().prepare(`UPDATE app_sessions SET last_seen = ? WHERE sid = ?`).run(now, sid);
  return row.user_id;
}

export function deleteSession(sid: string): void {
  db().prepare(`DELETE FROM app_sessions WHERE sid = ?`).run(sid);
}
