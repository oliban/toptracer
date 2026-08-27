import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import * as auth from '../auth/index.js';
import { ToptracerGraphQLClient } from '../graphql/index.js';
import { syncAll, getClubs, getSessions, getShots } from '../sync/index.js';
import { computeGapping, DEFAULT_FILTER } from '../stats/index.js';
import { computeOverview } from '../stats/overview.js';
import {
  upsertUser,
  getUser,
  createSession,
  getSessionUser,
  deleteSession,
  clearRefreshToken,
} from '../store/users.js';
import type { FilterOptions, UserProfile } from '../types.js';

const SID_COOKIE = 'sid';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, seconds
const secureCookie = process.env.NODE_ENV === 'production';

function clientFor(userId: string): ToptracerGraphQLClient {
  return new ToptracerGraphQLClient(() => auth.getAccessTokenForUser(userId));
}

/** The logged-in user's id from the session cookie, or null. */
function currentUserId(req: FastifyRequest): string | null {
  const sid = (req.cookies as Record<string, string> | undefined)?.[SID_COOKIE];
  if (!sid) return null;
  return getSessionUser(sid, Date.now());
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string; password?: string } }>('/api/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ ok: false, error: 'email and password required' });
    }
    try {
      const { userId, accessToken, refreshToken } = await auth.performLogin(email, password);

      // Fetch the profile once with the fresh access token.
      let profile: UserProfile | null = null;
      try {
        const client = new ToptracerGraphQLClient(() => Promise.resolve(accessToken));
        profile = await client.getUser();
      } catch {
        profile = null;
      }

      upsertUser({
        userId,
        email: profile?.email ?? email,
        profileName: profile?.profileName ?? null,
        refreshToken,
        obtainedAt: Date.now(),
      });

      const sid = randomUUID();
      createSession(sid, userId, Date.now());
      reply.setCookie(SID_COOKIE, sid, {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookie,
        path: '/',
        maxAge: SESSION_MAX_AGE,
      });

      return reply.send({
        ok: true,
        profile: profile ?? { id: userId, email, profileName: null, distanceUnit: null, speedUnit: null },
      });
    } catch (err) {
      req.log.warn('login failed'); // never log credentials
      return reply.code(401).send({ ok: false, error: 'Login failed. Check your Toptracer credentials.' });
    }
  });

  app.get('/api/session', async (req) => {
    const userId = currentUserId(req);
    if (!userId) return { loggedIn: false };
    const u = getUser(userId);
    if (!u) return { loggedIn: false };
    const profile: UserProfile = {
      id: u.userId,
      email: u.email,
      profileName: u.profileName,
      distanceUnit: null,
      speedUnit: null,
    };
    return { loggedIn: true, profile };
  });

  app.post('/api/logout', async (req, reply) => {
    const sid = (req.cookies as Record<string, string> | undefined)?.[SID_COOKIE];
    const userId = currentUserId(req);
    if (sid) deleteSession(sid);
    if (userId) {
      clearRefreshToken(userId); // keep cached shot data, drop the login token
      auth.forgetUser(userId);
    }
    reply.clearCookie(SID_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post<{ Body: { gameModes?: string[]; full?: boolean } }>('/api/sync', async (req, reply) => {
    const userId = currentUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not logged in' });
    const counts = await syncAll(clientFor(userId), userId, {
      gameModes: req.body?.gameModes,
      full: req.body?.full,
    });
    return counts;
  });

  app.get('/api/clubs', async (req, reply) => {
    const userId = currentUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not logged in' });
    return getClubs(userId);
  });

  app.get('/api/sessions', async (req, reply) => {
    const userId = currentUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not logged in' });
    return getSessions(userId);
  });

  app.post<{ Body: FilterOptions }>('/api/gapping', async (req, reply) => {
    const userId = currentUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not logged in' });
    const filter: FilterOptions = { ...DEFAULT_FILTER, ...(req.body ?? {}) };
    return computeGapping(getShots(userId), getClubs(userId), filter);
  });

  app.post<{ Body: FilterOptions }>('/api/overview', async (req, reply) => {
    const userId = currentUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not logged in' });
    const filter: FilterOptions = { ...DEFAULT_FILTER, ...(req.body ?? {}) };
    const g = computeGapping(getShots(userId), getClubs(userId), filter);
    return computeOverview(g, getClubs(userId), getSessions(userId), Date.now());
  });
}
