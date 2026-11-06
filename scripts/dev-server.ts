/**
 * Local development server that mirrors the Vercel deployment:
 *   /api/*            → the same handler as api/[...path].ts
 *   /admin, /admin/*  → admin/index.html (single-page admin)
 *   /uploads/*        → locally stored media (.data/uploads)
 *   everything else   → public static files only (server code is never served)
 * Uses embedded PostgreSQL (PGlite) in .data/pglite unless DATABASE_URL is set.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

// Optional local .env (never committed). Values already in the environment win.
try { process.loadEnvFile('.env'); } catch { /* no .env file */ }
process.env.APP_ENV ??= 'development';
process.env.DATABASE_URL ||= 'pglite:./.data/pglite';
process.env.SITE_ORIGIN ||= `http://localhost:${process.env.PORT ?? 5173}`;

const { handle } = await import('../server/app.js');
const { getDb } = await import('../server/db.js');
const { migrate } = await import('../server/migrate.js');
const { renderSitePages } = await import('../server/cms/site.js');

const ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? 5173);
const BLOCKED = /^\/(server|db|scripts|node_modules|tests|e2e|api|\.data(?!\/uploads)|\.git|\.claude|\.tmp|dist)(\/|$)/;
const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain',
    '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf',
};
const ADMIN_HEADERS = {
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
};

async function toRequest(req: IncomingMessage): Promise<Request> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    headers.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1');
    const body = chunks.length && !['GET', 'HEAD'].includes(req.method ?? 'GET') ? Buffer.concat(chunks) : undefined;
    return new Request(`http://${req.headers.host ?? `localhost:${PORT}`}${req.url}`, { method: req.method, headers, body });
}

async function fileResponse(path: string, extra: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: Buffer } | null> {
    try {
        let p = path;
        const s = await stat(p);
        if (s.isDirectory()) p = join(p, 'index.html');
        const body = await readFile(p);
        return { status: 200, headers: { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream', ...extra }, body };
    } catch {
        return null;
    }
}

const db = await getDb();
await migrate(db, (m) => console.log(`[dev] migration ${m}`));

createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = decodeURIComponent(url.pathname);
    try {
        if (path.startsWith('/api/')) {
            const response = await handle(await toRequest(req));
            const headers: Record<string, string> = {};
            response.headers.forEach((v, k) => { headers[k] = v; });
            const setCookie = response.headers.getSetCookie?.() ?? [];
            res.writeHead(response.status, { ...headers, ...(setCookie.length ? { 'set-cookie': setCookie } : {}) });
            res.end(Buffer.from(await response.arrayBuffer()));
            return;
        }
        if (path === '/admin' || path.startsWith('/admin/')) {
            const isAsset = /\.[a-z0-9]+$/i.test(path);
            const file = await fileResponse(join(ROOT, isAsset ? normalize(path) : 'admin/index.html'), ADMIN_HEADERS);
            if (file) { res.writeHead(file.status, file.headers); res.end(file.body); return; }
        }
        if (path.startsWith('/uploads/')) {
            const file = await fileResponse(join(ROOT, '.data', normalize(path)));
            if (file) { res.writeHead(200, file.headers); res.end(file.body); return; }
        }
        // CMS-driven pages: rendered from published content, exactly as the production build bakes them.
        if (path === '/' || path === '/index.html' || /^\/(news|careers)(\/|$)/.test(path)) {
            const pages = await renderSitePages(db, await readFile(join(ROOT, 'index.html'), 'utf8'));
            const key = path === '/index.html' ? '/' : path.endsWith('/') ? path : `${path}/`;
            const html = pages.get(key);
            if (html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return; }
        }
        if (!BLOCKED.test(path) && !path.includes('..')) {
            const file = await fileResponse(join(ROOT, normalize(path === '/' ? '/index.html' : path)));
            if (file) { res.writeHead(200, file.headers); res.end(file.body); return; }
        }
        const notFound = await fileResponse(join(ROOT, '404.html'));
        res.writeHead(404, notFound?.headers ?? {});
        res.end(notFound?.body ?? 'Not found');
    } catch (e) {
        console.error(e);
        res.writeHead(500);
        res.end('Internal error');
    }
}).listen(PORT, () => console.log(`[dev] SUSKII running at http://localhost:${PORT}  (admin: /admin)`));
