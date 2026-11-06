/**
 * Data access for dashboards and record tables. Live platforms are read from central reference tables
 * (aggregated in SQL); demo platforms from generated records. Live and demo data are never combined:
 * callers choose one data kind, and every response lists each source's status for partial-data warnings.
 */
import type { PlatformId } from '../config.js';
import type { Db } from '../db.js';
import { demoRecords } from '../integrations/adapters/mock.js';
import { resolveAll, type ResolvedIntegration } from '../integrations/registry.js';
import { CAPABILITIES, type AnyRecord, type Resource } from '../integrations/types.js';
import { type Aggregates, emptyAggregates, mergeAggregates } from './metrics.js';

export type DataKind = 'live' | 'demo';

export interface SourceInfo {
    platform: PlatformId;
    name: string;
    mode: ResolvedIntegration['mode'];
    state: ResolvedIntegration['state'];
    included: boolean;
    reason: string;
    lastSyncAt: Date | null;
}

export interface Scope {
    platforms: PlatformId[];
    kind: DataKind;
    sources: SourceInfo[];
    warnings: string[];
    availableKinds: DataKind[];
}

/** Decides which platforms contribute data for the requested kind, and explains the rest. */
export async function resolveScope(db: Db, allowed: PlatformId[], requested: PlatformId | 'all', kindParam?: string | null): Promise<Scope> {
    const all = (await resolveAll(db)).filter((r) => allowed.includes(r.platform) && (requested === 'all' || r.platform === requested));
    const hasLive = all.some((r) => r.mode === 'live' && r.row.last_sync_ok_at);
    const hasDemo = all.some((r) => r.mode === 'demo' && r.adapter);
    const availableKinds: DataKind[] = [...(hasLive ? ['live' as const] : []), ...(hasDemo ? ['demo' as const] : [])];
    const kind: DataKind = kindParam === 'demo' || kindParam === 'live' ? kindParam : hasLive ? 'live' : hasDemo ? 'demo' : 'live';
    const sources: SourceInfo[] = all.map((r) => {
        const isLive = r.mode === 'live' && !!r.row.last_sync_ok_at;
        const isDemo = r.mode === 'demo' && !!r.adapter;
        const included = kind === 'live' ? isLive : isDemo;
        let reason = r.reason;
        if (!included) {
            if (r.mode === 'not_configured') reason = 'Not configured';
            else if (r.mode === 'live' && !r.row.last_sync_ok_at) reason = 'Live connection has not completed a successful sync yet';
            else if (kind === 'live' && isDemo) reason = 'Demo data is shown separately (switch to Demo data)';
            else if (kind === 'demo' && isLive) reason = 'Live platform (switch to Live data)';
        }
        return { platform: r.platform, name: r.name, mode: r.mode, state: r.state, included, reason, lastSyncAt: r.row.last_sync_ok_at };
    });
    const warnings: string[] = [];
    const excluded = sources.filter((s) => !s.included);
    if (sources.length && excluded.length === sources.length) warnings.push('No data is available for the selected platforms yet. Connect a platform in Integrations.');
    else if (excluded.length) warnings.push(`Partial data: ${excluded.map((s) => `${s.name} (${s.reason})`).join('; ')}.`);
    for (const s of sources) if (s.included && (s.state === 'sync_failed' || s.state === 'degraded')) warnings.push(`${s.name}: the last synchronisation had errors; figures may be out of date.`);
    if (kind === 'demo' && sources.some((s) => s.included)) warnings.unshift('DEMO MODE: these figures are synthetic and do not represent actual company performance.');
    return { platforms: sources.filter((s) => s.included).map((s) => s.platform), kind, sources, warnings, availableKinds };
}

const dayOf = (iso: string) => iso.slice(0, 10);

function demoAggregates(platforms: PlatformId[], from: Date, to: Date): Aggregates {
    const out = emptyAggregates();
    const inRange = (iso: string | null) => !!iso && iso >= from.toISOString() && iso <= to.toISOString();
    for (const p of platforms) {
        const tx = new Map<string, Aggregates['tx'][number]>();
        for (const t of demoRecords(p, 'transactions') as Extract<AnyRecord, { type: string; occurredAt: string }>[]) {
            if (!inRange(t.occurredAt)) continue;
            const key = `${dayOf(t.occurredAt)}|${t.type}|${t.status}|${t.currency}`;
            const cur = tx.get(key) ?? { day: dayOf(t.occurredAt), platform: p, type: t.type, status: t.status, currency: t.currency, count: 0, amount: 0, fee: 0 };
            cur.count++; cur.amount += t.amountMinor; cur.fee += t.feeMinor;
            tx.set(key, cur);
        }
        out.tx.push(...tx.values());
        const act = new Map<string, Aggregates['activity'][number]>();
        const activitySource: { kind: string; status: string; createdAt: string }[] = p === 'travel_tour'
            ? (demoRecords(p, 'bookings') as { status: string; createdAt: string }[]).map((b) => ({ kind: 'booking', status: b.status, createdAt: b.createdAt }))
            : (demoRecords(p, 'orders') as { kind: string; status: string; createdAt: string }[]);
        for (const o of activitySource) {
            if (!inRange(o.createdAt)) continue;
            const key = `${dayOf(o.createdAt)}|${o.kind}|${o.status}`;
            const cur = act.get(key) ?? { day: dayOf(o.createdAt), platform: p, kind: o.kind, status: o.status, count: 0 };
            cur.count++;
            act.set(key, cur);
        }
        out.activity.push(...act.values());
        const users = demoRecords(p, 'users') as { registeredAt: string | null }[];
        const nu = new Map<string, number>();
        for (const u of users) if (inRange(u.registeredAt)) nu.set(dayOf(u.registeredAt!), (nu.get(dayOf(u.registeredAt!)) ?? 0) + 1);
        out.newUsers.push(...[...nu].map(([day, count]) => ({ day, platform: p, count })));
        out.usersTotal.push({ platform: p, count: users.filter((u) => !!u.registeredAt && u.registeredAt <= to.toISOString()).length });
        if (CAPABILITIES[p].includes('disputes')) {
            const ds = new Map<string, number>();
            for (const d of demoRecords(p, 'disputes') as { status: string; openedAt: string }[]) if (d.openedAt <= to.toISOString()) ds.set(d.status, (ds.get(d.status) ?? 0) + 1);
            out.disputes.push(...[...ds].map(([status, count]) => ({ platform: p, status, count })));
        }
    }
    return out;
}

async function liveAggregates(db: Db, platforms: PlatformId[], from: Date, to: Date): Promise<Aggregates> {
    if (!platforms.length) return emptyAggregates();
    const args = [platforms, from.toISOString(), to.toISOString()];
    const tx = await db.query<any>(
        `SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, platform, type, status, currency, count(*)::int AS count,
                coalesce(sum(amount_minor), 0)::float8 AS amount, coalesce(sum(fee_minor), 0)::float8 AS fee
         FROM transaction_references WHERE platform = ANY($1) AND occurred_at BETWEEN $2 AND $3 GROUP BY 1, 2, 3, 4, 5`, args);
    const orders = await db.query<any>(
        `SELECT to_char(created_at_source AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, platform, kind, status, count(*)::int AS count
         FROM order_references WHERE platform = ANY($1) AND created_at_source BETWEEN $2 AND $3 GROUP BY 1, 2, 3, 4`, args);
    const bookings = await db.query<any>(
        `SELECT to_char(created_at_source AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, platform, 'booking' AS kind, status, count(*)::int AS count
         FROM booking_references WHERE platform = ANY($1) AND created_at_source BETWEEN $2 AND $3 GROUP BY 1, 2, 4`, args);
    const newUsers = await db.query<any>(
        `SELECT to_char(registered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, platform, count(*)::int AS count
         FROM customer_references WHERE kind = 'customer' AND platform = ANY($1) AND registered_at BETWEEN $2 AND $3 GROUP BY 1, 2`, args);
    const usersTotal = await db.query<any>(
        `SELECT platform, count(*)::int AS count FROM customer_references WHERE kind = 'customer' AND platform = ANY($1) AND (registered_at IS NULL OR registered_at <= $2) GROUP BY 1`,
        [platforms, to.toISOString()]);
    const disputes = await db.query<any>(
        `SELECT platform, status, count(*)::int AS count FROM dispute_references WHERE platform = ANY($1) AND opened_at <= $2 GROUP BY 1, 2`, [platforms, to.toISOString()]);
    return { tx, activity: [...orders, ...bookings], newUsers, usersTotal, disputes };
}

export async function aggregatesFor(db: Db, scope: Scope, from: Date, to: Date): Promise<Aggregates> {
    return scope.kind === 'demo' ? demoAggregates(scope.platforms, from, to) : mergeAggregates(await liveAggregates(db, scope.platforms, from, to));
}

// ─── Record tables ───
export interface RecordQuery {
    resource: Resource;
    from?: Date | null;
    to?: Date | null;
    status?: string | null;
    currency?: string | null;
    q?: string | null;
    page: number;
    pageSize: number;
}

const DATE_FIELD: Partial<Record<Resource, string>> = {
    users: 'registeredAt', sellers: 'registeredAt', providers: 'registeredAt', services: 'createdAt', packages: 'createdAt',
    orders: 'createdAt', requests: 'createdAt', bookings: 'createdAt', transactions: 'occurredAt', payments: 'occurredAt',
    commissions: 'occurredAt', refunds: 'occurredAt', disputes: 'openedAt',
};

function liveTableQuery(resource: Resource): { sql: string; dateCol: string; searchCols: string[]; statusCol: string } {
    switch (resource) {
        case 'users': return { sql: `SELECT platform, source_id AS "sourceId", kind, display_name AS "displayName", email_masked AS "emailMasked", country, status, verification, registered_at AS "registeredAt", attributes FROM customer_references WHERE kind = 'customer'`, dateCol: 'registered_at', searchCols: ['source_id', 'display_name'], statusCol: 'status' };
        case 'sellers':
        case 'providers': return { sql: `SELECT platform, source_id AS "sourceId", kind, display_name AS "displayName", email_masked AS "emailMasked", country, status, verification, registered_at AS "registeredAt", attributes FROM customer_references WHERE kind IN ('seller', 'provider', 'partner')`, dateCol: 'registered_at', searchCols: ['source_id', 'display_name'], statusCol: 'status' };
        case 'services':
        case 'packages': return { sql: `SELECT platform, source_id AS "sourceId", kind, title, status, owner_source_id AS "ownerId", price_minor AS "priceMinor", currency, created_at_source AS "createdAt", attributes FROM catalog_references WHERE kind = '${resource === 'services' ? 'service' : 'package'}'`, dateCol: 'created_at_source', searchCols: ['source_id', 'title'], statusCol: 'status' };
        case 'orders':
        case 'requests': return { sql: `SELECT platform, source_id AS "sourceId", kind, status, amount_minor AS "amountMinor", currency, customer_source_id AS "customerId", provider_source_id AS "providerId", title, created_at_source AS "createdAt", attributes FROM order_references WHERE kind = '${resource === 'orders' ? 'order' : 'errand_request'}'`, dateCol: 'created_at_source', searchCols: ['source_id', 'title', 'customer_source_id'], statusCol: 'status' };
        case 'bookings': return { sql: `SELECT platform, source_id AS "sourceId", status, amount_minor AS "amountMinor", currency, customer_source_id AS "customerId", package_source_id AS "packageId", title, travel_date AS "travelDate", created_at_source AS "createdAt", attributes FROM booking_references WHERE true`, dateCol: 'created_at_source', searchCols: ['source_id', 'title', 'customer_source_id'], statusCol: 'status' };
        case 'disputes': return { sql: `SELECT platform, source_id AS "sourceId", status, reason, amount_minor AS "amountMinor", currency, related_type AS "relatedType", related_source_id AS "relatedId", opened_at AS "openedAt", resolved_at AS "resolvedAt", attributes FROM dispute_references WHERE true`, dateCol: 'opened_at', searchCols: ['source_id', 'related_source_id'], statusCol: 'status' };
        default: {
            const type = resource === 'commissions' ? `'commission'` : resource === 'refunds' ? `'refund'` : resource === 'payments' ? `'payment'` : null;
            return { sql: `SELECT platform, source_id AS "sourceId", type, status, amount_minor AS "amountMinor", currency, fee_minor AS "feeMinor", method, customer_source_id AS "customerId", related_type AS "relatedType", related_source_id AS "relatedId", occurred_at AS "occurredAt", attributes FROM transaction_references WHERE ${type ? `type = ${type}` : 'true'}`, dateCol: 'occurred_at', searchCols: ['source_id', 'related_source_id', 'customer_source_id'], statusCol: 'status' };
        }
    }
}

export async function listRecords(db: Db, scope: Scope, q: RecordQuery): Promise<{ items: AnyRecord[]; total: number; unsupported: PlatformId[] }> {
    const supported = scope.platforms.filter((p) => CAPABILITIES[p].includes(q.resource) || (q.resource === 'sellers' && CAPABILITIES[p].includes('providers')) || (q.resource === 'providers' && CAPABILITIES[p].includes('sellers')));
    const unsupported = scope.platforms.filter((p) => !supported.includes(p));
    if (!supported.length) return { items: [], total: 0, unsupported };
    const offset = (q.page - 1) * q.pageSize;

    if (scope.kind === 'demo') {
        const df = DATE_FIELD[q.resource] ?? 'createdAt';
        const needle = q.q?.toLowerCase() ?? '';
        let rows = supported.flatMap((p) => demoRecords(p, q.resource === 'sellers' || q.resource === 'providers' ? (p === 'errands' ? 'providers' : 'sellers') : q.resource) as unknown as Record<string, unknown>[]);
        rows = rows.filter((r) => {
            const t = r[df] as string | null;
            if (q.from && (!t || t < q.from.toISOString())) return false;
            if (q.to && (!t || t > q.to.toISOString())) return false;
            if (q.status && r.status !== q.status) return false;
            if (q.currency && r.currency !== q.currency) return false;
            if (needle && !Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))) return false;
            return true;
        }).sort((a, b) => String(b[df] ?? '').localeCompare(String(a[df] ?? '')));
        return { items: rows.slice(offset, offset + q.pageSize) as unknown as AnyRecord[], total: rows.length, unsupported };
    }

    const t = liveTableQuery(q.resource);
    const where: string[] = [`platform = ANY($1)`];
    const params: unknown[] = [supported];
    const add = (cond: string, v: unknown) => { params.push(v); where.push(cond.replace('?', `$${params.length}`)); };
    if (q.from) add(`${t.dateCol} >= ?`, q.from.toISOString());
    if (q.to) add(`${t.dateCol} <= ?`, q.to.toISOString());
    if (q.status) add(`${t.statusCol} = ?`, q.status);
    if (q.currency) add(`currency = ?`, q.currency);
    if (q.q) {
        params.push(`%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
        where.push(`(${t.searchCols.map((c) => `${c} ILIKE $${params.length}`).join(' OR ')})`);
    }
    const base = `${t.sql} AND ${where.join(' AND ')}`;
    const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM (${base}) x`, params))?.n ?? 0;
    const items = await db.query<AnyRecord>(`${base} ORDER BY ${t.dateCol} DESC NULLS LAST LIMIT ${q.pageSize} OFFSET ${offset}`, params);
    return { items, total, unsupported };
}
