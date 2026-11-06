import { handle } from '../server/app.js';
import { getDb, resetDb, type Db } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createFirstAdmin } from '../server/routes/auth.js';
import { hashPassword } from '../server/security.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'Correct-Horse-Battery-9';

export async function freshDb(): Promise<Db> {
    await resetDb();
    const db = await getDb();
    await migrate(db);
    return db;
}

export interface Res { status: number; headers: Headers; body: any; text: string }

let ipCounter = 1;
/** A fresh client IP, so per-IP rate limits in one test do not affect another. */
export const newIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

export async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; csrf?: string; headers?: Record<string, string>; ip?: string; raw?: BodyInit } = {}): Promise<Res> {
    const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '10.255.0.1', ...opts.headers };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.csrf) headers['x-csrf-token'] = opts.csrf;
    let body: BodyInit | undefined = opts.raw;
    if (opts.body !== undefined) { headers['content-type'] ??= 'application/json'; body = JSON.stringify(opts.body); }
    const res = await handle(new Request(`${ORIGIN}${path}`, { method, headers, body }));
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, body: parsed, text };
}

export interface Session { cookie: string; csrf: string; me: any }

export async function login(email: string, password = PASSWORD, ip = newIp()): Promise<Session> {
    const res = await call('POST', '/api/auth/login', { body: { email, password }, ip });
    if (res.status !== 200 || res.body?.mfaRequired) throw new Error(`login failed: ${res.status} ${res.text}`);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const me = await call('GET', '/api/auth/me', { cookie });
    return { cookie, csrf: me.body.csrfToken, me: me.body };
}

/** Authenticated request helper bound to a session. */
export const as = (s: Session) => (method: string, path: string, body?: unknown, extra: { headers?: Record<string, string>; raw?: BodyInit } = {}) =>
    call(method, path, { body, cookie: s.cookie, csrf: method === 'GET' ? undefined : s.csrf, ...extra });

export async function createSuperAdmin(db: Db, email = 'owner@suskii.test'): Promise<{ id: string; email: string }> {
    return createFirstAdmin(db, { email, name: 'Owner', password: PASSWORD });
}

/** Inserts an administrator with the given roles directly (test fixture). */
export async function createAdmin(db: Db, email: string, roles: string[]): Promise<string> {
    const u = await db.one<{ id: string }>(`INSERT INTO admin_users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`, [email, email.split('@')[0], await hashPassword(PASSWORD)]);
    for (const r of roles) await db.query(`INSERT INTO admin_user_roles (user_id, role_id) VALUES ($1, $2)`, [u!.id, r]);
    return u!.id;
}
