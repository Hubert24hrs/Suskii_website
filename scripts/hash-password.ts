/**
 * Prints an scrypt hash for ADMIN_RECOVERY_PASSWORD_HASH (see server/auth/recovery.ts).
 *   npm run admin:hash-password                         # generates a strong password
 *   ADMIN_PASSWORD='…' npm run admin:hash-password      # hashes a password you chose
 * The plaintext password is written only to .data/recovery-password.txt (git-ignored, owner-only).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { hashPassword, passwordProblems } from '../server/security.js';

function generate(): string {
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '-_!@#'];
    const pick = (s: string, n: number) => Array.from({ length: n }, () => s[randomInt(s.length)]).join('');
    return `${pick(sets[0], 4)}-${pick(sets[1], 5)}${pick(sets[2], 3)}-${pick(sets.slice(0, 3).join(''), 6)}${pick(sets[3], 1)}`;
}

const email = process.env.ADMIN_EMAIL ?? '';
const password = process.env.ADMIN_PASSWORD ?? generate();
const problems = passwordProblems(password, email || undefined);
if (problems.length) {
    console.error(problems.join(' '));
    process.exit(1);
}
const hash = await hashPassword(password);
await mkdir('.data', { recursive: true });
await writeFile('.data/recovery-password.txt', `${email ? `Email: ${email}\n` : ''}Password: ${password}\n`, { mode: 0o600 });
console.log(hash);
console.error('Plaintext saved to .data/recovery-password.txt (git-ignored). Set the hash above as ADMIN_RECOVERY_PASSWORD_HASH.');
