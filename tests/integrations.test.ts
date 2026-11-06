import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../server/db.js';
import { encrypt } from '../server/security.js';
import { demoAllowed } from '../server/config.js';
import { integrationRow, resolve } from '../server/integrations/registry.js';
import { MockAdapter, demoRecords } from '../server/integrations/adapters/mock.js';
import { PlatformHttpClient } from '../server/integrations/http-client.js';
import { normalizeTransaction, txStatus } from '../server/integrations/normalize.js';
import { healthCheck, syncPlatform } from '../server/integrations/sync.js';
import { signPayload } from '../server/integrations/webhooks.js';
import { CAPABILITIES, IntegrationError } from '../server/integrations/types.js';
import { computeOverview, emptyAggregates } from '../server/reporting/metrics.js';
import { resolveScope } from '../server/reporting/dataset.js';
import { as, call, createSuperAdmin, freshDb, login, type Session } from './helpers.js';

let db: Db;
let owner: Session;
const SECRET = 'whsec_test_0123456789abcdefghijklmnop';

beforeAll(async () => {
    db = await freshDb();
    await createSuperAdmin(db);
    owner = await login('owner@suskii.test');
});

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function goLive(platform: string, apiUrl = 'https://api.example.test') {
    await db.query(`UPDATE platform_integrations SET mode = 'live', enabled = true, api_url = $2, auth_type = 'bearer', credentials_enc = $3, webhook_secret_enc = $4, status = 'disconnected' WHERE platform = $1`,
        [platform, apiUrl, encrypt('live-token-abcdef'), encrypt(SECRET)]);
}

function webhook(platform: string, event: Record<string, unknown>, { secret = SECRET, ts = Math.floor(Date.now() / 1000), sig }: { secret?: string; ts?: number; sig?: string } = {}) {
    const body = JSON.stringify(event);
    return call('POST', `/api/webhooks/${platform}`, { raw: body, headers: { 'content-type': 'application/json', 'x-suskii-timestamp': String(ts), 'x-suskii-signature': sig ?? signPayload(secret, ts, body) } });
}

describe('reporting rules', () => {
    const agg = () => {
        const a = emptyAggregates();
        a.tx.push(
            { day: '2026-01-01', platform: 'marketplace', type: 'payment', status: 'completed', currency: 'NGN', count: 2, amount: 100_000, fee: 5_000 },
            { day: '2026-01-01', platform: 'marketplace', type: 'payment', status: 'pending', currency: 'NGN', count: 1, amount: 999_999, fee: 50_000 },
            { day: '2026-01-01', platform: 'marketplace', type: 'payment', status: 'failed', currency: 'NGN', count: 1, amount: 777_777, fee: 40_000 },
            { day: '2026-01-01', platform: 'errands', type: 'payment', status: 'completed', currency: 'RWF', count: 1, amount: 15_000, fee: 1_500 },
            { day: '2026-01-01', platform: 'errands', type: 'refund', status: 'completed', currency: 'RWF', count: 1, amount: 2_000, fee: 0 },
        );
        return a;
    };

    it('never counts pending or failed payments as GTV or revenue, and never mixes currencies', () => {
        const { metrics } = computeOverview(agg(), { from: new Date('2026-01-01'), to: new Date('2026-01-01T23:59:59Z') }, ['marketplace', 'errands']);
        expect(metrics.grossTransactionValue).toEqual({ NGN: 100_000, RWF: 15_000 });
        expect(metrics.platformRevenue).toEqual({ NGN: 5_000, RWF: 1_500 });
        expect(metrics.pendingPaymentsAmount).toEqual({ NGN: 999_999 });
        expect(metrics.totalTransactions).toBe(5); // five payments; the refund row is not a payment
        expect(metrics.completedTransactions).toBe(3);
        expect(metrics.failedTransactions).toBe(1);
        expect(metrics.refundAmount).toEqual({ RWF: 2_000 });
    });

    it('maps unknown financial statuses to pending so they cannot become revenue', () => {
        expect(txStatus('PAID')).toBe('completed');
        expect(txStatus('weird-status')).toBe('pending');
        expect(txStatus(undefined)).toBe('pending');
    });

    it('converts amounts with each currency’s minor unit and refuses to guess a currency', () => {
        expect(normalizeTransaction('errands', { id: 1, amount: 1500, currency: 'RWF', status: 'completed' }, 'payment').amountMinor).toBe(1500);
        expect(normalizeTransaction('marketplace', { id: 2, amount: '12.34', currency: 'ngn' }, 'payment')).toMatchObject({ amountMinor: 1234, currency: 'NGN' });
        expect(() => normalizeTransaction('marketplace', { id: 3, amount: 10 }, 'payment')).toThrow(/currency/);
    });

    it('strips personal data from preserved attributes', () => {
        const t = normalizeTransaction('marketplace', { id: 4, amount: 1, currency: 'NGN', email: 'a@b.co', phone: '+234', card: '4111', note: 'kept' }, 'payment');
        expect(t.attributes).toEqual({ id: 4, amount: 1, currency: 'NGN', note: 'kept' });
    });

    it('keeps live and demo data apart and explains partial data', async () => {
        await db.query(`UPDATE platform_integrations SET mode = 'demo', status = 'demo' WHERE platform = 'marketplace'`);
        await db.query(`UPDATE platform_integrations SET mode = 'live', enabled = true, api_url = 'https://x.test', auth_type = 'none', last_sync_ok_at = now() WHERE platform = 'errands'`);
        const live = await resolveScope(db, ['marketplace', 'errands', 'travel_tour'], 'all', null);
        expect(live.kind).toBe('live');
        expect(live.platforms).toEqual(['errands']);
        expect(live.availableKinds).toEqual(['live', 'demo']);
        expect(live.warnings.join(' ')).toMatch(/Partial data/);
        const demo = await resolveScope(db, ['marketplace', 'errands', 'travel_tour'], 'all', 'demo');
        expect(demo.platforms).toEqual(['marketplace']);
        expect(demo.warnings[0]).toMatch(/^DEMO MODE/);
        await db.query(`UPDATE platform_integrations SET mode = 'not_configured', status = 'not_configured', last_sync_ok_at = NULL, api_url = '' WHERE platform IN ('marketplace', 'errands')`);
    });

    it('demo mode never silently activates in production', async () => {
        await db.query(`UPDATE platform_integrations SET mode = 'demo' WHERE platform = 'travel_tour'`);
        const row = await integrationRow(db, 'travel_tour');
        process.env.APP_ENV = 'production';
        try {
            expect(demoAllowed()).toBe(false);
            const r = resolve(row);
            expect(r.adapter).toBeNull();
            expect(r.state).toBe('not_configured');
            expect(r.reason).toMatch(/disabled in production/);
            process.env.ALLOW_DEMO_MODE_IN_PRODUCTION = 'true';
            expect(resolve(row).state).toBe('demo');
        } finally {
            process.env.APP_ENV = 'test';
            delete process.env.ALLOW_DEMO_MODE_IN_PRODUCTION;
            await db.query(`UPDATE platform_integrations SET mode = 'not_configured' WHERE platform = 'travel_tour'`);
        }
    });
});

describe('mock adapters', () => {
    it('are deterministic, independent per platform, and clearly marked as demo', async () => {
        const a = demoRecords('marketplace', 'orders', Date.UTC(2026, 0, 31));
        const b = demoRecords('marketplace', 'orders', Date.UTC(2026, 0, 31));
        expect(a).toEqual(b);
        expect(a.every((r) => r.sourceId.startsWith('DEMO-') && r.isDemo)).toBe(true);
        expect(demoRecords('travel_tour', 'bookings').every((r) => r.platform === 'travel_tour')).toBe(true);
        const m = new MockAdapter('travel_tour');
        await expect(m.list('orders')).rejects.toBeInstanceOf(IntegrationError);
        expect(CAPABILITIES.travel_tour).not.toContain('orders');
        expect(CAPABILITIES.marketplace).not.toContain('bookings');
    });

    it('demo data is never written to the reference tables', async () => {
        await db.query(`UPDATE platform_integrations SET mode = 'demo', status = 'demo' WHERE platform = 'marketplace'`);
        const s = await syncPlatform(db, 'marketplace', { trigger: 'manual' });
        expect(s.status).toBe('skipped');
        expect((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM transaction_references`))!.n).toBe(0);
        await db.query(`UPDATE platform_integrations SET mode = 'not_configured', status = 'not_configured' WHERE platform = 'marketplace'`);
    });
});

describe('platform HTTP client and synchronisation', () => {
    it('retries GET on server errors, never retries auth failures, and times out', async () => {
        let calls = 0;
        const flaky = (async () => { calls++; return calls < 2 ? jsonRes({}, 503) : jsonRes({ ok: true }); }) as typeof fetch;
        const c = new PlatformHttpClient({ platform: 'errands', baseUrl: 'https://api.test', authType: 'bearer', authHeader: '', credential: 't', timeoutMs: 2000, maxRetries: 2 }, flaky);
        expect(await c.request('/x')).toEqual({ ok: true });
        expect(calls).toBe(2);

        let authCalls = 0;
        const denied = (async () => { authCalls++; return jsonRes({}, 401); }) as typeof fetch;
        const c2 = new PlatformHttpClient({ platform: 'errands', baseUrl: 'https://api.test', authType: 'bearer', authHeader: '', credential: 't', timeoutMs: 2000, maxRetries: 2 }, denied);
        await expect(c2.request('/x')).rejects.toMatchObject({ code: 'auth' });
        expect(authCalls).toBe(1);

        const hang = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))))) as unknown as typeof fetch;
        const c3 = new PlatformHttpClient({ platform: 'errands', baseUrl: 'https://api.test', authType: 'none', authHeader: '', credential: '', timeoutMs: 50, maxRetries: 0 }, hang);
        await expect(c3.request('/x')).rejects.toMatchObject({ code: 'timeout' });
    });

    it('sends credentials only to the configured platform, never as query parameters', async () => {
        let seen: { url: string; auth: string | null } | null = null;
        const spy = (async (url: string, init: RequestInit) => { seen = { url, auth: new Headers(init.headers).get('authorization') }; return jsonRes({ data: [] }); }) as unknown as typeof fetch;
        const c = new PlatformHttpClient({ platform: 'errands', baseUrl: 'https://api.test/v1', authType: 'bearer', authHeader: '', credential: 'secret-token', timeoutMs: 2000, maxRetries: 0 }, spy);
        await c.request('/users', { query: { limit: 5 } });
        expect(seen!.url).toBe('https://api.test/v1/users?limit=5');
        expect(seen!.auth).toBe('Bearer secret-token');
    });

    it('a failing platform never crashes the admin: health and sync report the failure', async () => {
        await goLive('travel_tour');
        const down = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
        const h = await healthCheck(db, 'travel_tour', down);
        expect(h.ok).toBe(false);
        expect(h.state).toBe('disconnected');
        const s = await syncPlatform(db, 'travel_tour', { trigger: 'manual', fetchImpl: down, resources: ['users'] });
        expect(s.status).toBe('failed');
        const row = await db.one<{ status: string; last_sync_ok_at: Date | null }>(`SELECT status, last_sync_ok_at FROM platform_integrations WHERE platform = 'travel_tour'`);
        expect(row).toMatchObject({ status: 'sync_failed', last_sync_ok_at: null });
        expect((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM central_notifications WHERE type = 'sync.failed'`))!.n).toBeGreaterThan(0);
        // Other platforms and the dashboard keep working.
        expect((await as(owner)('GET', '/api/overview?range=7d')).status).toBe(200);
    }, 20_000);

    it('synchronises pages into reference tables keyed by platform id without duplicates', async () => {
        await goLive('errands');
        const pages: Record<string, unknown> = {
            first: { data: [{ id: 'P1', amount: 1000, currency: 'RWF', status: 'completed', fee: 100 }, { id: 'P2', amount: 500, currency: 'RWF', status: 'pending' }], next_cursor: 'c2' },
            c2: { data: [{ id: 'P3', amount: 700, currency: 'NGN', status: 'failed' }, { id: 'BAD', amount: 1 }], next_cursor: null },
        };
        const api = (async (url: string) => jsonRes(pages[new URL(url).searchParams.get('cursor') ?? 'first'])) as unknown as typeof fetch;
        const s1 = await syncPlatform(db, 'errands', { trigger: 'manual', fetchImpl: api, resources: ['transactions'] });
        expect(s1.status).toBe('succeeded');
        await syncPlatform(db, 'errands', { trigger: 'manual', fetchImpl: api, resources: ['transactions'] });
        const rows = await db.query<{ source_id: string; status: string; currency: string }>(`SELECT source_id, status, currency FROM transaction_references WHERE platform = 'errands' ORDER BY source_id`);
        expect(rows.map((r) => r.source_id)).toEqual(['P1', 'P2', 'P3']); // BAD (no currency) skipped, no duplicates
        const ov = await as(owner)('GET', '/api/overview?range=7d&platform=errands');
        expect(ov.body.scope.kind).toBe('live');
        // Pending P2 and failed P3 are excluded from revenue.
        expect(ov.body.metrics.grossTransactionValue).toEqual({ RWF: 1000 });
        expect(ov.body.metrics.platformRevenue).toEqual({ RWF: 100 });
    });
});

describe('webhooks', () => {
    beforeAll(async () => { await goLive('marketplace'); });
    const event = (id: string, type = 'payment.completed', data: Record<string, unknown> = { id: `PAY-${id}`, amount: 2500, currency: 'NGN', fee: 250 }) =>
        ({ id, type, created_at: new Date().toISOString(), data });

    it('accepts a correctly signed event and stores the record', async () => {
        const res = await webhook('marketplace', event('evt_1'));
        expect(res.status).toBe(202);
        const tx = await db.one<{ status: string; amount_minor: number }>(`SELECT status, amount_minor FROM transaction_references WHERE platform = 'marketplace' AND source_id = 'PAY-evt_1'`);
        expect(tx).toMatchObject({ status: 'completed', amount_minor: 250000 });
    });

    it('acknowledges duplicates and replays without processing them twice', async () => {
        const first = await webhook('marketplace', event('evt_dup'));
        const again = await webhook('marketplace', event('evt_dup'));
        expect(first.status).toBe(202);
        expect(again.status).toBe(200);
        expect(again.body.duplicate).toBe(true);
        expect((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM platform_events WHERE event_id = 'evt_dup'`))!.n).toBe(1);
    });

    it('rejects bad signatures, stale timestamps, wrong secrets and unknown platforms', async () => {
        expect((await webhook('marketplace', event('evt_bad'), { sig: 'v1=deadbeef' })).status).toBe(401);
        expect((await webhook('marketplace', event('evt_old'), { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
        expect((await webhook('marketplace', event('evt_wrong'), { secret: 'another-secret-another-secret-123' })).status).toBe(401);
        expect((await webhook('unknown', event('evt_x'))).status).toBe(404);
        const deliveries = await db.query<{ outcome: string }>(`SELECT outcome FROM webhook_deliveries WHERE platform = 'marketplace' AND outcome = 'rejected'`);
        expect(deliveries.length).toBeGreaterThanOrEqual(3);
    });

    it('rejects events a platform does not support and platforms without a secret', async () => {
        expect((await webhook('marketplace', event('evt_book', 'booking.created', { id: 'B1' }))).status).toBe(422);
        expect((await webhook('marketplace', event('evt_unknown', 'something.happened', { id: 'S1' }))).status).toBe(400);
        await db.query(`UPDATE platform_integrations SET webhook_secret_enc = NULL WHERE platform = 'travel_tour'`);
        expect((await webhook('travel_tour', event('evt_t'))).status).toBe(503);
    });

    it('never marks a payment successful on its own: the platform’s reported status wins', async () => {
        await webhook('marketplace', event('evt_p', 'payment.pending', { id: 'PAY-X', amount: 10, currency: 'NGN' }));
        expect((await db.one<{ status: string }>(`SELECT status FROM transaction_references WHERE source_id = 'PAY-X'`))!.status).toBe('pending');
        await webhook('marketplace', event('evt_q', 'payment.completed', { id: 'PAY-Y', amount: 10, currency: 'NGN', status: 'failed' }));
        expect((await db.one<{ status: string }>(`SELECT status FROM transaction_references WHERE source_id = 'PAY-Y'`))!.status).toBe('failed');
    });
});

describe('credentials stay on the server', () => {
    it('never returns stored secrets to the browser', async () => {
        const put = await as(owner)('PUT', '/api/integrations/errands/secrets', { credential: 'super-secret-api-key-987654', webhookSecret: 'another-very-long-webhook-secret-xyz' });
        expect(put.status).toBe(200);
        const list = await as(owner)('GET', '/api/integrations');
        const text = JSON.stringify(list.body) + JSON.stringify(put.body);
        expect(text).not.toContain('super-secret-api-key-987654');
        expect(text).not.toContain('another-very-long-webhook-secret-xyz');
        const row = await db.one<{ credentials_enc: string }>(`SELECT credentials_enc FROM platform_integrations WHERE platform = 'errands'`);
        expect(row!.credentials_enc).not.toContain('super-secret');
        const auditText = JSON.stringify(await db.query(`SELECT metadata FROM audit_logs WHERE action = 'integration.secrets'`));
        expect(auditText).not.toContain('super-secret');
    });

    it('rejects plain-http API URLs and short webhook secrets', async () => {
        expect((await as(owner)('PUT', '/api/integrations/errands', { mode: 'live', enabled: true, apiUrl: 'http://insecure.example', authType: 'bearer' })).status).toBe(400);
        expect((await as(owner)('PUT', '/api/integrations/errands/secrets', { webhookSecret: 'short' })).status).toBe(400);
    });
});
