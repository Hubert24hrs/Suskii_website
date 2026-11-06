/**
 * Pure reporting calculations over a common aggregate shape (produced from live reference tables in SQL,
 * or from demo records in memory). Rules:
 *  - amounts are never added across currencies; every money figure is a per-currency map
 *  - gross transaction value (GTV) = completed payment amounts
 *  - platform revenue = platform fee on completed payments only (never pending, failed, refunded or reversed)
 */
import type { PlatformId } from '../config.js';

export type Money = Record<string, number>; // currency → minor units

export interface TxAgg { day: string; platform: PlatformId; type: string; status: string; currency: string; count: number; amount: number; fee: number }
export interface CountAgg { day: string; platform: PlatformId; kind: string; status: string; count: number }
export interface UserAgg { day: string; platform: PlatformId; count: number }
export interface Aggregates {
    tx: TxAgg[];
    activity: CountAgg[]; // orders, errand requests, bookings
    newUsers: UserAgg[];
    usersTotal: { platform: PlatformId; count: number }[];
    disputes: { platform: PlatformId; status: string; count: number }[];
}

export const ACTIVE_ERRAND = new Set(['open', 'pending', 'accepted', 'assigned', 'in_progress', 'ongoing']);
export const PENDING_DISPUTE = new Set(['open', 'pending', 'under_review', 'escalated', 'new']);

const add = (m: Money, currency: string, v: number) => { m[currency] = (m[currency] ?? 0) + v; };

export function emptyAggregates(): Aggregates {
    return { tx: [], activity: [], newUsers: [], usersTotal: [], disputes: [] };
}

export function mergeAggregates(...parts: Aggregates[]): Aggregates {
    const out = emptyAggregates();
    for (const p of parts) {
        out.tx.push(...p.tx); out.activity.push(...p.activity); out.newUsers.push(...p.newUsers);
        out.usersTotal.push(...p.usersTotal); out.disputes.push(...p.disputes);
    }
    return out;
}

export function days(from: Date, to: Date): string[] {
    const out: string[] = [];
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    while (d <= to && out.length < 400) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
}

export function computeOverview(a: Aggregates, range: { from: Date; to: Date }, platforms: PlatformId[]) {
    const payments = a.tx.filter((t) => t.type === 'payment');
    const sumCount = (rows: { count: number }[]) => rows.reduce((s, r) => s + r.count, 0);

    const gtv: Money = {}, revenue: Money = {}, pendingAmount: Money = {}, refundAmount: Money = {}, commissionAmount: Money = {};
    for (const t of payments) {
        if (t.status === 'completed') { add(gtv, t.currency, t.amount); add(revenue, t.currency, t.fee); }
        if (t.status === 'pending') add(pendingAmount, t.currency, t.amount);
    }
    const refunds = a.tx.filter((t) => t.type === 'refund');
    for (const t of refunds) if (t.status === 'completed') add(refundAmount, t.currency, t.amount);
    const commissions = a.tx.filter((t) => t.type === 'commission');
    for (const t of commissions) if (t.status === 'completed') add(commissionAmount, t.currency, t.amount);

    const byStatus = (s: string) => sumCount(payments.filter((t) => t.status === s));
    const activity = (kind: string, pred: (status: string) => boolean = () => true) => sumCount(a.activity.filter((x) => x.kind === kind && pred(x.status)));

    const metrics = {
        totalUsers: sumCount(a.usersTotal),
        newUsers: sumCount(a.newUsers),
        totalTransactions: sumCount(payments),
        completedTransactions: byStatus('completed'),
        failedTransactions: byStatus('failed'),
        pendingPayments: byStatus('pending'),
        pendingPaymentsAmount: pendingAmount,
        grossTransactionValue: gtv,
        platformRevenue: revenue,
        refunds: sumCount(refunds),
        refundAmount,
        commissions: commissionAmount,
        marketplaceOrders: activity('order'),
        activeErrands: activity('errand_request', (s) => ACTIVE_ERRAND.has(s)),
        errandRequests: activity('errand_request'),
        travelBookings: activity('booking'),
        pendingDisputes: sumCount(a.disputes.filter((d) => PENDING_DISPUTE.has(d.status))),
    };

    const dayList = days(range.from, range.to);
    const series = <T,>(fn: (day: string) => T) => dayList.map((day) => ({ day, ...fn(day) }));

    const currencies = [...new Set(payments.map((t) => t.currency))].sort();
    const charts = {
        transactionTrend: series((day) => Object.fromEntries(platforms.map((p) => [p, sumCount(payments.filter((t) => t.day === day && t.platform === p))]))),
        revenueTrend: Object.fromEntries(currencies.map((c) => [c, dayList.map((day) => ({
            day, value: payments.filter((t) => t.day === day && t.currency === c && t.status === 'completed').reduce((s, t) => s + t.fee, 0),
        }))])),
        platformComparison: platforms.map((p) => {
            const rows = payments.filter((t) => t.platform === p);
            const g: Money = {}, r: Money = {};
            for (const t of rows) if (t.status === 'completed') { add(g, t.currency, t.amount); add(r, t.currency, t.fee); }
            return { platform: p, transactions: sumCount(rows), completed: sumCount(rows.filter((t) => t.status === 'completed')), gtv: g, revenue: r };
        }),
        userGrowth: (() => {
            let running = Object.fromEntries(platforms.map((p) => [p, 0])) as Record<string, number>;
            return dayList.map((day) => {
                const row: Record<string, number | string> = { day };
                for (const p of platforms) {
                    const n = sumCount(a.newUsers.filter((u) => u.day === day && u.platform === p));
                    running = { ...running, [p]: running[p] + n };
                    row[p] = n;
                    row[`${p}_cumulative`] = running[p];
                }
                return row;
            });
        })(),
        ordersAndBookings: series((day) => ({
            orders: sumCount(a.activity.filter((x) => x.day === day && x.kind === 'order')),
            errands: sumCount(a.activity.filter((x) => x.day === day && x.kind === 'errand_request')),
            bookings: sumCount(a.activity.filter((x) => x.day === day && x.kind === 'booking')),
        })),
        statusDistribution: ['completed', 'pending', 'failed', 'refunded', 'reversed', 'cancelled'].map((status) => ({ status, count: byStatus(status) })),
        revenueContribution: Object.fromEntries(currencies.map((c) => [c, platforms.map((p) => ({
            platform: p, value: payments.filter((t) => t.platform === p && t.currency === c && t.status === 'completed').reduce((s, t) => s + t.fee, 0),
        }))])),
    };
    return { metrics, charts, currencies };
}
