import type { IncomingMessage } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handleAdminApiRequest } from './server/adminBackend.ts';

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function tsekiAdminApiPlugin(): Plugin {
  return {
    name: 'tseki-admin-api',
    configureServer(server) {
      server.middlewares.use('/api/admin', async (req, res, next) => {
        try {
          const urlPath = (req.url || '/').split('?')[0];
          const route = urlPath.replace(/^\/+/, '');
          const method = (req.method || 'GET').toUpperCase();
          const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
            ? await readBody(req)
            : {};

          const result = await handleAdminApiRequest({
            method,
            route,
            body,
            headers: req.headers,
          });

          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.body));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load all env vars (not only VITE_*) into process.env for server middleware
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }

  return {
    plugins: [react(), tsekiAdminApiPlugin()],
  };
});
