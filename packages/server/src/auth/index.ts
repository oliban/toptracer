// AUTH module — headless Playwright OAuth for the Toptracer Range (trca) client,
// multi-tenant. Each login yields a refresh token stored per user (keyed by JWT sub)
// in the users table. Access tokens are cached per user in memory.
//
// Passwords are held in memory only for the single login request; never logged or stored.

import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

import { AUTH_ENDPOINT, TOKEN_ENDPOINT, CLIENT_ID, REDIRECT_URI, OAUTH_SCOPE } from '../config.js';
import { getRefreshToken, updateRefreshToken, clearRefreshToken } from '../store/users.js';

export class NotLoggedInError extends Error {
  constructor(message = 'not logged in') {
    super(message);
    this.name = 'NotLoggedInError';
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface LoginResult {
  userId: string; // JWT sub
  accessToken: string;
  refreshToken: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms, minus safety margin
}

// Per-user access-token cache.
const tokenCache = new Map<string, CachedToken>();
const REFRESH_SAFETY_MARGIN_MS = 30_000;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Decode the `sub` claim from a JWT access token. */
function decodeSub(accessToken: string): string {
  const part = accessToken.split('.')[1];
  if (!part) throw new Error('invalid access token');
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const claims = JSON.parse(json) as { sub?: string };
  if (!claims.sub) throw new Error('access token has no sub');
  return claims.sub;
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  try {
    return (await res.json()) as TokenResponse;
  } catch {
    throw new Error(`token request failed: HTTP ${res.status} (non-JSON response)`);
  }
}

function cacheFor(userId: string, data: TokenResponse): void {
  if (!data.access_token) return;
  const expiresInMs = (data.expires_in ?? 60) * 1000;
  tokenCache.set(userId, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs - REFRESH_SAFETY_MARGIN_MS,
  });
}

/**
 * Run the headless OAuth login with the given credentials. Returns the token bundle and
 * the user's id (JWT sub). Does NOT persist anything — the caller stores the refresh token.
 * The password is used only here, in memory.
 */
export async function performLogin(email: string, password: string): Promise<LoginResult> {
  const { verifier, challenge } = generatePkce();
  const state = base64url(randomBytes(16));

  const authUrl =
    `${AUTH_ENDPOINT}?client_id=${CLIENT_ID}` +
    `&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPE)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;

  let code: string | null = null;
  const extractCode = (rawUrl: string | undefined | null): void => {
    if (code || !rawUrl) return;
    if (!rawUrl.startsWith('com.toptracer.community') || !rawUrl.includes('code=')) return;
    try {
      const parsed = new URL(rawUrl.replace(':/', '://'));
      const found = parsed.searchParams.get('code');
      if (found) code = found;
    } catch {
      /* ignore */
    }
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    context.on('request', (request) => extractCode(request.url()));
    page.on('response', (response) => {
      extractCode(response.headers()['location']);
      extractCode(response.url());
    });

    await page.goto(authUrl, { waitUntil: 'domcontentloaded' });
    await page.fill('#username', email);
    await page.click('#kc-login');
    try {
      await page.waitForSelector('#password', { timeout: 12000 });
      await page.fill('#password', password);
      await page.click('#kc-login');
    } catch {
      /* password step never appeared — handled by the missing-code check */
    }
    await page.waitForTimeout(3000);
  } finally {
    await browser.close();
  }

  if (!code) throw new Error('login failed: no authorization code — check credentials');

  const data = await postToken({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });
  if (data.error || !data.refresh_token || !data.access_token) {
    throw new Error(`login failed: token exchange rejected (${data.error ?? 'no tokens'})`);
  }

  const userId = decodeSub(data.access_token);
  cacheFor(userId, data);
  return { userId, accessToken: data.access_token, refreshToken: data.refresh_token };
}

/** Return a valid access token for a user, refreshing from their stored refresh token. */
export async function getAccessTokenForUser(userId: string): Promise<string> {
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const refresh = getRefreshToken(userId);
  if (!refresh) throw new NotLoggedInError('no refresh token — please log in');

  const data = await postToken({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refresh,
  });
  if (data.error || !data.access_token) {
    clearRefreshToken(userId);
    tokenCache.delete(userId);
    throw new NotLoggedInError(`refresh failed (${data.error ?? 'no access token'})`);
  }
  if (data.refresh_token && data.refresh_token !== refresh) {
    updateRefreshToken(userId, data.refresh_token, Date.now());
  }
  cacheFor(userId, data);
  return data.access_token;
}

/** Drop a user's cached access token (call on logout after clearing their refresh token). */
export function forgetUser(userId: string): void {
  tokenCache.delete(userId);
}
