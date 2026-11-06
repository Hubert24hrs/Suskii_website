import QRCode from 'qrcode';
import { audit } from '../audit.js';
import { bootstrapToken, isProduction, siteOrigin } from '../config.js';
import { getDb, type Db } from '../db.js';
import { badRequest, type Ctx, forbidden, json, readJson, type Router, unauthorized } from '../http.js';
import { mailConfigured, sendMail } from '../mail.js';
import {
    decrypt, dummyPasswordHash, encrypt, hashPassword, newRecoveryCodes, newTotpSecret, passwordProblems,
    randomToken, sha256, totpUri, verifyPassword, verifyTotp,
} from '../security.js';
import { assertUnderRateLimit, clearSessionCookie, createSession, loadSession, rateLimit, requireAdmin, revokeAllSessions, revokeSession } from '../auth/session.js';
import { str } from '../validate.js';

const LOCK_AFTER_FAILURES = 10;
const LOCK_MINUTES = 15;

function sessionResponse(body: unknown, cookie: string): Response {
    return json(body, { headers: { 'Set-Cookie': cookie } });
}

async function completeLogin(db: Db, ctx: Ctx, user: { id: string; email: string }): Promise<Response> {
    const { cookie } = await createSession(db, user.id, ctx);
    await audit(db, ctx, user, { action: 'auth.login', targetType: 'admin_user', targetId: user.id });
    return sessionResponse({ ok: true, redirect: '/admin/overview' }, cookie);
}

export function authRoutes(r: Router): void {
    r.post('/api/auth/login', async (ctx) => {
        const db = await getDb();
        const body = await readJson<{ email?: unknown; password?: unknown }>(ctx.req);
        const email = str(body.email, 'email', { max: 254 }).toLowerCase();
        const password = str(body.password, 'password', { max: 256, trim: false });
        await rateLimit(db, `login:ip:${ctx.ip}`, 20, 15 * 60);
        // Only failed attempts count against an account, so a legitimate user is never throttled by their own sign-ins.
        await assertUnderRateLimit(db, `login:email:${email}`, 8, 15 * 60);

        const user = await db.one<any>(`SELECT id, email, password_hash, status, mfa_enabled, locked_until FROM admin_users WHERE lower(email) = $1`, [email]);
        const ok = await verifyPassword(password, user?.password_hash ?? (await dummyPasswordHash()));
        const locked = user?.locked_until && new Date(user.locked_until) > new Date();

        if (!user || !ok || user.status !== 'active' || locked) {
            await rateLimit(db, `login:email:${email}`, 1_000_000, 15 * 60); // record the failure (the check above enforces the limit)
            if (user && !ok) {
                await db.query(
                    `UPDATE admin_users SET failed_logins = failed_logins + 1,
                         locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3::int) ELSE locked_until END
                     WHERE id = $1`,
                    [user.id, LOCK_AFTER_FAILURES, LOCK_MINUTES],
                );
            }
            await audit(db, ctx, user ? { id: user.id, email: user.email } : null, {
                action: 'auth.login', outcome: 'failure', targetType: 'admin_user', targetId: user?.id ?? null,
                metadata: { email, reason: !user ? 'unknown_email' : locked ? 'locked' : user.status !== 'active' ? 'disabled' : 'bad_password' },
            });
            // One generic message so attackers cannot enumerate accounts.
            throw unauthorized(locked ? 'This account is temporarily locked after repeated failed attempts. Try again later.' : 'Incorrect email or password.');
        }

        if (user.mfa_enabled) {
            const challenge = randomToken(24);
            await db.query(`INSERT INTO admin_mfa_challenges (id, user_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, [sha256(challenge), user.id]);
            return json({ mfaRequired: true, challenge });
        }
        return completeLogin(db, ctx, user);
    });

    r.post('/api/auth/mfa', async (ctx) => {
        const db = await getDb();
        const body = await readJson<{ challenge?: unknown; code?: unknown; recoveryCode?: unknown }>(ctx.req);
        const challenge = str(body.challenge, 'challenge', { max: 100 });
        await rateLimit(db, `mfa:ip:${ctx.ip}`, 20, 15 * 60);
        const row = await db.one<any>(
            `SELECT c.id, c.attempts, u.id AS user_id, u.email, u.mfa_secret_enc, u.status FROM admin_mfa_challenges c
             JOIN admin_users u ON u.id = c.user_id WHERE c.id = $1 AND c.expires_at > now()`,
            [sha256(challenge)],
        );
        if (!row || row.status !== 'active' || row.attempts >= 5) throw unauthorized('This sign-in attempt has expired. Please start again.');
        let ok = false;
        let usedRecovery = false;
        if (typeof body.code === 'string' && row.mfa_secret_enc) {
            ok = verifyTotp(decrypt(row.mfa_secret_enc, 'mfa'), body.code);
        } else if (typeof body.recoveryCode === 'string') {
            const hash = sha256(body.recoveryCode.trim().toUpperCase());
            const rc = await db.one<{ id: number }>(`UPDATE admin_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`, [row.user_id, hash]);
            ok = !!rc;
            usedRecovery = ok;
        }
        if (!ok) {
            await db.query(`UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
            await audit(db, ctx, { id: row.user_id, email: row.email }, { action: 'auth.mfa', outcome: 'failure', targetType: 'admin_user', targetId: row.user_id });
            throw unauthorized('That code is not valid.');
        }
        await db.query(`DELETE FROM admin_mfa_challenges WHERE id = $1`, [row.id]);
        if (usedRecovery) await audit(db, ctx, { id: row.user_id, email: row.email }, { action: 'auth.mfa.recovery_code_used', targetType: 'admin_user', targetId: row.user_id });
        return completeLogin(db, ctx, { id: row.user_id, email: row.email });
    });

    r.post('/api/auth/logout', async (ctx) => {
        const db = await getDb();
        const admin = await loadSession(db, ctx.req);
        if (admin) {
            await revokeSession(db, admin.sessionId);
            await audit(db, ctx, admin.user, { action: 'auth.logout', targetType: 'admin_user', targetId: admin.user.id });
        }
        return sessionResponse({ ok: true }, clearSessionCookie());
    });

    r.get('/api/auth/me', async (ctx) => {
        const { admin } = await requireAdmin(ctx);
        return json({
            user: admin.user,
            roles: admin.roles,
            permissions: [...admin.permissions].sort(),
            platforms: admin.platforms,
            csrfToken: admin.csrfToken,
            session: { expiresAt: admin.expiresAt, idleExpiresAt: admin.idleExpiresAt },
            privileged: admin.privileged,
            mfaEnrollmentRequired: admin.mfaEnrollmentRequired,
        });
    });

    // ─── Password recovery ───
    r.post('/api/auth/password/forgot', async (ctx) => {
        const db = await getDb();
        const body = await readJson<{ email?: unknown }>(ctx.req);
        const email = str(body.email, 'email', { max: 254 }).toLowerCase();
        await rateLimit(db, `forgot:ip:${ctx.ip}`, 5, 60 * 60);
        const user = await db.one<{ id: string; email: string; status: string }>(`SELECT id, email, status FROM admin_users WHERE lower(email) = $1`, [email]);
        if (user && user.status === 'active') {
            const token = randomToken(32);
            await db.query(`INSERT INTO admin_password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`, [sha256(token), user.id]);
            const link = `${siteOrigin()}/admin/reset?token=${token}`;
            const sent = await sendMail({
                to: user.email,
                subject: 'Reset your SUSKII admin password',
                text: `A password reset was requested for your SUSKII admin account.\n\nReset it within 30 minutes:\n${link}\n\nIf you did not request this, ignore this email; your password stays the same.`,
            });
            await audit(db, ctx, user, { action: 'auth.password.reset_requested', targetType: 'admin_user', targetId: user.id, metadata: { delivered: sent } });
        }
        return json({
            ok: true,
            message: mailConfigured() || !isProduction()
                ? 'If that email belongs to an administrator, a reset link has been sent.'
                : 'If that email belongs to an administrator, ask a Super Admin to issue a reset link (email delivery is not configured).',
        });
    });

    r.post('/api/auth/password/reset', async (ctx) => {
        const db = await getDb();
        const body = await readJson<{ token?: unknown; password?: unknown }>(ctx.req);
        const token = str(body.token, 'token', { max: 100 });
        const password = str(body.password, 'password', { max: 256, trim: false });
        await rateLimit(db, `reset:ip:${ctx.ip}`, 10, 60 * 60);
        const row = await db.one<{ user_id: string; email: string }>(
            `SELECT r.user_id, u.email FROM admin_password_resets r JOIN admin_users u ON u.id = r.user_id
             WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'active'`,
            [sha256(token)],
        );
        if (!row) throw badRequest('This reset link is invalid or has expired.');
        const problems = passwordProblems(password, row.email);
        if (problems.length) throw badRequest(problems.join(' '), { field: 'password' });
        await db.tx(async (t) => {
            await t.query(`UPDATE admin_users SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1`, [row.user_id, await hashPassword(password)]);
            await t.query(`UPDATE admin_password_resets SET used_at = now() WHERE token_hash = $1`, [sha256(token)]);
            await revokeAllSessions(t, row.user_id);
        });
        await audit(db, ctx, { id: row.user_id, email: row.email }, { action: 'auth.password.reset', targetType: 'admin_user', targetId: row.user_id });
        return json({ ok: true });
    });

    r.post('/api/auth/password/change', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx);
        const body = await readJson<{ current?: unknown; next?: unknown }>(ctx.req);
        const current = str(body.current, 'current', { max: 256, trim: false });
        const next = str(body.next, 'next', { max: 256, trim: false });
        const row = await db.one<{ password_hash: string }>(`SELECT password_hash FROM admin_users WHERE id = $1`, [admin.user.id]);
        if (!row || !(await verifyPassword(current, row.password_hash))) throw badRequest('Your current password is incorrect.', { field: 'current' });
        const problems = passwordProblems(next, admin.user.email);
        if (problems.length) throw badRequest(problems.join(' '), { field: 'next' });
        await db.query(`UPDATE admin_users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1`, [admin.user.id, await hashPassword(next)]);
        await revokeAllSessions(db, admin.user.id, admin.sessionId);
        await audit(db, ctx, admin.user, { action: 'auth.password.change', targetType: 'admin_user', targetId: admin.user.id });
        return json({ ok: true });
    });

    // ─── MFA enrolment ───
    r.post('/api/auth/mfa/setup', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx);
        if (admin.user.mfaEnabled) throw badRequest('Two-factor authentication is already enabled.');
        const secret = newTotpSecret();
        await db.query(`UPDATE admin_users SET mfa_secret_enc = $2 WHERE id = $1`, [admin.user.id, encrypt(secret, 'mfa')]);
        const uri = totpUri(secret, admin.user.email);
        return json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
    });

    r.post('/api/auth/mfa/enable', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx);
        const body = await readJson<{ code?: unknown }>(ctx.req);
        const code = str(body.code, 'code', { max: 10 });
        const row = await db.one<{ mfa_secret_enc: string | null }>(`SELECT mfa_secret_enc FROM admin_users WHERE id = $1`, [admin.user.id]);
        if (!row?.mfa_secret_enc || !verifyTotp(decrypt(row.mfa_secret_enc, 'mfa'), code)) throw badRequest('That code is not valid. Check your authenticator app time and try again.');
        const codes = newRecoveryCodes();
        await db.tx(async (t) => {
            await t.query(`UPDATE admin_users SET mfa_enabled = true, updated_at = now() WHERE id = $1`, [admin.user.id]);
            await t.query(`DELETE FROM admin_recovery_codes WHERE user_id = $1`, [admin.user.id]);
            for (const c of codes) await t.query(`INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, [admin.user.id, sha256(c)]);
        });
        await audit(db, ctx, admin.user, { action: 'auth.mfa.enable', targetType: 'admin_user', targetId: admin.user.id });
        return json({ ok: true, recoveryCodes: codes });
    });

    r.post('/api/auth/mfa/disable', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx);
        const body = await readJson<{ password?: unknown }>(ctx.req);
        const password = str(body.password, 'password', { max: 256, trim: false });
        const row = await db.one<{ password_hash: string }>(`SELECT password_hash FROM admin_users WHERE id = $1`, [admin.user.id]);
        if (!row || !(await verifyPassword(password, row.password_hash))) throw badRequest('Your password is incorrect.', { field: 'password' });
        await db.query(`UPDATE admin_users SET mfa_enabled = false, mfa_secret_enc = NULL, updated_at = now() WHERE id = $1`, [admin.user.id]);
        await db.query(`DELETE FROM admin_recovery_codes WHERE user_id = $1`, [admin.user.id]);
        await audit(db, ctx, admin.user, { action: 'auth.mfa.disable', targetType: 'admin_user', targetId: admin.user.id });
        return json({ ok: true });
    });

    // ─── Own sessions ───
    r.get('/api/auth/sessions', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx);
        const rows = await db.query(
            `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM admin_sessions
             WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() AND idle_expires_at > now() ORDER BY last_seen_at DESC`,
            [admin.user.id],
        );
        return json({ sessions: rows.map((s: any) => ({ ...s, id: s.id.slice(0, 16), current: s.id === admin.sessionId })) });
    });

    r.delete('/api/auth/sessions/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx);
        const prefix = str(ctx.params.id, 'id', { max: 64 });
        const row = await db.one<{ id: string }>(`SELECT id FROM admin_sessions WHERE user_id = $1 AND left(id, 16) = $2 AND revoked_at IS NULL`, [admin.user.id, prefix]);
        if (!row) throw badRequest('Session not found');
        await revokeSession(db, row.id);
        await audit(db, ctx, admin.user, { action: 'auth.session.revoke', targetType: 'admin_session', targetId: prefix });
        return json({ ok: true });
    });

    // ─── First administrator provisioning (only while no administrator exists) ───
    r.get('/api/setup/status', async () => {
        const db = await getDb();
        const row = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM admin_users`);
        return json({ needsSetup: (row?.n ?? 0) === 0, bootstrapEnabled: bootstrapToken().length >= 24 });
    });

    r.post('/api/setup', async (ctx) => {
        const db = await getDb();
        await rateLimit(db, `setup:ip:${ctx.ip}`, 5, 60 * 60);
        const expected = bootstrapToken();
        if (expected.length < 24) throw forbidden('Browser setup is disabled. Set ADMIN_BOOTSTRAP_TOKEN (24+ characters) or use `npm run admin:create`.');
        const body = await readJson<{ token?: unknown; email?: unknown; name?: unknown; password?: unknown }>(ctx.req);
        const token = str(body.token, 'token', { max: 200 });
        if (sha256(token) !== sha256(expected)) throw forbidden('The setup token is not valid.');
        if (((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM admin_users`))?.n ?? 0) > 0) throw forbidden('An administrator already exists. Sign in and invite others from Administrators.');
        const created = await createFirstAdmin(db, {
            email: str(body.email, 'email', { max: 254 }),
            name: str(body.name, 'name', { max: 120 }),
            password: str(body.password, 'password', { max: 256, trim: false }),
        });
        await audit(db, ctx, created, { action: 'admin.bootstrap', targetType: 'admin_user', targetId: created.id });
        return json({ ok: true });
    });
}

/** Creates the first Super Admin. Refuses if any administrator already exists. */
export async function createFirstAdmin(db: Db, input: { email: string; name: string; password: string }): Promise<{ id: string; email: string }> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address.', { field: 'email' });
    const problems = passwordProblems(input.password, email);
    if (problems.length) throw badRequest(problems.join(' '), { field: 'password' });
    const hash = await hashPassword(input.password);
    return db.tx(async (t) => {
        const existing = await t.one<{ n: number }>(`SELECT count(*)::int AS n FROM admin_users`);
        if ((existing?.n ?? 0) > 0) throw forbidden('An administrator already exists. Sign in and invite others from Administrators.');
        const user = await t.one<{ id: string; email: string }>(
            `INSERT INTO admin_users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email`,
            [email, input.name.trim(), hash],
        );
        await t.query(`INSERT INTO admin_user_roles (user_id, role_id) VALUES ($1, 'super_admin')`, [user!.id]);
        return user!;
    });
}
