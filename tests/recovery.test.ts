import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../server/db.js';
import { applyPasswordRecovery, isValidRecoveryHash } from '../server/auth/recovery.js';
import { hashPassword } from '../server/security.js';
import { call, createSuperAdmin, freshDb, login, newIp, PASSWORD } from './helpers.js';

let db: Db;
const NEW_PASSWORD = 'Fresh-Recovery-Phrase-58';

beforeAll(async () => {
    db = await freshDb();
    await createSuperAdmin(db);
});

describe('break-glass password recovery', () => {
    it('rejects malformed or weak hashes and unknown accounts without changing anything', async () => {
        expect(isValidRecoveryHash('plaintext-password')).toBe(false);
        expect(isValidRecoveryHash('scrypt$1024$8$1$c2FsdHNhbHRzYWx0c2FsdA$' + 'a'.repeat(64))).toBe(false); // N too low
        expect(isValidRecoveryHash(await hashPassword(NEW_PASSWORD))).toBe(true);
        expect((await applyPasswordRecovery(db, { email: 'owner@suskii.test', passwordHash: 'nope' })).applied).toBe(false);
        expect((await applyPasswordRecovery(db, { email: 'ghost@suskii.test', passwordHash: await hashPassword(NEW_PASSWORD) })).applied).toBe(false);
        await login('owner@suskii.test', PASSWORD);
    });

    it('replaces the password, revokes sessions and reset links, and is audited', async () => {
        const before = await login('owner@suskii.test', PASSWORD);
        const hash = await hashPassword(NEW_PASSWORD);
        const res = await applyPasswordRecovery(db, { email: 'OWNER@suskii.test', passwordHash: hash });
        expect(res.applied).toBe(true);
        expect((await call('GET', '/api/auth/me', { cookie: before.cookie })).status).toBe(401);
        const old = await call('POST', '/api/auth/login', { body: { email: 'owner@suskii.test', password: PASSWORD }, ip: newIp() });
        expect(old.status).toBe(401);
        await login('owner@suskii.test', NEW_PASSWORD);
        const row = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.password.recovery'`);
        expect(row!.n).toBe(1);
        // Running the same build again changes nothing and keeps the new session alive.
        const after = await login('owner@suskii.test', NEW_PASSWORD);
        expect((await applyPasswordRecovery(db, { email: 'owner@suskii.test', passwordHash: hash })).applied).toBe(false);
        expect((await call('GET', '/api/auth/me', { cookie: after.cookie })).status).toBe(200);
    });

    it('can also reset two-factor authentication when asked', async () => {
        await db.query(`UPDATE admin_users SET mfa_enabled = true, mfa_secret_enc = 'x' WHERE email = 'owner@suskii.test'`);
        const res = await applyPasswordRecovery(db, { email: 'owner@suskii.test', passwordHash: await hashPassword(NEW_PASSWORD), resetMfa: true });
        expect(res.applied).toBe(true);
        const u = await db.one<{ mfa_enabled: boolean; mfa_secret_enc: string | null }>(`SELECT mfa_enabled, mfa_secret_enc FROM admin_users WHERE email = 'owner@suskii.test'`);
        expect(u).toMatchObject({ mfa_enabled: false, mfa_secret_enc: null });
    });
});
