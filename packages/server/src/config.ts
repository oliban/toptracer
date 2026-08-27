// Verified-working Toptracer Range (trca) OAuth + API constants (proven live 2026-08-26).
export const KEYCLOAK_ISSUER = 'https://login.toptracer.com/realms/toptracer';
export const AUTH_ENDPOINT = `${KEYCLOAK_ISSUER}/protocol/openid-connect/auth`;
export const TOKEN_ENDPOINT = `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`;
export const CLIENT_ID = 'trca';
export const REDIRECT_URI = 'com.toptracer.community.dev:/callback';
export const OAUTH_SCOPE = 'openid offline_access';
export const GRAPHQL_ENDPOINT = 'https://api.toptracer.com/api/appsbff/graphql';

// Data dir is overridable via env (DATA_DIR) so a deployment can point it at a mounted
// volume; defaults to packages/server/data for local dev.
const dataDirEnv = process.env.DATA_DIR;
export const DATA_DIR = dataDirEnv
  ? dataDirEnv.endsWith('/') ? dataDirEnv : `${dataDirEnv}/`
  : new URL('../data/', import.meta.url).pathname;
export const DB_PATH = `${DATA_DIR}toptracer.db`;
export const SESSION_PATH = `${DATA_DIR}session.json`; // stores refresh token only

// Network config (env-overridable for deployment).
export const SERVER_PORT = Number(process.env.PORT ?? 5174);
export const SERVER_HOST = process.env.HOST ?? '127.0.0.1';
export const WEB_PORT = 5173;

// Optional HTTP Basic Auth gate for public deployments. When APP_PASSWORD is set, every
// request must present it (username is ignored). Unset = open (local use).
export const APP_PASSWORD = process.env.APP_PASSWORD ?? '';
// Path to the built web SPA to serve in production (set by the Docker image / fly).
export const WEB_DIST = process.env.WEB_DIST ?? '';

// Game modes that actually hold range shot data for this account (others are empty/games).
export const DEFAULT_GAME_MODES = ['WhatsInMyBag', 'LaunchMonitor'] as const;
export const ALL_GAME_MODES = [
  'AngryBirds','ApproachShotChallenge','Assessment','AssessmentLite','CaptureTheFlag',
  'ClosestToPin','CustomActivity','DrivingChallenge','GoFish','LaunchMonitor','LongDrive',
  'PgaShowGame','PointsGame','PrecisionPro','PrecisionSeries','SwingCapture','VirtualGolf',
  'WhatsInMyBag',
] as const;
