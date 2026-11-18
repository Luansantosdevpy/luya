import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Em desenvolvimento, serve as funções de /api (mesmo formato da Vercel:
 * `export const GET/POST/PUT/DELETE = (request: Request) => Response`).
 * Em produção, quem executa essas funções é a própria Vercel.
 */
function apiDevServer(): Plugin {
  return {
    name: 'luya-api-dev',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        handleApi(server, req, res).catch((err) => {
          server.config.logger.error(String(err?.stack ?? err));
          if (!res.headersSent) res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Erro interno no servidor (dev)' }));
        });
      });
    },
  };
}

async function handleApi(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const file = path.join(server.config.root, 'api', `${route}.ts`);

  if (!/^[a-z-]+$/.test(route) || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Rota não encontrada' }));
  }

  const mod = await server.ssrLoadModule(file);
  const method = (req.method ?? 'GET').toUpperCase();
  const handler = mod[method] as ((request: Request) => Promise<Response>) | undefined;
  if (typeof handler !== 'function') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Método não permitido' }));
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const request = new Request(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' || chunks.length === 0 ? undefined : Buffer.concat(chunks),
  });

  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export default defineConfig(({ mode }) => {
  // Disponibiliza as variáveis do .env (MONGODB_URI etc.) para as funções em dev.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }
  return {
    plugins: [react(), apiDevServer()],
  };
});
