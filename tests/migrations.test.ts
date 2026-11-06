import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate, splitSql } from '../server/migrate.js';
import { SECTIONS } from '../server/cms/schema.js';
import { freshDb } from './helpers.js';

describe('database migrations', () => {
    it('apply cleanly and are idempotent', async () => {
        const db = await freshDb();
        const applied = await db.query<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`);
        expect(applied.map((r) => r.version)).toEqual(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => f.replace(/\.sql$/, '')));
        // Running again applies nothing and does not fail.
        expect(await migrate(db)).toEqual([]);
        const sections = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM cms_entries WHERE collection = 'section'`);
        expect(sections?.n).toBe(SECTIONS.length);
        const platforms = await db.query<{ platform: string; mode: string }>(`SELECT platform, mode FROM platform_integrations ORDER BY platform`);
        expect(platforms).toEqual([
            { platform: 'errands', mode: 'not_configured' },
            { platform: 'marketplace', mode: 'not_configured' },
            { platform: 'travel_tour', mode: 'not_configured' },
        ]);
    });

    it('seed imports the current website content as published version 1, once', async () => {
        const db = await freshDb();
        await migrate(db);
        const rows = await db.query<{ status: string; version: number; same: boolean }>(`SELECT status, version, draft = published AS same FROM cms_entries WHERE collection = 'section'`);
        expect(rows.every((r) => r.status === 'published' && r.version === 1 && r.same)).toBe(true);
    });

    it('contain no destructive statements', () => {
        for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
            const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(/--.*$/gm, '');
            for (const stmt of splitSql(sql)) {
                expect(stmt, `${file}: ${stmt.slice(0, 80)}`).not.toMatch(/\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN)\b/i);
                expect(stmt, file).not.toMatch(/\bTRUNCATE\b/i);
                expect(stmt, file).not.toMatch(/\bDELETE\s+FROM\b/i);
                if (/^\s*CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(stmt)) expect(stmt, file).toMatch(/IF NOT EXISTS/i);
            }
        }
    });
});
