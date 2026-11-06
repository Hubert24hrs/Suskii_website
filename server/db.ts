/**
 * Database access. Production uses PostgreSQL through `pg` (DATABASE_URL=postgres://…).
 * Local development and tests can use embedded PostgreSQL (PGlite) with
 * DATABASE_URL=pglite:memory or DATABASE_URL=pglite:./.data/pglite — same SQL, same migrations.
 */
import { databaseUrl } from './config.js';
import { unavailable } from './http.js';

export interface Db {
    readonly kind: 'pg' | 'pglite';
    query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
    one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | undefined>;
    tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

function wrap(kind: Db['kind'], q: Queryable, txImpl: Db['tx'], close: () => Promise<void>): Db {
    const db: Db = {
        kind,
        async query(sql, params = []) {
            const r = await q.query(sql, params as unknown[]);
            return r.rows;
        },
        async one(sql, params = []) {
            const rows = await db.query(sql, params);
            return rows[0] as any;
        },
        tx: txImpl,
        close,
    };
    return db;
}

async function createPg(url: string): Promise<Db> {
    const pg = await import('pg');
    const Pool = (pg.default ?? pg).Pool;
    const types = (pg.default ?? pg).types;
    // bigint and numeric as JS numbers (amounts are integer minor units, well within 2^53)
    types.setTypeParser(20, (v: string) => Number(v));
    types.setTypeParser(1700, (v: string) => Number(v));
    const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 });
    const tx: Db['tx'] = async (fn) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const inner = wrap('pg', client, (f) => f(inner), async () => {});
            const out = await fn(inner);
            await client.query('COMMIT');
            return out;
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
    };
    return wrap('pg', pool, tx, () => pool.end());
}

async function createPglite(target: string): Promise<Db> {
    const { PGlite } = await import('@electric-sql/pglite');
    const parsers = { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) };
    const dataDir = target === 'memory' || target === '' ? undefined : target;
    const lite = new PGlite(dataDir, { parsers });
    await lite.waitReady;
    // PGlite runs a single connection; serialise transactions on it. Nested tx() calls reuse the open one.
    let chain: Promise<unknown> = Promise.resolve();
    const tx: Db['tx'] = (fn) => {
        const run = chain.then(() =>
            lite.transaction(async (t) => {
                const inner: Db = wrap('pglite', t, (f) => f(inner), async () => {});
                return fn(inner);
            }),
        );
        chain = run.catch(() => {});
        return run;
    };
    return wrap('pglite', lite, tx, () => lite.close());
}

const g = globalThis as unknown as { __suskiiDb?: Promise<Db> };

export function getDb(): Promise<Db> {
    const url = databaseUrl();
    if (!url) throw unavailable('The admin database is not configured (DATABASE_URL is empty).');
    if (!g.__suskiiDb) {
        g.__suskiiDb = (url.startsWith('pglite:') ? createPglite(url.slice('pglite:'.length)) : createPg(url)).catch((e) => {
            g.__suskiiDb = undefined;
            throw e;
        });
    }
    return g.__suskiiDb;
}

/** For tests: replace or reset the shared connection. */
export async function resetDb(): Promise<void> {
    const current = g.__suskiiDb;
    g.__suskiiDb = undefined;
    if (current) await (await current).close().catch(() => {});
}
