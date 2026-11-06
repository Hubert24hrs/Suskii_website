import { cronSecret, isDatabaseConfigured, isProduction, PLATFORM_IDS } from '../config.js';
import { getDb } from '../db.js';
import { badRequest, forbidden, json, readJson, readText, type Router, unauthorized } from '../http.js';
import { enqueue, runDueJobs } from '../jobs.js';
import { notify } from '../notify.js';
import { rateLimit } from '../auth/session.js';
import { MAX_UPLOAD_BYTES, storeDocument } from '../media/service.js';
import { runScheduledPublishing, triggerRebuild } from '../cms/service.js';
import { receiveWebhook } from '../integrations/webhooks.js';
import { resolveAll } from '../integrations/registry.js';
import { ipFingerprint, safeEqual } from '../security.js';
import { email, httpUrl, oneOf, optStr, slug, str } from '../validate.js';

const TOPICS = ['general', 'marketplace', 'errands', 'travel_tour', 'partnership', 'press'] as const;

/** Accepts JSON (fetch) or urlencoded (no-JS form post). */
async function formFields(req: Request): Promise<{ fields: Record<string, string>; html: boolean }> {
    const type = req.headers.get('content-type') ?? '';
    if (type.includes('application/json')) return { fields: await readJson<Record<string, string>>(req, 50_000), html: false };
    if (type.includes('application/x-www-form-urlencoded')) return { fields: Object.fromEntries(new URLSearchParams(await readText(req, 50_000))), html: true };
    throw badRequest('Unsupported form encoding');
}

const redirect = (to: string) => new Response(null, { status: 303, headers: { Location: to } });

export function publicRoutes(r: Router): void {
    r.get('/api/health', async () => {
        if (!isDatabaseConfigured()) return json({ ok: true, admin: 'not_configured' });
        try {
            const db = await getDb();
            await db.query('SELECT 1');
            return json({ ok: true, admin: 'ready' });
        } catch {
            return json({ ok: false, admin: 'database_unreachable' }, { status: 503 });
        }
    });

    r.post('/api/public/inquiries', async (ctx) => {
        const { fields, html } = await formFields(ctx.req);
        if (fields.website) return html ? redirect('/?inquiry=sent#contact') : json({ ok: true }); // honeypot: pretend success
        const db = await getDb();
        try {
            await rateLimit(db, `inquiry:ip:${ctx.ip}`, 5, 60 * 60);
            const name = str(fields.name, 'name', { max: 120 });
            const from = email(fields.email);
            const phone = optStr(fields.phone, 'phone', { max: 40, pattern: /^[+\d\s()-]*$/ });
            const topic = oneOf(fields.topic || 'general', 'topic', TOPICS);
            const message = str(fields.message, 'message', { min: 10, max: 4000, message: 'Please write a message of at least 10 characters' });
            const row = await db.one<{ id: string }>(`INSERT INTO contact_inquiries (name, email, phone, topic, message, ip_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [name, from, phone, topic, message, ipFingerprint(ctx.ip)]);
            await notify(db, { type: 'inquiry.new', title: `New contact inquiry from ${name}`, body: message.slice(0, 160), link: `/admin/inquiries?id=${row!.id}`, permission: 'inquiries.read' });
        } catch (e) {
            if (html) return redirect('/?inquiry=error#contact');
            throw e;
        }
        return html ? redirect('/?inquiry=sent#contact') : json({ ok: true, message: 'Thank you. Your message has been sent and our team will reply by email.' });
    });

    r.post('/api/public/applications', async (ctx) => {
        const type = ctx.req.headers.get('content-type') ?? '';
        if (!type.includes('multipart/form-data')) throw badRequest('Applications must be sent as a form with a CV attached.');
        const declared = Number(ctx.req.headers.get('content-length') ?? '0');
        if (declared > MAX_UPLOAD_BYTES + 100_000) throw badRequest('Your CV must be 4 MB or smaller.');
        const form = await ctx.req.formData();
        const get = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : '');
        const back = (state: string) => redirect(`/careers/${encodeURIComponent(get('job') || '')}/?application=${state}#apply-title`);
        const wantsHtml = !(ctx.req.headers.get('accept') ?? '').includes('application/json');
        if (get('website')) return wantsHtml ? back('sent') : json({ ok: true });
        const db = await getDb();
        try {
            await rateLimit(db, `apply:ip:${ctx.ip}`, 5, 60 * 60);
            const jobSlug = slug(get('job'), 'job');
            const job = await db.one<{ id: string; published: Record<string, unknown> | null }>(`SELECT id, published FROM cms_entries WHERE collection = 'job' AND key = $1 AND deleted_at IS NULL`, [jobSlug]);
            if (!job?.published || !job.published.applyOpen) throw badRequest('This role is not accepting applications.');
            if (job.published.closingDate && new Date(`${job.published.closingDate}T23:59:59Z`).getTime() < Date.now()) throw badRequest('Applications for this role have closed.');
            const name = str(get('name'), 'name', { max: 120 });
            const from = email(get('email'));
            const phone = optStr(get('phone'), 'phone', { max: 40, pattern: /^[+\d\s()-]*$/ });
            const profileUrl = get('profileUrl') ? httpUrl(get('profileUrl'), 'profileUrl') : null;
            const cover = optStr(get('coverLetter'), 'coverLetter', { max: 6000 }) ?? '';
            const file = form.get('resume');
            if (!(file instanceof File) || file.size === 0) throw badRequest('Attach your CV as a PDF.');
            if (file.size > MAX_UPLOAD_BYTES) throw badRequest('Your CV must be 4 MB or smaller.');
            const resumeId = await storeDocument(db, { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name || 'cv.pdf' });
            const row = await db.one<{ id: string }>(
                `INSERT INTO job_applications (job_entry_id, job_slug, name, email, phone, profile_url, cover_letter, resume_asset_id, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [job.id, jobSlug, name, from, phone, profileUrl, cover, resumeId, ipFingerprint(ctx.ip)]);
            await notify(db, { type: 'application.new', title: `New application: ${String(job.published.title ?? jobSlug)}`, body: `${name} applied.`, link: `/admin/careers?id=${row!.id}`, permission: 'careers.read' });
        } catch (e) {
            if (wantsHtml) return back('error');
            throw e;
        }
        return wantsHtml ? back('sent') : json({ ok: true, message: 'Thank you. Your application has been received.' });
    });

    r.post('/api/webhooks/:platform', async (ctx) => receiveWebhook(await getDb(), ctx.params.platform, ctx.req, ctx.ip));

    /**
     * Scheduled maintenance (Vercel Cron sends Authorization: Bearer $CRON_SECRET):
     * scheduled publishing, durable job processing and periodic synchronisation of live platforms.
     */
    r.get('/api/cron', async (ctx) => {
        const secret = cronSecret();
        if (!secret) {
            if (isProduction()) throw forbidden('CRON_SECRET is not configured');
        } else if (!safeEqual(ctx.req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
            throw unauthorized('Invalid cron credentials');
        }
        const db = await getDb();
        const published = await runScheduledPublishing(db);
        const rebuild = published ? await triggerRebuild(db, `scheduled publishing (${published})`) : null;
        for (const r of await resolveAll(db)) {
            if (r.mode !== 'live' || !r.adapter) continue;
            const interval = Number(r.row.config?.syncIntervalMinutes) || 60;
            const due = !r.row.last_sync_at || Date.now() - new Date(r.row.last_sync_at).getTime() > interval * 60_000;
            const pending = await db.one(`SELECT 1 FROM background_jobs WHERE type = 'sync_platform' AND status IN ('queued', 'running') AND payload->>'platform' = $1`, [r.platform]);
            if (due && !pending) await enqueue(db, 'sync_platform', { platform: r.platform }, { maxAttempts: 3 });
        }
        const jobs = await runDueJobs(db, { budgetMs: 45_000 });
        return json({ ok: true, published, rebuild, jobs, platforms: PLATFORM_IDS.length });
    });
}
