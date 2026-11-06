/**
 * Minimal Web-standard (Request/Response) router used by the single Vercel function
 * and the local dev server. No framework: the project stays dependency-light.
 */
import { isProduction } from './config.js';

export class HttpError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: unknown) {
        super(message);
    }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const tooMany = (message = 'Too many requests, please try again later') => new HttpError(429, 'rate_limited', message);
export const unavailable = (message: string) => new HttpError(503, 'unavailable', message);

export interface Ctx {
    req: Request;
    url: URL;
    params: Record<string, string>;
    ip: string;
    userAgent: string;
    /** Populated by auth middleware for admin routes. */
    state: Record<string, unknown>;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
    method: string;
    pattern: RegExp;
    keys: string[];
    handler: Handler;
}

export class Router {
    private routes: Route[] = [];

    add(method: string, path: string, handler: Handler): this {
        const keys: string[] = [];
        const pattern = new RegExp(
            '^' + path.replace(/\/:([A-Za-z_]+)(\*)?/g, (_m, key: string, star?: string) => {
                keys.push(key);
                return star ? '/(.+)' : '/([^/]+)';
            }) + '/?$',
        );
        this.routes.push({ method, pattern, keys, handler });
        return this;
    }
    get(p: string, h: Handler) { return this.add('GET', p, h); }
    post(p: string, h: Handler) { return this.add('POST', p, h); }
    put(p: string, h: Handler) { return this.add('PUT', p, h); }
    patch(p: string, h: Handler) { return this.add('PATCH', p, h); }
    delete(p: string, h: Handler) { return this.add('DELETE', p, h); }

    match(method: string, pathname: string): { route: Route; params: Record<string, string> } | 'method' | null {
        let pathMatched = false;
        for (const route of this.routes) {
            const m = route.pattern.exec(pathname);
            if (!m) continue;
            pathMatched = true;
            if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) continue;
            const params: Record<string, string> = {};
            route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
            return { route, params };
        }
        return pathMatched ? 'method' : null;
    }
}

const SECURITY_HEADERS: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cross-Origin-Resource-Policy': 'same-origin',
};

export function withSecurityHeaders(res: Response): Response {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
    if (isProduction()) headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown): Response {
    if (err instanceof HttpError) {
        return json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
    }
    console.error('[api] unhandled error', err);
    return json({ error: { code: 'internal', message: 'Something went wrong. The error has been logged.' } }, { status: 500 });
}

const MAX_JSON_BYTES = 1_000_000;

export async function readJson<T = unknown>(req: Request, maxBytes = MAX_JSON_BYTES): Promise<T> {
    const type = req.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) throw badRequest('Expected application/json');
    const text = await readText(req, maxBytes);
    try {
        return (text ? JSON.parse(text) : {}) as T;
    } catch {
        throw badRequest('Malformed JSON body');
    }
}

export async function readText(req: Request, maxBytes: number): Promise<string> {
    const buf = await readBytes(req, maxBytes);
    return new TextDecoder().decode(buf);
}

export async function readBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
    return buf;
}

export function parseCookies(req: Request): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = req.headers.get('cookie');
    if (!raw) return out;
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

export interface CookieOptions {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax';
    path?: string;
}

export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`];
    if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAge))}`);
    if (o.httpOnly ?? true) parts.push('HttpOnly');
    if (o.secure) parts.push('Secure');
    parts.push(`SameSite=${o.sameSite ?? 'Strict'}`);
    return parts.join('; ');
}

export function clientIp(req: Request): string {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return req.headers.get('x-real-ip') ?? '0.0.0.0';
}

/** Parses ?page=&pageSize= with safe bounds. */
export function pagination(url: URL, defaults = { pageSize: 25 }): { page: number; pageSize: number; offset: number } {
    const page = Math.max(1, Math.floor(Number(url.searchParams.get('page') ?? '1')) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize') ?? defaults.pageSize)) || defaults.pageSize));
    return { page, pageSize, offset: (page - 1) * pageSize };
}
