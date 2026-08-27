// AUTH module — headless Playwright OAuth for the Toptracer Range (trca) client.
//
// Holds the password in memory only; persists ONLY the refresh token to
// config.SESSION_PATH. Access tokens are cached in a module variable and
// refreshed via grant_type=refresh_token when they expire.
//
// Secrets (passwords, tokens) are NEVER logged or written except the refresh
// token to SESSION_PATH.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

import {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  CLIENT_ID,
  REDIRECT_URI,
  OAUTH_SCOPE,
  SESSION_PATH,
} from '../config.js';

export class NotLoggedInError extends Error {
  constructor(message = 'not logged in') {
    super(message);
    this.name = 'NotLoggedInError';
  }
}

// ---- Persisted session shape (refresh token only) ----
interface StoredSession {
  refresh_token: string;
  obtained_at: number; // epoch ms
}

// ---- OAuth token endpoint response ----
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // seconds
  token_type?: string;
  error?: string;
  error_description?: string;
}

// ---- In-memory access-token cache ----
interface CachedToken {
  accessToken: string;
  // Absolute expiry as epoch ms, already reduced by the safety margin.
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

const REFRESH_SAFETY_MARGIN_MS = 30_000; // ~30s

// ---- base64url helper ----
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- PKCE ----
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ---- Session persistence ----
async function readSession(): Promise<StoredSession | null> {
  try {
    const raw = await readFile(SESSION_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (parsed && typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0) {
      return {
        refresh_token: parsed.refresh_token,
        obtained_at: typeof parsed.obtained_at === 'number' ? parsed.obtained_at : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeSession(session: StoredSession): Promise<void> {
  await mkdir(dirname(SESSION_PATH), { recursive: true });
  await writeFile(SESSION_PATH, JSON.stringify(session), 'utf8');
}

async function deleteSession(): Promise<void> {
  try {
    await rm(SESSION_PATH, { force: true });
  } catch {
    // ignore — already gone
  }
}

// ---- Token endpoint call ----
async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams(params);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  let data: TokenResponse;
  try {
    data = (await res.json()) as TokenResponse;
  } catch {
    throw new Error(`token request failed: HTTP ${res.status} (non-JSON response)`);
  }
  return data;
}

// Cache the access token from a successful token response.
function cacheAccessToken(data: TokenResponse): void {
  if (!data.access_token) return;
  const expiresInMs = (data.expires_in ?? 60) * 1000;
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs - REFRESH_SAFETY_MARGIN_MS,
  };
}

// ---- login ----
export async function login(email: string, password: string): Promise<void> {
  const { verifier, challenge } = generatePkce();
  const state = base64url(randomBytes(16));

  const authUrl =
    `${AUTH_ENDPOINT}?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(OAUTH_SCOPE)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}`;

  let code: string | null = null;

  // Parse the auth code from a custom-scheme callback URL. The browser cannot
  // navigate to `com.toptracer.community.dev:/callback`, so we sniff it from
  // the request / the 302 Location header. `new URL()` needs a `//` authority
  // marker, so normalise `:/` -> `://` first.
  const extractCode = (rawUrl: string | undefined | null): void => {
    if (code || !rawUrl) return;
    if (!rawUrl.startsWith('com.toptracer.community') || !rawUrl.includes('code=')) return;
    try {
      const normalised = rawUrl.replace(':/', '://');
      const parsed = new URL(normalised);
      const found = parsed.searchParams.get('code');
      if (found) code = found;
    } catch {
      // ignore malformed url
    }
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    context.on('request', (request) => {
      extractCode(request.url());
    });
    page.on('response', (response) => {
      const location = response.headers()['location'];
      extractCode(location);
      // also inspect the response's own url in case of redirect chains
      extractCode(response.url());
    });

    await page.goto(authUrl, { waitUntil: 'domcontentloaded' });

    // Keycloak login is two-step: username, then password.
    await page.fill('#username', email);
    await page.click('#kc-login');

    try {
      await page.waitForSelector('#password', { timeout: 12000 });
      await page.fill('#password', password);
      await page.click('#kc-login');
    } catch {
      // Password field never appeared — either single-step form or an error
      // page. We fall through; the missing code is handled below.
    }

    await page.waitForTimeout(3000);
  } finally {
    await browser.close();
  }

  if (!code) {
    throw new Error('login failed: no authorization code — check credentials');
  }

  const data = await postToken({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });

  if (data.error || !data.refresh_token) {
    throw new Error(`login failed: token exchange rejected (${data.error ?? 'no refresh_token'})`);
  }

  await writeSession({ refresh_token: data.refresh_token, obtained_at: Date.now() });
  cacheAccessToken(data);
}

// ---- logout ----
export async function logout(): Promise<void> {
  await deleteSession();
  cachedToken = null;
}

// ---- getAccessToken ----
export async function getAccessToken(): Promise<string> {
  // Serve a still-valid cached token.
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const session = await readSession();
  if (!session) {
    throw new NotLoggedInError('no refresh token — please log in');
  }

  const data = await postToken({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: session.refresh_token,
  });

  if (data.error) {
    // Refresh token is invalid/expired — clear the session.
    await deleteSession();
    cachedToken = null;
    throw new NotLoggedInError(`refresh failed (${data.error})`);
  }

  if (!data.access_token) {
    throw new NotLoggedInError('refresh failed (no access token returned)');
  }

  // Rotation: persist the new refresh token if one was returned.
  if (data.refresh_token && data.refresh_token !== session.refresh_token) {
    await writeSession({ refresh_token: data.refresh_token, obtained_at: Date.now() });
  }

  cacheAccessToken(data);
  return data.access_token;
}

// ---- isLoggedIn ----
export async function isLoggedIn(): Promise<boolean> {
  const session = await readSession();
  if (!session) return false;
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
