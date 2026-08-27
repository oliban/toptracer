import type { UserProfile, Club, Session, Shot } from '../types.js';
import { GRAPHQL_ENDPOINT } from '../config.js';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface SessionSummary {
  id: string;
  tracedShots: number | null;
  isFinished: boolean;
  timestamp: string | null;
}

// Shared GraphQL selection for a full session with its shots.
const SESSION_FIELDS = `{ id gameMode score tracedShots isFinished beginTimestamp timestamp hasLaunchMonitorStats range { name } shots { id legacyId shotIndex gameMode isHidden clubType userClub { clubTypeDisplayName category } launchMonitorStats { spinRate clubHeadSpeed smashFactor } stats { total carry flatCarry ballSpeed launchAngle landingAngle curve height hangTime offTargetLine } } }`;

function mapGqlSession(gs: GqlSession): { session: Session; shots: Shot[] } {
  const session: Session = {
    id: gs.id,
    gameMode: gs.gameMode,
    rangeName: gs.range?.name ?? null,
    beginTimestamp: gs.beginTimestamp ?? null,
    timestamp: gs.timestamp ?? null,
    tracedShots: gs.tracedShots ?? null,
    hasLaunchMonitorStats: !!gs.hasLaunchMonitorStats,
  };
  const shots: Shot[] = (gs.shots ?? []).map((s) => {
    const stats = s.stats ?? null;
    const lm = s.launchMonitorStats ?? null;
    return {
      id: s.id,
      sessionId: session.id,
      shotIndex: s.shotIndex,
      gameMode: s.gameMode,
      clubType: s.clubType ?? null,
      clubDisplayName: s.userClub?.clubTypeDisplayName ?? null,
      clubCategory: s.userClub?.category ?? null,
      isHidden: !!s.isHidden,
      carry: stats?.carry ?? null,
      flatCarry: stats?.flatCarry ?? null,
      total: stats?.total ?? null,
      ballSpeed: stats?.ballSpeed ?? null,
      launchAngle: stats?.launchAngle ?? null,
      landingAngle: stats?.landingAngle ?? null,
      curve: stats?.curve ?? null,
      height: stats?.height ?? null,
      hangTime: stats?.hangTime ?? null,
      offTargetLine: stats?.offTargetLine ?? null,
      spinRate: lm?.spinRate ?? null,
      clubHeadSpeed: lm?.clubHeadSpeed ?? null,
      smashFactor: lm?.smashFactor ?? null,
    };
  });
  return { session, shots };
}

export class ToptracerGraphQLClient {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    const body = JSON.stringify({ query, variables });

    const maxAttempts = 3; // initial try + 2 retries
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        // simple exponential backoff: 250ms, 500ms
        await sleep(250 * 2 ** (attempt - 1));
      }

      let res: Response;
      try {
        res = await fetch(GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body,
        });
      } catch (err) {
        // network error -> retry
        lastError = err;
        continue;
      }

      // retry on 5xx
      if (res.status >= 500 && res.status <= 599) {
        lastError = new Error(`GraphQL request failed with HTTP ${res.status}`);
        continue;
      }

      if (!res.ok) {
        throw new Error(`GraphQL request failed with HTTP ${res.status}`);
      }

      const json = (await res.json()) as GraphQLResponse<T>;
      if (json.errors && json.errors.length > 0) {
        const message = json.errors.map((e) => e.message ?? 'Unknown GraphQL error').join('; ');
        throw new Error(message);
      }
      return json.data as T;
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('GraphQL request failed after retries');
  }

  async getUser(): Promise<UserProfile> {
    const query = `{ user { id email profileName distanceType speedUnitType } }`;
    const data = await this.gql<{
      user: {
        id: string;
        email: string | null;
        profileName: string | null;
        distanceType: string | null;
        speedUnitType: string | null;
      };
    }>(query);
    const u = data.user;
    return {
      id: u.id,
      email: u.email ?? null,
      profileName: u.profileName ?? null,
      distanceUnit: u.distanceType ?? null,
      speedUnit: u.speedUnitType ?? null,
    };
  }

  async getUserClubs(gameMode: string): Promise<Club[]> {
    const query = `query($m:GameMode!){ userClubs(gameMode:$m){ clubs { id clubType clubTypeDisplayName category categoryDisplayName nickname displayOrder isDefault isHidden averages { carry total } } } }`;
    const data = await this.gql<{
      userClubs: {
        clubs: Array<{
          id: string;
          clubType: string | null;
          clubTypeDisplayName: string | null;
          category: string | null;
          categoryDisplayName: string | null;
          nickname: string | null;
          displayOrder: number | null;
          isDefault: boolean | null;
          isHidden: boolean | null;
          averages: { carry: number | null; total: number | null } | null;
        }> | null;
      } | null;
    }>(query, { m: gameMode });

    const clubs = data.userClubs?.clubs ?? [];
    return clubs.map((c) => ({
      id: c.id,
      clubDisplayName: c.clubTypeDisplayName ?? '',
      category: c.category ?? c.categoryDisplayName ?? '',
      nickname: c.nickname ?? null,
      displayOrder: c.displayOrder ?? 0,
      avgCarry: c.averages?.carry ?? null,
      avgTotal: c.averages?.total ?? null,
    }));
  }

  async getSessionsWithShots(
    gameMode: string,
  ): Promise<Array<{ session: Session; shots: Shot[] }>> {
    const query = `query($m:GameMode!,$o:Int!,$l:Int!){ gameSessionsByGameMode(gameMode:$m,offset:$o,limit:$l){ gameSessions ${SESSION_FIELDS} } }`;

    const limit = 50;
    let offset = 0;
    const results: Array<{ session: Session; shots: Shot[] }> = [];

    for (;;) {
      const data = await this.gql<{
        gameSessionsByGameMode: {
          gameSessions: GqlSession[] | null;
        } | null;
      }>(query, { m: gameMode, o: offset, l: limit });

      const gameSessions = data.gameSessionsByGameMode?.gameSessions ?? [];
      for (const gs of gameSessions) results.push(mapGqlSession(gs));

      if (gameSessions.length < limit) break;
      offset += limit;
    }

    return results;
  }

  /** Lightweight: session ids + metadata only (no shots) — for incremental sync diffing. */
  async getSessionSummaries(gameMode: string): Promise<SessionSummary[]> {
    const query = `query($m:GameMode!,$o:Int!,$l:Int!){ gameSessionsByGameMode(gameMode:$m,offset:$o,limit:$l){ gameSessions { id tracedShots isFinished timestamp beginTimestamp } } }`;
    const limit = 100;
    let offset = 0;
    const out: SessionSummary[] = [];

    for (;;) {
      const data = await this.gql<{
        gameSessionsByGameMode: {
          gameSessions: Array<{
            id: string;
            tracedShots: number | null;
            isFinished: boolean | null;
            timestamp: string | null;
            beginTimestamp: string | null;
          }> | null;
        } | null;
      }>(query, { m: gameMode, o: offset, l: limit });

      const list = data.gameSessionsByGameMode?.gameSessions ?? [];
      for (const s of list) {
        out.push({
          id: s.id,
          tracedShots: s.tracedShots ?? null,
          isFinished: !!s.isFinished,
          timestamp: s.timestamp ?? s.beginTimestamp ?? null,
        });
      }
      if (list.length < limit) break;
      offset += limit;
    }
    return out;
  }

  /** Full sessions + shots for specific session ids — for fetching only what's new/changed. */
  async getSessionsWithShotsByIds(
    ids: string[],
  ): Promise<Array<{ session: Session; shots: Shot[] }>> {
    if (ids.length === 0) return [];
    const query = `query($ids:[ID!]!){ gameSessionsByIds(gameSessionIds:$ids){ gameSessions ${SESSION_FIELDS} } }`;
    const results: Array<{ session: Session; shots: Shot[] }> = [];
    // chunk to keep requests reasonable
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const data = await this.gql<{
        gameSessionsByIds: { gameSessions: GqlSession[] | null } | null;
      }>(query, { ids: chunk });
      const gameSessions = data.gameSessionsByIds?.gameSessions ?? [];
      for (const gs of gameSessions) results.push(mapGqlSession(gs));
    }
    return results;
  }

  async getGameStats(): Promise<Record<string, number>> {
    const query = `{ gameStats { totalShots rangesVisited rangeVisits totalDurationMinutes longestShot topBallSpeed topClubSpeed } }`;
    const data = await this.gql<{
      gameStats: Record<string, number | null> | null;
    }>(query);

    const stats = data.gameStats ?? {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(stats)) {
      out[key] = value ?? 0;
    }
    return out;
  }
}

interface GqlSession {
  id: string;
  gameMode: string;
  score: number | null;
  tracedShots: number | null;
  isFinished: boolean | null;
  beginTimestamp: string | null;
  timestamp: string | null;
  hasLaunchMonitorStats: boolean | null;
  range: { name: string | null } | null;
  shots: GqlShot[] | null;
}

interface GqlShot {
  id: string;
  legacyId: string | null;
  shotIndex: number;
  gameMode: string;
  isHidden: boolean | null;
  clubType: string | null;
  userClub: { clubTypeDisplayName: string | null; category: string | null } | null;
  launchMonitorStats: {
    spinRate: number | null;
    clubHeadSpeed: number | null;
    smashFactor: number | null;
  } | null;
  stats: {
    total: number | null;
    carry: number | null;
    flatCarry: number | null;
    ballSpeed: number | null;
    launchAngle: number | null;
    landingAngle: number | null;
    curve: number | null;
    height: number | null;
    hangTime: number | null;
    offTargetLine: number | null;
  } | null;
}
