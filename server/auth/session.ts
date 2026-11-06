/**
 * Server-side sessions. The browser holds only an opaque random token in an HttpOnly,
 * Secure (in production), SameSite=Strict cookie; the database stores its SHA-256 hash.
 */
import type { Db } from '../db.js';
import { getDb } from '../db.js';
import { isProduction } from '../config.js';
import { type Ctx, forbidden, HttpError, parseCookies, serializeCookie, tooMany, unauthorized } from '../http.js';
import { randomToken, safeEqual, sha256 } from '../security.js';
import { type Permission, permissionsForUser, readablePlatforms } from './rbac.js';
import type { PlatformId } from '../config.js';

export const SESSION_ABSOLUTE_HOURS = 12;
export const DEFAULT_IDLE_MINUTES = 30;

export const cookieName = (): string => (isProduction() ? '__Host-suskii_admin' : 'suskii_admin');

export interface AdminContext {
    sessionId: string;
    csrfToken: string;
    user: { id: string; email: string; name: string; mfaEnabled: boolean };
    roles: string[];
    permissions: Set<Permission>;
    platforms: PlatformId[];
    expiresAt: Date;
    idleExpiresAt: Date;
    /** Holds a privileged role (Super/Corporate/Finance Admin or a privileged custom role). */
    privileged: boolean;
    /** Security policy requires this user to enrol in MFA before using the admin. */
    mfaEnrollmentRequired: boolean;
}

async function securitySettings(db: Db): Promise<{ idleMinutes?: number; requireMfaForPrivileged?: boolean }> {
    const row = await db.one<{ value: { idleMinutes?: number; requireMfaForPrivileged?: boolean } }>(`SELECT value FROM site_settings WHERE key = 'security'`);
    return row?.value ?? {};
}

async function idleMinutes(db: Db): Promise<number> {
    const v = Number((await securitySettings(db)).idleMinutes);
    return Number.isFinite(v) && v >= 5 && v <= 480 ? v : DEFAULT_IDLE_MINUTES;
}

export async function createSession(db: Db, userId: string, ctx: Pick<Ctx, 'ip' | 'userAgent'>): Promise<{ token: string; cookie: string }> {
    const token = randomToken(32);
    const idle = await idleMinutes(db);
    await db.query(
        `INSERT INTO admin_sessions (id, user_id, csrf_token, idle_expires_at, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4::int), now() + make_interval(hours => $5::int), $6, $7)`,
        [sha256(token), userId, randomToken(24), idle, SESSION_ABSOLUTE_HOURS, ctx.ip, ctx.userAgent.slice(0, 300)],
    );
    await db.query(`UPDATE admin_users SET last_login_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1`, [userId]);
    return { token, cookie: sessionCookie(token, SESSION_ABSOLUTE_HOURS * 3600) };
}

export const sessionCookie = (token: string, maxAge: number): string =>
    serializeCookie(cookieName(), token, { httpOnly: true, secure: isProduction(), sameSite: 'Strict', path: '/', maxAge });

export const clearSessionCookie = (): string => sessionCookie('', 0);

export async function loadSession(db: Db, req: Request): Promise<AdminContext | null> {
    const token = parseCookies(req)[cookieName()];
    if (!token || token.length < 20) return null;
    const row = await db.one<any>(
        `SELECT s.id, s.csrf_token, s.expires_at, s.idle_expires_at, s.last_seen_at,
                u.id AS user_id, u.email, u.name, u.status, u.mfa_enabled
         FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND s.idle_expires_at > now()`,
        [sha256(token)],
    );
    if (!row || row.status !== 'active') return null;
    // Sliding idle expiry, written at most once a minute.
    let idleExpiresAt = new Date(row.idle_expires_at);
    if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
        const idle = await idleMinutes(db);
        const upd = await db.one<{ idle_expires_at: Date }>(
            `UPDATE admin_sessions SET last_seen_at = now(),
                 idle_expires_at = LEAST(expires_at, now() + make_interval(mins => $2::int))
             WHERE id = $1 RETURNING idle_expires_at`,
            [row.id, idle],
        );
        if (upd) idleExpiresAt = new Date(upd.idle_expires_at);
    }
    const permissions = await permissionsForUser(db, row.user_id);
    const roleRows = await db.query<{ role_id: string; is_privileged: boolean }>(
        `SELECT ur.role_id, r.is_privileged FROM admin_user_roles ur JOIN admin_roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY ur.role_id`, [row.user_id]);
    const roles = roleRows.map((r) => r.role_id);
    const privileged = roleRows.some((r) => r.is_privileged);
    const policy = await securitySettings(db);
    return {
        sessionId: row.id,
        csrfToken: row.csrf_token,
        user: { id: row.user_id, email: row.email, name: row.name, mfaEnabled: row.mfa_enabled },
        roles,
        permissions,
        platforms: readablePlatforms(permissions),
        expiresAt: new Date(row.expires_at),
        idleExpiresAt,
        privileged,
        mfaEnrollmentRequired: !!policy.requireMfaForPrivileged && privileged && !row.mfa_enabled,
    };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
    await db.query(`UPDATE admin_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

export async function revokeAllSessions(db: Db, userId: string, exceptSessionId?: string): Promise<void> {
    await db.query(`UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2`, [userId, exceptSessionId ?? null]);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rejects cross-site state-changing requests: same-origin check plus a per-session CSRF token. */
function checkCsrf(ctx: Ctx, admin: AdminContext): void {
    if (SAFE_METHODS.has(ctx.req.method)) return;
    const origin = ctx.req.headers.get('origin');
    if (origin && origin !== ctx.url.origin) throw forbidden('Cross-origin request rejected');
    const header = ctx.req.headers.get('x-csrf-token') ?? '';
    if (!header || !safeEqual(header, admin.csrfToken)) throw new HttpError(403, 'csrf', 'Missing or invalid CSRF token. Reload the page and try again.');
}

/**
 * Authenticates the request and enforces a permission. Use on every admin route.
 * `anyOf` lets read endpoints accept one of several permissions.
 */
export async function requireAdmin(ctx: Ctx, ...required: Permission[]): Promise<{ db: Db; admin: AdminContext }> {
    const db = await getDb();
    const admin = await loadSession(db, ctx.req);
    if (!admin) throw unauthorized('Your session has expired. Please sign in again.');
    checkCsrf(ctx, admin);
    if (admin.mfaEnrollmentRequired && !ctx.url.pathname.startsWith('/api/auth/')) {
        throw new HttpError(403, 'mfa_required', 'Your role requires two-factor authentication. Set it up in your account to continue.');
    }
    for (const p of required) if (!admin.permissions.has(p)) throw forbidden();
    ctx.state.admin = admin;
    return { db, admin };
}

export function can(admin: AdminContext, p: Permission): boolean {
    return admin.permissions.has(p);
}

// ─── Fixed-window rate limiting backed by the database (works across serverless instances) ───
/** Read-only check: throws 429 if the key has already reached its limit in the current window. */
export async function assertUnderRateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
    const row = await db.one<{ count: number; window_start: Date }>(
        `SELECT count, window_start FROM rate_limits WHERE key = $1 AND window_start = to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int)`,
        [key, windowSeconds],
    );
    if (row && row.count >= limit) {
        const retry = Math.max(1, Math.ceil((new Date(row.window_start).getTime() + windowSeconds * 1000 - Date.now()) / 1000));
        const err = tooMany(`Too many attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`);
        err.details = { retryAfterSeconds: retry };
        throw err;
    }
}

/** Counts one attempt and throws 429 once the limit is exceeded. */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
    const row = await db.one<{ count: number; window_start: Date }>(
        `INSERT INTO rate_limits (key, window_start, count)
         VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int), 1)
         ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
         RETURNING count, window_start`,
        [key, windowSeconds],
    );
    if (row && row.count > limit) {
        const retry = Math.max(1, Math.ceil((new Date(row.window_start).getTime() + windowSeconds * 1000 - Date.now()) / 1000));
        const err = tooMany(`Too many attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`);
        err.details = { retryAfterSeconds: retry };
        throw err;
    }
    // Opportunistic cleanup of old windows.
    if (Math.random() < 0.02) await db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
