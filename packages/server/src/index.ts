import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { registerRoutes } from './routes/index.js';
import { openDb } from './sync/db.js';
import { SERVER_PORT, SERVER_HOST, WEB_DIST } from './config.js';

async function main() {
  openDb(); // ensure DB + migrations before serving
  const app = Fastify({ logger: { level: 'info' } });

  // Multi-tenant: each visitor logs in with their own Toptracer account and gets a
  // session cookie; there is no shared front-door password.
  await app.register(cookie);
  await app.register(cors, {
    origin: [`http://localhost:5173`, `http://127.0.0.1:5173`],
    credentials: true,
  });
  await registerRoutes(app);

  // Serve the built web SPA in production (WEB_DIST points at packages/web/dist).
  if (WEB_DIST) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    // SPA fallback: any non-/api GET returns index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
  app.log.info(`Toptracer server on http://${SERVER_HOST}:${SERVER_PORT}${WEB_DIST ? ' (serving web)' : ''}`);
}

main().catch((err) => {
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
