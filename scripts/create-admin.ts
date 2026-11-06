/**
 * Secure first-administrator provisioning:
 *   ADMIN_EMAIL=you@suskii.com ADMIN_NAME="Your Name" npm run admin:create
 * Optionally set ADMIN_PASSWORD; otherwise a strong one-time password is generated and printed once.
 * Refuses to run if any administrator already exists (invite others from the admin instead).
 */
import { getDb } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createFirstAdmin } from '../server/routes/auth.js';
import { randomToken } from '../server/security.js';

const email = process.env.ADMIN_EMAIL ?? '';
const name = process.env.ADMIN_NAME ?? '';
if (!email || !name) {
    console.error('Set ADMIN_EMAIL and ADMIN_NAME. Example:\n  ADMIN_EMAIL=you@suskii.com ADMIN_NAME="Your Name" npm run admin:create');
    process.exit(1);
}
const generated = !process.env.ADMIN_PASSWORD;
const password = process.env.ADMIN_PASSWORD ?? `${randomToken(12)}-Aa1!`;

const db = await getDb();
await migrate(db);
try {
    const user = await createFirstAdmin(db, { email, name, password });
    console.log(`Created Super Admin ${user.email}.`);
    if (generated) console.log(`One-time password (shown once — change it after signing in):\n  ${password}`);
} catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
}
await db.close();
