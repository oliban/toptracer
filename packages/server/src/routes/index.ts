import type { FastifyInstance } from 'fastify';
import * as auth from '../auth/index.js';
import { ToptracerGraphQLClient } from '../graphql/index.js';
import { syncAll, getClubs, getSessions, getShots } from '../sync/index.js';
import { computeGapping, DEFAULT_FILTER } from '../stats/index.js';
import { computeOverview } from '../stats/overview.js';
import type { FilterOptions, UserProfile } from '../types.js';

const client = new ToptracerGraphQLClient(() => auth.getAccessToken());

async function currentProfile(): Promise<UserProfile | null> {
  try {
    return await client.getUser();
  } catch {
    return null;
  }
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string; password?: string } }>('/api/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ ok: false, error: 'email and password required' });
    }
    try {
      await auth.login(email, password);
      const profile = await currentProfile();
      return reply.send({ ok: true, profile });
    } catch (err) {
      req.log.warn('login failed'); // no secrets
      return reply.code(401).send({ ok: false, error: 'Login failed. Check your Toptracer credentials.' });
    }
  });

  app.get('/api/session', async () => {
    const loggedIn = await auth.isLoggedIn();
    if (!loggedIn) return { loggedIn: false };
    const profile = await currentProfile();
    return { loggedIn: !!profile, profile: profile ?? undefined };
  });

  app.post('/api/logout', async () => {
    await auth.logout();
    return { ok: true };
  });

  app.post<{ Body: { gameModes?: string[]; full?: boolean } }>('/api/sync', async (req, reply) => {
    if (!(await auth.isLoggedIn())) return reply.code(401).send({ error: 'not logged in' });
    // Incremental by default (only new/changed sessions); pass { full: true } to re-fetch all.
    const counts = await syncAll(client, { gameModes: req.body?.gameModes, full: req.body?.full });
    return counts;
  });

  app.get('/api/clubs', async (_req, reply) => {
    if (!(await auth.isLoggedIn())) return reply.code(401).send({ error: 'not logged in' });
    return getClubs();
  });

  app.get('/api/sessions', async (_req, reply) => {
    if (!(await auth.isLoggedIn())) return reply.code(401).send({ error: 'not logged in' });
    return getSessions();
  });

  app.post<{ Body: FilterOptions }>('/api/gapping', async (req) => {
    const filter: FilterOptions = { ...DEFAULT_FILTER, ...(req.body ?? {}) };
    const shots = getShots();
    const clubs = getClubs();
    // sessionId membership is handled inside computeGapping via opts.sessionIds
    return computeGapping(shots, clubs, filter);
  });

  app.post<{ Body: FilterOptions }>('/api/overview', async (req) => {
    const filter: FilterOptions = { ...DEFAULT_FILTER, ...(req.body ?? {}) };
    const g = computeGapping(getShots(), getClubs(), filter);
    return computeOverview(g, getClubs(), getSessions(), Date.now());
  });
}
