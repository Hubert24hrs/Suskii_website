/**
 * Break-glass password recovery for an administrator, applied during a production build.
 *
 * Use it only when nobody can sign in to issue a reset link and the database cannot be reached
 * directly (for example, Vercel "Sensitive" database variables cannot be pulled to a laptop):
 *   1. Generate a hash locally: `npm run admin:hash-password` (the plaintext never leaves your machine).
 *   2. Set ADMIN_RECOVERY_EMAIL and ADMIN_RECOVERY_PASSWORD_HASH for Production only, and redeploy.
 *   3. Remove both variables and redeploy.
 *
 * It replaces the password, clears any lockout, revokes every session and outstanding reset link,
 * and records the change in the audit log. It is idempotent: once applied, later builds do nothing.
 */
import { audit } from '../audit.js';
import type { Db } from '../db.js';
import { revokeAllSessions } from './session.js';

const HASH_RE = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{32,}$/;

export function isValidRecoveryHash(hash: string): boolean {
    const m = HASH_RE.exec(hash);
    if (!m) return false;
    const [n, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return n >= 32768 && n <= 1_048_576 && r >= 8 && r <= 16 && p >= 1 && p <= 4;
}

export async function applyPasswordRecovery(
    db: Db,
    input: { email: string; passwordHash: string; resetMfa?: boolean },
): Promise<{ applied: boolean; message: string }> {
    const email = input.email.trim().toLowerCase();
    if (!email || !isValidRecoveryHash(input.passwordHash)) {
        return { applied: false, message: 'ADMIN_RECOVERY_EMAIL or ADMIN_RECOVERY_PASSWORD_HASH is missing or malformed; nothing changed.' };
    }
    const user = await db.one<{ id: string; email: string; password_hash: string; mfa_enabled: boolean }>(
        `SELECT id, email, password_hash, mfa_enabled FROM admin_users WHERE lower(email) = $1`, [email]);
    if (!user) return { applied: false, message: `No administrator with the email ${email}; nothing changed.` };
    if (user.password_hash === input.passwordHash && !(input.resetMfa && user.mfa_enabled)) {
        return { applied: false, message: 'Recovery already applied; nothing changed. Remove the ADMIN_RECOVERY_* variables.' };
    }
    await db.tx(async (t) => {
        await t.query(
            `UPDATE admin_users SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL, status = 'active', updated_at = now()
             ${input.resetMfa ? ', mfa_enabled = false, mfa_secret_enc = NULL' : ''} WHERE id = $1`,
            [user.id, input.passwordHash]);
        if (input.resetMfa) await t.query(`DELETE FROM admin_recovery_codes WHERE user_id = $1`, [user.id]);
        await t.query(`UPDATE admin_password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
        await t.query(`DELETE FROM admin_mfa_challenges WHERE user_id = $1`, [user.id]);
        await revokeAllSessions(t, user.id);
    });
    await audit(db, null, null, {
        action: 'auth.password.recovery', targetType: 'admin_user', targetId: user.id,
        metadata: { email: user.email, via: 'deploy', mfaReset: !!input.resetMfa },
    });
    return { applied: true, message: `Password replaced for ${user.email}; all sessions and reset links revoked${input.resetMfa ? '; two-factor authentication reset' : ''}.` };
}
