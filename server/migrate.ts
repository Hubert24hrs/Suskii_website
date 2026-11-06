/**
 * Forward-only, transactional migration runner. Applied versions are recorded in schema_migrations.
 * Migrations are additive by policy (enforced by tests): no DROP TABLE / DROP COLUMN / TRUNCATE.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import { syncRbac } from './auth/rbac.js';
import { seedCmsDefaults } from './cms/service.js';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

export async function migrate(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await db.query<{ version: string }>('SELECT version FROM schema_migrations')).map((r) => r.version));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const ran: string[] = [];
    for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (applied.has(version)) continue;
        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
        await db.tx(async (t) => {
            for (const statement of splitSql(sql)) await t.query(statement);
            await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        });
        log(`applied ${version}`);
        ran.push(version);
    }
    await db.tx(async (t) => {
        await syncRbac(t);
        await seedCmsDefaults(t);
    });
    return ran;
}

/** Splits on semicolons that end a statement (outside quotes and comments). */
export function splitSql(sql: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inSingle = false;
    let inLineComment = false;
    for (let i = 0; i < sql.length; i++) {
        const c = sql[i];
        const next = sql[i + 1];
        if (inLineComment) {
            if (c === '\n') inLineComment = false;
            continue;
        }
        if (!inSingle && c === '-' && next === '-') { inLineComment = true; continue; }
        if (c === "'") inSingle = !inSingle;
        if (c === ';' && !inSingle) {
            if (cur.trim()) out.push(cur.trim());
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}
