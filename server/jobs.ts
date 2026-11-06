/**
 * Durable background jobs backed by PostgreSQL. Claimed with FOR UPDATE SKIP LOCKED so concurrent
 * workers (cron + request-time processing) never run the same job twice; failures retry with backoff.
 */
import type { Db } from './db.js';
import { notify } from './notify.js';

export type JobHandler = (db: Db, payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, handler: JobHandler): void {
    handlers.set(type, handler);
}

export async function enqueue(db: Db, type: string, payload: Record<string, unknown>, opts: { delaySeconds?: number; maxAttempts?: number } = {}): Promise<string> {
    const row = await db.one<{ id: string }>(
        `INSERT INTO background_jobs (type, payload, run_after, max_attempts) VALUES ($1, $2, now() + make_interval(secs => $3::int), $4) RETURNING id`,
        [type, JSON.stringify(payload), opts.delaySeconds ?? 0, opts.maxAttempts ?? 5],
    );
    return row!.id;
}

export async function runDueJobs(db: Db, opts: { limit?: number; budgetMs?: number } = {}): Promise<{ ran: number; failed: number }> {
    const started = Date.now();
    // Recover jobs whose worker died mid-run.
    await db.query(`UPDATE background_jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`);
    const claimed = await db.query<{ id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(
        `UPDATE background_jobs SET status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
         WHERE id IN (SELECT id FROM background_jobs WHERE status = 'queued' AND run_after <= now() ORDER BY run_after LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING id, type, payload, attempts, max_attempts`,
        [opts.limit ?? 20],
    );
    let ran = 0, failed = 0;
    for (const job of claimed) {
        if (Date.now() - started > (opts.budgetMs ?? 40_000)) {
            await db.query(`UPDATE background_jobs SET status = 'queued', attempts = attempts - 1, locked_at = NULL WHERE id = $1`, [job.id]);
            continue;
        }
        const handler = handlers.get(job.type);
        try {
            if (!handler) throw new Error(`No handler for job type ${job.type}`);
            await handler(db, job.payload);
            await db.query(`UPDATE background_jobs SET status = 'succeeded', locked_at = NULL, last_error = NULL, updated_at = now() WHERE id = $1`, [job.id]);
            ran++;
        } catch (e) {
            failed++;
            const message = (e as Error).message.slice(0, 1000);
            const final = job.attempts >= job.max_attempts;
            await db.query(
                `UPDATE background_jobs SET status = $2, locked_at = NULL, last_error = $3, run_after = now() + make_interval(secs => $4::int), updated_at = now() WHERE id = $1`,
                [job.id, final ? 'failed' : 'queued', message, Math.min(3600, 30 * 2 ** job.attempts)],
            );
            if (final) await notify(db, { type: 'job.failed', severity: 'error', title: `Background job failed: ${job.type}`, body: message, link: '/admin/integrations', permission: 'integrations.read' });
        }
    }
    return { ran, failed };
}
