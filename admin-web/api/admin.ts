import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAdminApiRequest } from '../server/adminBackend.ts';

interface VercelRequest extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface VercelResponse extends ServerResponse {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
}

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const routeParam = req.query?.route;
  const route = Array.isArray(routeParam)
    ? routeParam.join('/')
    : typeof routeParam === 'string'
    ? routeParam
    : '';

  const body =
    req.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())
      ? await readJsonBody(req)
      : {};

  const result = await handleAdminApiRequest({
    method: req.method || 'GET',
    route,
    body,
    headers: req.headers,
  });

  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}
