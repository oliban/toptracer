import type {
  Club,
  FilterOptions,
  GappingResult,
  LoginResult,
  OverviewResult,
  Session,
  SessionState,
  SyncResult,
} from './types';

/** Thrown when any API call returns a non-2xx status. `status` carries the HTTP code so
 *  callers can special-case 401 (session expired). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') msg = body.error;
    } catch {
      // ignore JSON parse failures; keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export function getSession(): Promise<SessionState> {
  return request<SessionState>('/session');
}

/** Login is special: a 401 returns a structured {ok:false,error} rather than throwing. */
export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  try {
    const body = (await res.json()) as LoginResult;
    return body;
  } catch {
    return { ok: false, error: res.statusText || 'Login failed' };
  }
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/logout', { method: 'POST' });
}

export function sync(gameModes?: string[]): Promise<SyncResult> {
  return request<SyncResult>('/sync', {
    method: 'POST',
    body: JSON.stringify(gameModes ? { gameModes } : {}),
  });
}

export function getClubs(): Promise<Club[]> {
  return request<Club[]>('/clubs');
}

export function getSessions(): Promise<Session[]> {
  return request<Session[]>('/sessions');
}

export function gapping(filter: FilterOptions): Promise<GappingResult> {
  return request<GappingResult>('/gapping', {
    method: 'POST',
    body: JSON.stringify(filter),
  });
}

export function overview(filter: FilterOptions): Promise<OverviewResult> {
  return request<OverviewResult>('/overview', { method: 'POST', body: JSON.stringify(filter) });
}
