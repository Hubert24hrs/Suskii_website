/**
 * Demo adapters: deterministic, clearly labelled SYNTHETIC data for development and demos.
 * Every record has isDemo: true and an id starting with "DEMO-". Demo data is generated in memory
 * and is never written to the database, so it can never mix with real platform records.
 */
import type { PlatformId } from '../../config.js';
import {
    type AnyRecord, type BookingRecord, CAPABILITIES, type CatalogRecord, type DisputeRecord, type HealthResult, type ListOptions,
    type OrderRecord, type Page, type PersonRecord, type PlatformAdapter, type Resource, type TransactionRecord, type TxStatus, IntegrationError,
} from '../types.js';

const DAY = 86_400_000;

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

interface Profile {
    customers: number;
    providers: number;
    catalog: number;
    dailyVolume: number;
    commission: number;
    currencies: [string, number, [number, number]][]; // code, weight, [min, max] major units
    providerKind: PersonRecord['kind'];
    catalogKind: CatalogRecord['kind'];
    titles: string[];
}

const PROFILES: Record<PlatformId, Profile> = {
    marketplace: {
        customers: 1400, providers: 260, catalog: 900, dailyVolume: 38, commission: 0.05, providerKind: 'seller', catalogKind: 'listing',
        currencies: [['NGN', 0.7, [4_000, 950_000]], ['RWF', 0.3, [5_000, 1_200_000]]],
        titles: ['Smartphone', 'Laptop', 'Sneakers', 'Sofa set', 'Television', 'Used car', 'Shortlet apartment', 'Handbag', 'Generator', 'Office chair'],
    },
    errands: {
        customers: 700, providers: 180, catalog: 60, dailyVolume: 21, commission: 0.12, providerKind: 'provider', catalogKind: 'service',
        currencies: [['NGN', 0.65, [3_000, 120_000]], ['RWF', 0.35, [4_000, 150_000]]],
        titles: ['Home cleaning', 'Plumbing repair', 'Grocery delivery', 'Laundry pickup', 'Moving help', 'Electrical repair', 'Tutoring session', 'Event setup'],
    },
    travel_tour: {
        customers: 420, providers: 35, catalog: 48, dailyVolume: 9, commission: 0.08, providerKind: 'partner', catalogKind: 'package',
        currencies: [['NGN', 0.5, [45_000, 1_800_000]], ['RWF', 0.3, [60_000, 2_000_000]], ['USD', 0.2, [80, 2_400]]],
        titles: ['Lagos → Kigali flight', 'Kigali city tour', 'Volcanoes trek', 'Abuja hotel stay', 'Lagos airport transfer', 'Intercity coach', 'Lake Kivu weekend'],
    },
};

interface Dataset {
    people: PersonRecord[];
    catalog: CatalogRecord[];
    orders: OrderRecord[];
    bookings: BookingRecord[];
    transactions: TransactionRecord[];
    disputes: DisputeRecord[];
}

const cache = new Map<string, Dataset>();

export function demoDataset(platform: PlatformId, now = Date.now()): Dataset {
    const dayIndex = Math.floor(now / DAY);
    const key = `${platform}:${dayIndex}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const prof = PROFILES[platform];
    const rnd = mulberry32(hash(platform) ^ 0x5eed);
    const today = dayIndex * DAY;
    const pickW = <T,>(items: [T, number][]): T => { let x = rnd(); for (const [v, w] of items) { if ((x -= w) <= 0) return v; } return items[items.length - 1][0]; };
    const id = (p: string, n: number) => `DEMO-${p}-${String(n).padStart(6, '0')}`;
    const iso = (t: number) => new Date(t).toISOString();
    const countries = [['NG', 0.62], ['RW', 0.34], ['KE', 0.04]] as [string, number][];

    const people: PersonRecord[] = [];
    for (let i = 0; i < prof.customers; i++) {
        const age = Math.floor(rnd() ** 1.6 * 240);
        people.push({ platform, kind: 'customer', sourceId: id('C', i), displayName: `Demo customer ${i + 1}`, emailMasked: `d••••@example.com`,
            country: pickW(countries), status: rnd() < 0.96 ? 'active' : 'suspended', verification: null, registeredAt: iso(today - age * DAY - rnd() * DAY), attributes: {}, isDemo: true });
    }
    for (let i = 0; i < prof.providers; i++) {
        people.push({ platform, kind: prof.providerKind, sourceId: id('P', i), displayName: `Demo ${prof.providerKind} ${i + 1}`, emailMasked: `d••••@example.com`,
            country: pickW(countries), status: 'active', verification: pickW([['verified', 0.7], ['pending', 0.2], ['unverified', 0.1]]),
            registeredAt: iso(today - Math.floor(rnd() * 300) * DAY), attributes: {}, isDemo: true });
    }
    const catalog: CatalogRecord[] = [];
    for (let i = 0; i < prof.catalog; i++) {
        const [cur, , [lo, hi]] = prof.currencies[i % prof.currencies.length];
        catalog.push({ platform, kind: prof.catalogKind, sourceId: id('L', i), title: `${prof.titles[i % prof.titles.length]} (demo)`,
            status: pickW([['active', 0.82], ['pending_review', 0.1], ['rejected', 0.03], ['inactive', 0.05]]), ownerId: id('P', Math.floor(rnd() * prof.providers)),
            priceMinor: Math.round((lo + rnd() * (hi - lo)) * (cur === 'RWF' ? 1 : 100)), currency: cur, createdAt: iso(today - Math.floor(rnd() * 200) * DAY), attributes: {}, isDemo: true });
    }

    const orders: OrderRecord[] = [];
    const bookings: BookingRecord[] = [];
    const transactions: TransactionRecord[] = [];
    const disputes: DisputeRecord[] = [];
    let n = 0;
    for (let d = 120; d >= 0; d--) {
        const growth = 0.65 + (120 - d) / 120 * 0.5;
        const weekday = new Date(today - d * DAY).getUTCDay();
        const volume = Math.round(prof.dailyVolume * growth * (weekday === 0 || weekday === 6 ? 0.8 : 1.05) * (0.8 + rnd() * 0.4));
        for (let k = 0; k < volume; k++) {
            const t = today - d * DAY + rnd() * DAY;
            if (t > now) continue;
            const [cur, , [lo, hi]] = pickW(prof.currencies.map((c) => [c, c[1]] as [typeof c, number]));
            const amountMinor = Math.round((lo + rnd() ** 2 * (hi - lo)) * (cur === 'RWF' ? 1 : 100));
            const recordId = id(platform === 'travel_tour' ? 'B' : platform === 'errands' ? 'R' : 'O', n);
            const customerId = id('C', Math.floor(rnd() * prof.customers));
            const providerId = id('P', Math.floor(rnd() * prof.providers));
            const recent = d <= 2;
            const payStatus: TxStatus = pickW(recent
                ? [['completed', 0.62], ['pending', 0.3], ['failed', 0.08]]
                : [['completed', 0.86], ['failed', 0.07], ['refunded', 0.03], ['cancelled', 0.03], ['reversed', 0.01]]);
            const title = `${prof.titles[Math.floor(rnd() * prof.titles.length)]} (demo)`;
            if (platform === 'travel_tour') {
                bookings.push({ platform, sourceId: recordId, status: payStatus === 'completed' ? (rnd() < 0.9 ? 'confirmed' : 'completed') : payStatus === 'pending' ? 'pending' : 'cancelled',
                    amountMinor, currency: cur, customerId, packageId: id('L', Math.floor(rnd() * prof.catalog)), title,
                    travelDate: iso(t + (3 + rnd() * 60) * DAY).slice(0, 10), createdAt: iso(t), attributes: {}, isDemo: true });
            } else {
                const kind = platform === 'errands' ? 'errand_request' : 'order';
                const status = payStatus === 'completed' ? (d < 2 && kind === 'errand_request' ? pickW([['accepted', 0.4], ['in_progress', 0.6]]) : 'completed')
                    : payStatus === 'pending' ? (kind === 'errand_request' ? 'open' : 'pending') : 'cancelled';
                orders.push({ platform, kind, sourceId: recordId, status, amountMinor, currency: cur, customerId, providerId, title, createdAt: iso(t), attributes: {}, isDemo: true });
            }
            const fee = Math.round(amountMinor * prof.commission);
            transactions.push({ platform, sourceId: id('T', n), type: 'payment', status: payStatus, amountMinor, currency: cur, feeMinor: fee,
                method: pickW([['card', 0.5], ['bank_transfer', 0.3], ['mobile_money', 0.2]]), customerId,
                relatedType: platform === 'travel_tour' ? 'booking' : platform === 'errands' ? 'errand_request' : 'order', relatedId: recordId,
                occurredAt: iso(t + 60_000), attributes: {}, isDemo: true });
            if (payStatus === 'completed' && CAPABILITIES[platform].includes('commissions')) {
                transactions.push({ platform, sourceId: id('F', n), type: 'commission', status: 'completed', amountMinor: fee, currency: cur, feeMinor: 0, method: null,
                    customerId: null, relatedType: 'payment', relatedId: id('T', n), occurredAt: iso(t + 120_000), attributes: {}, isDemo: true });
            }
            if (payStatus === 'refunded') {
                transactions.push({ platform, sourceId: id('X', n), type: 'refund', status: 'completed', amountMinor, currency: cur, feeMinor: 0, method: null,
                    customerId, relatedType: 'payment', relatedId: id('T', n), occurredAt: iso(Math.min(now, t + 2 * DAY)), attributes: {}, isDemo: true });
            }
            if (CAPABILITIES[platform].includes('disputes') && rnd() < 0.015) {
                const open = d < 14 && rnd() < 0.6;
                disputes.push({ platform, sourceId: id('D', n), status: open ? 'open' : pickW([['resolved', 0.7], ['rejected', 0.3]]),
                    reason: pickW([['item_not_received', 0.4], ['not_as_described', 0.35], ['service_quality', 0.25]]), amountMinor, currency: cur,
                    relatedType: platform === 'errands' ? 'errand_request' : 'order', relatedId: recordId, openedAt: iso(Math.min(now, t + DAY)),
                    resolvedAt: open ? null : iso(Math.min(now, t + 5 * DAY)), attributes: {}, isDemo: true });
            }
            n++;
        }
    }
    const ds = { people, catalog, orders, bookings, transactions, disputes };
    cache.clear();
    cache.set(key, ds);
    return ds;
}

export function demoRecords(platform: PlatformId, resource: Resource, now = Date.now()): AnyRecord[] {
    const ds = demoDataset(platform, now);
    switch (resource) {
        case 'users': return ds.people.filter((p) => p.kind === 'customer');
        case 'sellers':
        case 'providers': return ds.people.filter((p) => p.kind !== 'customer');
        case 'services':
        case 'packages': return ds.catalog;
        case 'orders':
        case 'requests': return ds.orders;
        case 'bookings': return ds.bookings;
        case 'transactions': return ds.transactions;
        case 'payments': return ds.transactions.filter((t) => t.type === 'payment');
        case 'commissions': return ds.transactions.filter((t) => t.type === 'commission');
        case 'refunds': return ds.transactions.filter((t) => t.type === 'refund');
        case 'disputes': return ds.disputes;
        default: return [];
    }
}

export class MockAdapter implements PlatformAdapter {
    readonly mode = 'demo' as const;
    readonly capabilities: Resource[];
    constructor(readonly platform: PlatformId) {
        this.capabilities = CAPABILITIES[platform];
    }
    async health(): Promise<HealthResult> {
        return { ok: true, latencyMs: 0, message: 'Demo mode: synthetic data, not a real connection' };
    }
    async list(resource: Resource, opts: ListOptions = {}): Promise<Page<AnyRecord>> {
        if (!this.capabilities.includes(resource) || resource === 'analytics') {
            throw new IntegrationError(this.platform, 'unsupported', `${resource} is not available from this platform`);
        }
        const all = demoRecords(this.platform, resource);
        const offset = Number(opts.cursor ?? 0);
        const size = opts.pageSize ?? 100;
        const items = all.slice(offset, offset + size);
        return { items, nextCursor: offset + size < all.length ? String(offset + size) : null };
    }
}
