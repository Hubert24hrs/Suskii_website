/**
 * Pulls records from a live platform adapter into central reference tables.
 * Incremental (updated_since the last successful run), bounded by page count and a time budget so a
 * serverless invocation never times out mid-write; an unfinished run is recorded as 'partial'.
 * Demo mode is never synchronised — demo data is generated on the fly and never stored.
 */
import type { PlatformId } from '../config.js';
import type { Db } from '../db.js';
import { notify } from '../notify.js';
import { integrationRow, resolve } from './registry.js';
import { upsertRecord } from './references.js';
import { IntegrationError, type Resource, SYNCED } from './types.js';

export interface SyncOptions {
    resources?: Resource[];
    trigger: 'manual' | 'cron' | 'webhook';
    userId?: string | null;
    maxPages?: number;
    timeBudgetMs?: number;
    fetchImpl?: typeof fetch;
}

export interface SyncSummary {
    platform: PlatformId;
    status: 'succeeded' | 'failed' | 'partial' | 'skipped';
    message: string;
    jobs: { resource: Resource; status: string; fetched: number; upserted: number; error?: string }[];
}

async function log(db: Db, jobId: string | null, platform: PlatformId, level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown> = {}) {
    await db.query(`INSERT INTO sync_logs (sync_job_id, platform, level, message, data) VALUES ($1, $2, $3, $4, $5)`, [jobId, platform, level, message.slice(0, 500), JSON.stringify(data)]);
}

export async function healthCheck(db: Db, platform: PlatformId, fetchImpl?: typeof fetch) {
    const r = resolve(await integrationRow(db, platform), fetchImpl);
    if (!r.adapter) return { ok: false, state: r.state, message: r.reason, latencyMs: 0 };
    if (r.mode === 'demo') return { ok: true, state: 'demo' as const, message: 'Demo mode: synthetic data, not a real connection', latencyMs: 0 };
    await db.query(`UPDATE platform_integrations SET status = 'connecting', updated_at = now() WHERE platform = $1`, [platform]);
    const h = await r.adapter.health();
    const state = h.ok ? 'connected' : 'disconnected';
    await db.query(
        `UPDATE platform_integrations SET status = $2, last_health_at = now(), last_health_ok = $3, last_health_message = $4, updated_at = now() WHERE platform = $1`,
        [platform, state, h.ok, h.message],
    );
    return { ...h, state };
}

export async function syncPlatform(db: Db, platform: PlatformId, opts: SyncOptions): Promise<SyncSummary> {
    const r = resolve(await integrationRow(db, platform), opts.fetchImpl);
    if (r.mode === 'demo') return { platform, status: 'skipped', message: 'Demo mode data is generated on the fly and is never synchronised or stored.', jobs: [] };
    if (!r.adapter) return { platform, status: 'skipped', message: r.reason, jobs: [] };

    const started = Date.now();
    const budget = opts.timeBudgetMs ?? 45_000;
    const maxPages = opts.maxPages ?? 50;
    const resources = (opts.resources ?? SYNCED).filter((res) => r.adapter!.capabilities.includes(res) && SYNCED.includes(res));
    // 'transactions' and 'payments' overlap on most APIs; sync payments only if transactions is unavailable.
    const plan = resources.filter((res) => !(res === 'payments' && resources.includes('transactions')));
    const summary: SyncSummary = { platform, status: 'succeeded', message: '', jobs: [] };

    for (const resource of plan) {
        const job = await db.one<{ id: string }>(
            `INSERT INTO sync_jobs (platform, resource, trigger, status, started_at, requested_by) VALUES ($1, $2, $3, 'running', now(), $4) RETURNING id`,
            [platform, resource, opts.trigger, opts.userId ?? null],
        );
        const last = await db.one<{ started_at: Date }>(
            `SELECT started_at FROM sync_jobs WHERE platform = $1 AND resource = $2 AND status = 'succeeded' ORDER BY started_at DESC LIMIT 1`, [platform, resource],
        );
        let cursor: string | null = null;
        let fetched = 0, upserted = 0, pages = 0;
        let status: 'succeeded' | 'failed' | 'partial' = 'succeeded';
        let error: string | undefined;
        try {
            do {
                if (Date.now() - started > budget || pages >= maxPages) { status = 'partial'; break; }
                const page = await r.adapter.list(resource, { cursor, pageSize: 100, updatedSince: last ? new Date(last.started_at).toISOString() : null });
                pages++;
                fetched += page.items.length;
                for (const item of page.items) {
                    await upsertRecord(db, resource, item);
                    upserted++;
                }
                cursor = page.nextCursor;
            } while (cursor);
        } catch (e) {
            status = 'failed';
            error = e instanceof IntegrationError ? `${e.code}: ${e.message}` : (e as Error).message;
            await log(db, job!.id, platform, 'error', `Sync of ${resource} failed`, { error });
        }
        await db.query(
            `UPDATE sync_jobs SET status = $2, finished_at = now(), records_fetched = $3, records_upserted = $4, error = $5 WHERE id = $1`,
            [job!.id, status, fetched, upserted, error ?? null],
        );
        if (status !== 'failed') await log(db, job!.id, platform, status === 'partial' ? 'warn' : 'info', `Synced ${resource}: ${upserted} records${status === 'partial' ? ' (partial, will continue next run)' : ''}`);
        summary.jobs.push({ resource, status, fetched, upserted, error });
    }

    const failed = summary.jobs.filter((x) => x.status === 'failed').length;
    const partial = summary.jobs.some((x) => x.status === 'partial');
    summary.status = failed === summary.jobs.length && failed > 0 ? 'failed' : failed > 0 || partial ? 'partial' : 'succeeded';
    const state = summary.status === 'failed' ? 'sync_failed' : failed > 0 ? 'degraded' : 'connected';
    await db.query(
        `UPDATE platform_integrations SET status = $2, last_sync_at = now(), last_sync_ok_at = CASE WHEN $3 THEN now() ELSE last_sync_ok_at END, updated_at = now() WHERE platform = $1`,
        [platform, state, summary.status !== 'failed'],
    );
    summary.message = `${summary.jobs.reduce((a, x) => a + x.upserted, 0)} records synchronised${failed ? `, ${failed} resource(s) failed` : ''}`;
    if (failed) {
        await notify(db, { type: 'sync.failed', severity: summary.status === 'failed' ? 'error' : 'warning', title: `${r.name}: synchronisation ${summary.status === 'failed' ? 'failed' : 'partly failed'}`,
            body: summary.jobs.filter((x) => x.error).map((x) => `${x.resource}: ${x.error}`).join('\n'), link: '/admin/integrations', permission: 'integrations.read', platform });
    }
    return summary;
}
