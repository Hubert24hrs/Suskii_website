import { audit } from '../audit.js';
import { requireAdmin } from '../auth/session.js';
import { demoAllowed, PLATFORM_IDS, PLATFORM_NAMES, siteOrigin, type PlatformId } from '../config.js';
import { badRequest, forbidden, json, pagination, readJson, type Router } from '../http.js';
import { encrypt } from '../security.js';
import { aggregatesFor, listRecords, resolveScope } from '../reporting/dataset.js';
import { computeOverview } from '../reporting/metrics.js';
import { integrationRow, publicIntegration, resolve, resolveAll } from '../integrations/registry.js';
import { healthCheck, syncPlatform } from '../integrations/sync.js';
import { BASE_SPECS, sanitizeOverrides } from '../integrations/adapters/platforms.js';
import { CAPABILITIES, type Resource } from '../integrations/types.js';
import { EVENT_RESOURCE } from '../integrations/webhooks.js';
import { bool, httpUrl, int, oneOf, optStr, str } from '../validate.js';

const RANGE_PRESETS = { today: 0, '7d': 6, '30d': 29, '90d': 89 } as const;

export function parseRange(url: URL): { from: Date; to: Date; preset: string } {
    const preset = url.searchParams.get('range') ?? '30d';
    const now = new Date();
    if (preset === 'custom') {
        const from = new Date(url.searchParams.get('from') ?? '');
        const to = new Date(url.searchParams.get('to') ?? '');
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Choose a valid start and end date.');
        if (to < from) throw badRequest('The end date must be after the start date.');
        if (to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest('Custom ranges can be at most 400 days.');
        return { from: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())), to: new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999)), preset };
    }
    const back = RANGE_PRESETS[preset as keyof typeof RANGE_PRESETS];
    if (back === undefined) throw badRequest('Unknown date range.');
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    return { from, to: now, preset };
}

function platformParam(url: URL): PlatformId | 'all' {
    const p = url.searchParams.get('platform') ?? 'all';
    if (p === 'all') return 'all';
    return oneOf(p, 'platform', PLATFORM_IDS);
}

const RESOURCES: Resource[] = ['users', 'sellers', 'providers', 'services', 'packages', 'orders', 'requests', 'bookings', 'transactions', 'payments', 'commissions', 'refunds', 'disputes'];
const FINANCIAL = new Set<Resource>(['transactions', 'payments', 'commissions', 'refunds']);

export function dataRoutes(r: Router): void {
    r.get('/api/overview', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'overview.read');
        const range = parseRange(ctx.url);
        const requested = platformParam(ctx.url);
        if (requested !== 'all' && !admin.platforms.includes(requested)) throw forbidden('You do not have access to this platform.');
        const scope = await resolveScope(db, admin.platforms, requested, ctx.url.searchParams.get('data'));
        const agg = await aggregatesFor(db, scope, range.from, range.to);
        const overview = computeOverview(agg, range, scope.platforms);
        // Financial figures need finance.read; operational counts stay visible to platform managers.
        if (!admin.permissions.has('finance.read')) {
            for (const k of ['grossTransactionValue', 'platformRevenue', 'refundAmount', 'commissions', 'pendingPaymentsAmount'] as const) (overview.metrics as Record<string, unknown>)[k] = null;
            (overview.charts as Record<string, unknown>).revenueTrend = null;
            (overview.charts as Record<string, unknown>).revenueContribution = null;
        }
        return json({ range: { from: range.from, to: range.to, preset: range.preset, timezone: 'UTC' }, scope, ...overview, capabilities: CAPABILITIES, generatedAt: new Date() });
    });

    r.get('/api/records/:resource', async (ctx) => {
        const resource = oneOf(ctx.params.resource, 'resource', RESOURCES);
        const { db, admin } = await requireAdmin(ctx, ...(FINANCIAL.has(resource) ? ['finance.read' as const] : []));
        const requested = platformParam(ctx.url);
        if (requested !== 'all' && !admin.platforms.includes(requested)) throw forbidden('You do not have access to this platform.');
        if (!admin.platforms.length) throw forbidden('You do not have access to any platform data.');
        const scope = await resolveScope(db, admin.platforms, requested, ctx.url.searchParams.get('data'));
        const { page, pageSize } = pagination(ctx.url, { pageSize: 25 });
        const sp = ctx.url.searchParams;
        let from: Date | null = null, to: Date | null = null;
        if (sp.get('range') && sp.get('range') !== 'all') ({ from, to } = parseRange(ctx.url));
        const result = await listRecords(db, scope, {
            resource, from, to, page, pageSize,
            status: optStr(sp.get('status'), 'status', { max: 40 }),
            currency: optStr(sp.get('currency'), 'currency', { max: 3, pattern: /^[A-Z]{3}$/ }),
            q: optStr(sp.get('q'), 'q', { max: 80 }),
        });
        return json({ ...result, page, pageSize, scope, resource, capabilities: Object.fromEntries(PLATFORM_IDS.map((p) => [p, CAPABILITIES[p]])) });
    });

    // ─── Integrations ───
    r.get('/api/integrations', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'integrations.read');
        const integrations = (await resolveAll(db)).map(publicIntegration);
        return json({
            integrations,
            contracts: Object.fromEntries(PLATFORM_IDS.map((p) => [p, { name: PLATFORM_NAMES[p], endpoints: BASE_SPECS[p].endpoints, pagination: BASE_SPECS[p].pagination, healthPath: BASE_SPECS[p].healthPath }])),
            webhook: { urlTemplate: `${siteOrigin()}/api/webhooks/{platform}`, events: Object.keys(EVENT_RESOURCE), toleranceSeconds: 300 },
            demoAllowed: demoAllowed(),
        });
    });

    r.put('/api/integrations/:platform', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'integrations.manage');
        const platform = oneOf(ctx.params.platform, 'platform', PLATFORM_IDS);
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const mode = oneOf(body.mode, 'mode', ['not_configured', 'demo', 'live'] as const);
        if (mode === 'demo' && !demoAllowed()) throw badRequest('Demo mode is disabled in production. Set ALLOW_DEMO_MODE_IN_PRODUCTION=true only for a clearly labelled demo environment.');
        const enabled = bool(body.enabled, 'enabled');
        const apiUrl = body.apiUrl ? httpUrl(body.apiUrl, 'apiUrl', { allowHttp: false }) : '';
        const authType = oneOf(body.authType, 'authType', ['none', 'bearer', 'api_key_header', 'basic'] as const);
        const authHeader = optStr(body.authHeader, 'authHeader', { max: 60, pattern: /^[A-Za-z0-9-]+$/ }) ?? 'X-API-Key';
        const timeoutMs = body.timeoutMs === undefined ? 10_000 : int(body.timeoutMs, 'timeoutMs', { min: 2000, max: 30000 });
        const syncIntervalMinutes = body.syncIntervalMinutes === undefined ? 60 : int(body.syncIntervalMinutes, 'syncIntervalMinutes', { min: 15, max: 1440 });
        const overrides = sanitizeOverrides(platform, body.overrides);
        const row = await integrationRow(db, platform);
        const config = { ...row.config, timeoutMs, syncIntervalMinutes, overrides };
        const status = mode === 'demo' ? 'demo' : mode === 'not_configured' ? 'not_configured' : 'disconnected';
        await db.query(
            `UPDATE platform_integrations SET mode = $2, enabled = $3, api_url = $4, auth_type = $5, auth_header = $6, config = $7, status = $8,
                 last_health_ok = CASE WHEN mode <> $2 OR api_url <> $4 THEN NULL ELSE last_health_ok END, updated_by = $9, updated_at = now() WHERE platform = $1`,
            [platform, mode, enabled, apiUrl, authType, authHeader, JSON.stringify(config), status, admin.user.id],
        );
        await audit(db, ctx, admin.user, { action: 'integration.update', targetType: 'integration', targetId: platform, metadata: { mode, enabled, apiUrl, authType, timeoutMs, syncIntervalMinutes } });
        return json({ integration: publicIntegration(resolve(await integrationRow(db, platform))) });
    });

    r.put('/api/integrations/:platform/secrets', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'integrations.manage');
        const platform = oneOf(ctx.params.platform, 'platform', PLATFORM_IDS);
        const body = await readJson<{ credential?: unknown; webhookSecret?: unknown; clear?: unknown }>(ctx.req);
        const sets: string[] = [];
        const params: unknown[] = [platform];
        if (body.clear === 'credential' || body.clear === 'webhookSecret') {
            sets.push(body.clear === 'credential' ? 'credentials_enc = NULL' : 'webhook_secret_enc = NULL');
        }
        if (body.credential !== undefined) { params.push(encrypt(str(body.credential, 'credential', { max: 4000, trim: false }))); sets.push(`credentials_enc = $${params.length}`); }
        if (body.webhookSecret !== undefined) {
            const secret = str(body.webhookSecret, 'webhookSecret', { min: 24, max: 500, trim: false, message: 'Webhook secrets must be at least 24 characters' });
            params.push(encrypt(secret)); sets.push(`webhook_secret_enc = $${params.length}`);
        }
        if (!sets.length) throw badRequest('Nothing to update.');
        params.push(admin.user.id);
        await db.query(`UPDATE platform_integrations SET ${sets.join(', ')}, updated_by = $${params.length}, updated_at = now() WHERE platform = $1`, params);
        await audit(db, ctx, admin.user, { action: 'integration.secrets', targetType: 'integration', targetId: platform, metadata: { credential: body.credential !== undefined, webhookSecret: body.webhookSecret !== undefined, cleared: body.clear ?? null } });
        return json({ integration: publicIntegration(resolve(await integrationRow(db, platform))) });
    });

    r.post('/api/integrations/:platform/test', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'integrations.manage');
        const platform = oneOf(ctx.params.platform, 'platform', PLATFORM_IDS);
        const result = await healthCheck(db, platform);
        await audit(db, ctx, admin.user, { action: 'integration.test', targetType: 'integration', targetId: platform, outcome: result.ok ? 'success' : 'failure', metadata: { state: result.state, message: result.message } });
        return json({ result, integration: publicIntegration(resolve(await integrationRow(db, platform))) });
    });

    r.post('/api/integrations/:platform/sync', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'integrations.sync');
        const platform = oneOf(ctx.params.platform, 'platform', PLATFORM_IDS);
        const summary = await syncPlatform(db, platform, { trigger: 'manual', userId: admin.user.id, timeBudgetMs: 40_000 });
        await audit(db, ctx, admin.user, { action: 'integration.sync', targetType: 'integration', targetId: platform, outcome: summary.status === 'failed' ? 'failure' : 'success', metadata: { status: summary.status, message: summary.message } });
        return json({ summary, integration: publicIntegration(resolve(await integrationRow(db, platform))) });
    });

    r.get('/api/integrations/:platform/history', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'integrations.read');
        const platform = oneOf(ctx.params.platform, 'platform', PLATFORM_IDS);
        const [deliveries, events, jobs, logs] = await Promise.all([
            db.query(`SELECT id, received_at, event_id, event_type, signature_valid, outcome, reason, http_status FROM webhook_deliveries WHERE platform = $1 ORDER BY received_at DESC LIMIT 50`, [platform]),
            db.query(`SELECT id, event_id, event_type, received_at, status, attempts, processed_at, error FROM platform_events WHERE platform = $1 ORDER BY received_at DESC LIMIT 50`, [platform]),
            db.query(`SELECT id, resource, trigger, status, started_at, finished_at, records_fetched, records_upserted, error FROM sync_jobs WHERE platform = $1 ORDER BY created_at DESC LIMIT 50`, [platform]),
            db.query(`SELECT id, at, level, message FROM sync_logs WHERE platform = $1 ORDER BY at DESC LIMIT 100`, [platform]),
        ]);
        return json({ deliveries, events, jobs, logs });
    });

    // ─── Contact inquiries ───
    r.get('/api/inquiries', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'inquiries.read');
        const { pageSize, offset, page } = pagination(ctx.url, { pageSize: 25 });
        const status = ctx.url.searchParams.get('status');
        const params: unknown[] = [];
        let where = 'true';
        if (status && ['new', 'in_progress', 'resolved', 'spam'].includes(status)) { params.push(status); where = `i.status = $1`; }
        const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM contact_inquiries i WHERE ${where}`, params))?.n ?? 0;
        const items = await db.query(`SELECT i.*, u.name AS assigned_name FROM contact_inquiries i LEFT JOIN admin_users u ON u.id = i.assigned_to WHERE ${where} ORDER BY i.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
        const counts = await db.query(`SELECT status, count(*)::int AS n FROM contact_inquiries GROUP BY status`);
        return json({ items: items.map(({ ip_hash: _ip, ...rest }: any) => rest), total, page, pageSize, counts });
    });

    r.patch('/api/inquiries/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'inquiries.manage');
        const id = str(ctx.params.id, 'id', { max: 36 });
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const status = body.status === undefined ? null : oneOf(body.status, 'status', ['new', 'in_progress', 'resolved', 'spam'] as const);
        const notes = body.notes === undefined ? null : optStr(body.notes, 'notes', { max: 4000 }) ?? '';
        const assign = body.assignToMe === true ? admin.user.id : body.assignToMe === false ? 'none' : null;
        await db.query(
            `UPDATE contact_inquiries SET status = coalesce($2, status), notes = coalesce($3, notes),
                 assigned_to = CASE WHEN $4::text = 'none' THEN NULL WHEN $4::text IS NULL THEN assigned_to ELSE $4::uuid END, updated_at = now() WHERE id = $1`,
            [id, status, notes, assign],
        );
        await audit(db, ctx, admin.user, { action: 'inquiry.update', targetType: 'inquiry', targetId: id, metadata: { status, assigned: assign } });
        return json({ ok: true });
    });

    // ─── Careers applications ───
    r.get('/api/applications', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'careers.read');
        const { pageSize, offset, page } = pagination(ctx.url, { pageSize: 25 });
        const status = ctx.url.searchParams.get('status');
        const params: unknown[] = [];
        let where = 'true';
        if (status && ['new', 'reviewing', 'shortlisted', 'rejected', 'hired'].includes(status)) { params.push(status); where = `a.status = $1`; }
        const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM job_applications a WHERE ${where}`, params))?.n ?? 0;
        const items = await db.query(`SELECT a.id, a.job_slug, e.title AS job_title, a.created_at, a.name, a.email, a.phone, a.profile_url, a.cover_letter, a.status, a.notes,
                                             (a.resume_asset_id IS NOT NULL) AS has_resume
                                      FROM job_applications a LEFT JOIN cms_entries e ON e.id = a.job_entry_id WHERE ${where} ORDER BY a.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
        return json({ items, total, page, pageSize });
    });

    r.patch('/api/applications/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'careers.manage');
        const id = str(ctx.params.id, 'id', { max: 36 });
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const status = body.status === undefined ? null : oneOf(body.status, 'status', ['new', 'reviewing', 'shortlisted', 'rejected', 'hired'] as const);
        const notes = body.notes === undefined ? null : optStr(body.notes, 'notes', { max: 4000 }) ?? '';
        await db.query(`UPDATE job_applications SET status = coalesce($2, status), notes = coalesce($3, notes), updated_at = now() WHERE id = $1`, [id, status, notes]);
        await audit(db, ctx, admin.user, { action: 'application.update', targetType: 'application', targetId: id, metadata: { status } });
        return json({ ok: true });
    });

    r.get('/api/applications/:id/resume', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'careers.read');
        const id = str(ctx.params.id, 'id', { max: 36 });
        const row = await db.one<{ resume_asset_id: string | null; name: string }>(`SELECT resume_asset_id, name FROM job_applications WHERE id = $1`, [id]);
        if (!row?.resume_asset_id) throw badRequest('This application has no CV.');
        const { readDocument } = await import('../media/service.js');
        const doc = await readDocument(db, row.resume_asset_id);
        await audit(db, ctx, admin.user, { action: 'application.download_cv', targetType: 'application', targetId: id });
        return new Response(Buffer.from(doc.bytes), {
            headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${doc.filename.replace(/"/g, '')}"`, 'Cache-Control': 'no-store' },
        });
    });
}
