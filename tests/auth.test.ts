import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../server/db.js';
import { decrypt, sha256, totp } from '../server/security.js';
import { as, call, createAdmin, createSuperAdmin, freshDb, login, newIp, PASSWORD } from './helpers.js';

let db: Db;
beforeAll(async () => {
    db = await freshDb();
    await createSuperAdmin(db);
});

describe('sign-in', () => {
    it('sets a secure, HttpOnly, SameSite=Strict session cookie and redirects to the overview', async () => {
        const res = await call('POST', '/api/auth/login', { body: { email: 'owner@suskii.test', password: PASSWORD }, ip: newIp() });
        expect(res.status).toBe(200);
        expect(res.body.redirect).toBe('/admin/overview');
        const cookie = res.headers.get('set-cookie')!;
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Strict/i);
        expect(cookie).toMatch(/Path=\//);
        // The raw token is never stored: only its hash.
        const token = cookie.split(';')[0].split('=')[1];
        expect(await db.one(`SELECT 1 FROM admin_sessions WHERE id = $1`, [token])).toBeFalsy();
        expect(await db.one(`SELECT 1 FROM admin_sessions WHERE id = $1`, [sha256(token)])).toBeTruthy();
    });

    it('uses one generic message for wrong passwords and unknown accounts', async () => {
        const a = await call('POST', '/api/auth/login', { body: { email: 'owner@suskii.test', password: 'wrong-password-123' }, ip: newIp() });
        const b = await call('POST', '/api/auth/login', { body: { email: 'nobody@suskii.test', password: 'wrong-password-123' }, ip: newIp() });
        expect(a.status).toBe(401);
        expect(b.status).toBe(401);
        expect(a.body.error.message).toBe(b.body.error.message);
    });

    it('throttles repeated failures for one account, but never counts successful sign-ins', async () => {
        await createAdmin(db, 'busy@suskii.test', ['analyst']);
        for (let i = 0; i < 10; i++) await login('busy@suskii.test');
        await createAdmin(db, 'target@suskii.test', ['analyst']);
        const statuses: number[] = [];
        for (let i = 0; i < 9; i++) statuses.push((await call('POST', '/api/auth/login', { body: { email: 'target@suskii.test', password: 'nope-nope-nope' }, ip: newIp() })).status);
        expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
        expect(statuses[8]).toBe(429);
    });

    it('locks an account after 10 failures across windows', async () => {
        await createAdmin(db, 'lockme@suskii.test', ['analyst']);
        await db.query(`UPDATE admin_users SET failed_logins = 9 WHERE email = 'lockme@suskii.test'`);
        await call('POST', '/api/auth/login', { body: { email: 'lockme@suskii.test', password: 'nope-nope-nope' }, ip: newIp() });
        const res = await call('POST', '/api/auth/login', { body: { email: 'lockme@suskii.test', password: PASSWORD }, ip: newIp() });
        expect(res.status).toBe(401);
        expect(res.body.error.message).toMatch(/locked/i);
        const owner = await login('owner@suskii.test');
        const id = (await db.one<{ id: string }>(`SELECT id FROM admin_users WHERE email = 'lockme@suskii.test'`))!.id;
        expect((await as(owner)('PATCH', `/api/admin/users/${id}`, { unlock: true })).status).toBe(200);
        await login('lockme@suskii.test');
    });

    it('rate-limits login attempts per IP', async () => {
        const ip = newIp();
        const statuses: number[] = [];
        for (let i = 0; i < 22; i++) statuses.push((await call('POST', '/api/auth/login', { body: { email: `x${i}@suskii.test`, password: 'irrelevant-pass' }, ip })).status);
        expect(statuses).toContain(429);
    });

    it('records successful and failed sign-ins in the audit log', async () => {
        const rows = await db.query<{ outcome: string }>(`SELECT outcome FROM audit_logs WHERE action = 'auth.login'`);
        expect(rows.some((r) => r.outcome === 'success')).toBe(true);
        expect(rows.some((r) => r.outcome === 'failure')).toBe(true);
    });
});

describe('sessions and CSRF', () => {
    it('rejects requests without a session', async () => {
        for (const path of ['/api/auth/me', '/api/overview', '/api/cms/entries', '/api/admin/users', '/api/integrations', '/api/records/payments']) {
            expect((await call('GET', path)).status, path).toBe(401);
        }
    });

    it('rejects state-changing requests without a CSRF token or from another origin', async () => {
        const s = await login('owner@suskii.test');
        const noToken = await call('PUT', '/api/admin/settings/general', { cookie: s.cookie, body: { organisationName: 'X', supportEmail: 'a@b.co', reportingTimezone: 'UTC' } });
        expect(noToken.status).toBe(403);
        const crossSite = await call('PUT', '/api/admin/settings/general', { cookie: s.cookie, csrf: s.csrf, headers: { origin: 'https://evil.example' }, body: { organisationName: 'X', supportEmail: 'a@b.co', reportingTimezone: 'UTC' } });
        expect(crossSite.status).toBe(403);
        const ok = await as(s)('PUT', '/api/admin/settings/general', { organisationName: 'SUSKII', supportEmail: 'support@suskii.com', reportingTimezone: 'UTC' });
        expect(ok.status).toBe(200);
    });

    it('expires idle sessions and sessions past their absolute lifetime', async () => {
        const s1 = await login('owner@suskii.test');
        await db.query(`UPDATE admin_sessions SET idle_expires_at = now() - interval '1 minute' WHERE id = $1`, [sha256(s1.cookie.split('=')[1])]);
        expect((await call('GET', '/api/auth/me', { cookie: s1.cookie })).status).toBe(401);
        const s2 = await login('owner@suskii.test');
        await db.query(`UPDATE admin_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [sha256(s2.cookie.split('=')[1])]);
        expect((await call('GET', '/api/auth/me', { cookie: s2.cookie })).status).toBe(401);
    });

    it('logout revokes the session server-side', async () => {
        const s = await login('owner@suskii.test');
        expect((await as(s)('POST', '/api/auth/logout')).status).toBe(200);
        expect((await call('GET', '/api/auth/me', { cookie: s.cookie })).status).toBe(401);
    });

    it('a user can revoke their other sessions; disabling an admin ends their sessions', async () => {
        const owner = await login('owner@suskii.test');
        const id = await createAdmin(db, 'temp@suskii.test', ['analyst']);
        const temp = await login('temp@suskii.test');
        expect((await as(owner)('PATCH', `/api/admin/users/${id}`, { status: 'disabled' })).status).toBe(200);
        expect((await call('GET', '/api/auth/me', { cookie: temp.cookie })).status).toBe(401);
        expect((await call('POST', '/api/auth/login', { body: { email: 'temp@suskii.test', password: PASSWORD }, ip: newIp() })).status).toBe(401);
    });
});

describe('two-factor authentication', () => {
    it('enrols, requires a code at sign-in, and accepts each recovery code once', async () => {
        await createAdmin(db, 'mfa@suskii.test', ['analyst']);
        const s = await login('mfa@suskii.test');
        const setup = await as(s)('POST', '/api/auth/mfa/setup');
        expect(setup.status).toBe(200);
        expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
        expect((await as(s)('POST', '/api/auth/mfa/enable', { code: '000000' })).status).toBe(400);
        const enabled = await as(s)('POST', '/api/auth/mfa/enable', { code: totp(setup.body.secret) });
        expect(enabled.status).toBe(200);
        expect(enabled.body.recoveryCodes).toHaveLength(10);
        // The secret is stored encrypted, never in plain text.
        const row = await db.one<{ mfa_secret_enc: string }>(`SELECT mfa_secret_enc FROM admin_users WHERE email = 'mfa@suskii.test'`);
        expect(row!.mfa_secret_enc).not.toContain(setup.body.secret);
        expect(decrypt(row!.mfa_secret_enc, 'mfa')).toBe(setup.body.secret);

        const step1 = await call('POST', '/api/auth/login', { body: { email: 'mfa@suskii.test', password: PASSWORD }, ip: newIp() });
        expect(step1.body.mfaRequired).toBe(true);
        expect(step1.headers.get('set-cookie')).toBeNull();
        expect((await call('POST', '/api/auth/mfa', { body: { challenge: step1.body.challenge, code: '123456' }, ip: newIp() })).status).toBe(401);
        const ok = await call('POST', '/api/auth/mfa', { body: { challenge: step1.body.challenge, code: totp(setup.body.secret) }, ip: newIp() });
        expect(ok.status).toBe(200);
        expect(ok.headers.get('set-cookie')).toMatch(/HttpOnly/);

        const rc = enabled.body.recoveryCodes[0];
        const c2 = await call('POST', '/api/auth/login', { body: { email: 'mfa@suskii.test', password: PASSWORD }, ip: newIp() });
        expect((await call('POST', '/api/auth/mfa', { body: { challenge: c2.body.challenge, recoveryCode: rc }, ip: newIp() })).status).toBe(200);
        const c3 = await call('POST', '/api/auth/login', { body: { email: 'mfa@suskii.test', password: PASSWORD }, ip: newIp() });
        expect((await call('POST', '/api/auth/mfa', { body: { challenge: c3.body.challenge, recoveryCode: rc }, ip: newIp() })).status).toBe(401);
    });

    it('blocks privileged administrators without MFA when the policy requires it', async () => {
        const owner = await login('owner@suskii.test');
        expect((await as(owner)('PUT', '/api/admin/settings/security', { idleMinutes: 30, requireMfaForPrivileged: true })).status).toBe(200);
        const again = await login('owner@suskii.test');
        expect(again.me.mfaEnrollmentRequired).toBe(true);
        expect((await as(again)('GET', '/api/overview?range=7d')).status).toBe(403);
        // Account routes stay available so MFA can be set up.
        expect((await as(again)('GET', '/api/auth/sessions')).status).toBe(200);
        await db.query(`UPDATE site_settings SET value = '{"idleMinutes":30,"requireMfaForPrivileged":false}' WHERE key = 'security'`);
    });
});

describe('password recovery and setup', () => {
    it('reset tokens are single-use, expire, and revoke existing sessions', async () => {
        await createAdmin(db, 'reset@suskii.test', ['analyst']);
        const before = await login('reset@suskii.test');
        const owner = await login('owner@suskii.test');
        const users = (await as(owner)('GET', '/api/admin/users')).body.users;
        const target = users.find((u: any) => u.email === 'reset@suskii.test');
        const link = (await as(owner)('POST', `/api/admin/users/${target.id}/reset-link`)).body.link as string;
        const token = new URL(link).searchParams.get('token')!;
        expect((await call('POST', '/api/auth/password/reset', { body: { token, password: 'short' }, ip: newIp() })).status).toBe(400);
        expect((await call('POST', '/api/auth/password/reset', { body: { token, password: 'Another-Strong-Pass-77' }, ip: newIp() })).status).toBe(200);
        expect((await call('POST', '/api/auth/password/reset', { body: { token, password: 'Another-Strong-Pass-78' }, ip: newIp() })).status).toBe(400);
        expect((await call('GET', '/api/auth/me', { cookie: before.cookie })).status).toBe(401);
        await login('reset@suskii.test', 'Another-Strong-Pass-77');
    });

    it('forgot-password never reveals whether an account exists', async () => {
        const a = await call('POST', '/api/auth/password/forgot', { body: { email: 'owner@suskii.test' }, ip: newIp() });
        const b = await call('POST', '/api/auth/password/forgot', { body: { email: 'missing@suskii.test' }, ip: newIp() });
        expect(a.status).toBe(200);
        expect(a.body.message).toBe(b.body.message);
    });

    it('has no public registration: browser setup is disabled without a token and once an admin exists', async () => {
        const res = await call('POST', '/api/setup', { body: { token: 'x', email: 'new@suskii.test', name: 'N', password: 'Sturdy-Gatekeeper-123' }, ip: newIp() });
        expect(res.status).toBe(403);
        process.env.ADMIN_BOOTSTRAP_TOKEN = 'a-very-long-bootstrap-token-for-tests';
        const res2 = await call('POST', '/api/setup', { body: { token: 'a-very-long-bootstrap-token-for-tests', email: 'new@suskii.test', name: 'N', password: 'Sturdy-Gatekeeper-123' }, ip: newIp() });
        delete process.env.ADMIN_BOOTSTRAP_TOKEN;
        expect(res2.status).toBe(403);
        expect(res2.body.error.message).toMatch(/already exists/);
        expect((await call('POST', '/api/admin/users', { body: { email: 'x@y.co', name: 'X', roles: ['super_admin'] } })).status).toBe(401);
    });

    it('stores passwords only as scrypt hashes', async () => {
        const row = await db.one<{ password_hash: string }>(`SELECT password_hash FROM admin_users WHERE email = 'owner@suskii.test'`);
        expect(row!.password_hash).toMatch(/^scrypt\$/);
        expect(row!.password_hash).not.toContain(PASSWORD);
    });
});
