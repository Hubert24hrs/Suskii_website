/**
 * Normalises platform API records into central shapes while preserving original, non-personal fields.
 * Field names follow the proposed contract with common fallbacks (id/_id/uuid, created_at/createdAt…).
 * Unknown financial statuses map to 'pending' so they can never be counted as revenue.
 */
import type { PlatformId } from '../config.js';
import { maskEmail } from '../security.js';
import type {
    BookingRecord, CatalogRecord, DisputeRecord, OrderRecord, PersonRecord, Resource, TransactionRecord, TxStatus, TxType,
} from './types.js';

type Raw = Record<string, unknown>;

/** ISO 4217 minor-unit exponents for currencies in scope; default 2. */
const EXPONENT: Record<string, number> = { RWF: 0, UGX: 0, XOF: 0, XAF: 0, JPY: 0, KRW: 0, NGN: 2, KES: 2, GHS: 2, ZAR: 2, TZS: 2, USD: 2, EUR: 2, GBP: 2 };
export const currencyExponent = (c: string): number => EXPONENT[c.toUpperCase()] ?? 2;

const PII = /^(e-?mail|phone|mobile|msisdn|address|street|city_address|password|pass|token|secret|card|pan|cvv|iban|account_?number|bank_?account|dob|date_of_birth|birth|national_?id|nin|bvn|passport|ssn|lat|lng|latitude|longitude|ip|ip_address|first_?name|last_?name|full_?name)$/i;

export function stripPersonal(raw: Raw, keep: string[] = []): Raw {
    const out: Raw = {};
    for (const [k, v] of Object.entries(raw)) {
        if (keep.includes(k)) continue;
        if (PII.test(k)) continue;
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = stripPersonal(v as Raw);
        else if (Array.isArray(v)) out[k] = v.length > 50 ? `[${v.length} items]` : v.map((x) => (x && typeof x === 'object' ? stripPersonal(x as Raw) : x));
        else out[k] = v;
    }
    return out;
}

const pick = (r: Raw, ...keys: string[]): unknown => {
    for (const k of keys) {
        const v = k.includes('.') ? k.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Raw)[p] : undefined), r) : r[k];
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
};
const s = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

export function idOf(r: Raw): string {
    const id = pick(r, 'id', '_id', 'uuid', 'reference', 'ref');
    if (id === undefined) throw new Error('Record has no id');
    return String(id);
}

export function isoTime(v: unknown): string | null {
    if (v === undefined || v === null || v === '') return null;
    const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function currencyOf(r: Raw, fallback: string | null = null): string | null {
    const c = pick(r, 'currency', 'currency_code', 'currencyCode', 'amount.currency');
    return typeof c === 'string' && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : fallback;
}

/** amount_minor (integer) is preferred; otherwise a decimal `amount` is converted using the currency's exponent. */
export function minorAmount(r: Raw, currency: string | null, minorKeys: string[], decimalKeys: string[]): number | null {
    const minor = pick(r, ...minorKeys);
    if (minor !== undefined) {
        const n = Number(minor);
        return Number.isFinite(n) ? Math.round(n) : null;
    }
    const dec = pick(r, ...decimalKeys);
    if (dec === undefined) return null;
    const n = Number(typeof dec === 'object' && dec !== null ? (dec as Raw).value : dec);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10 ** currencyExponent(currency ?? 'USD'));
}

export function txStatus(v: unknown): TxStatus {
    const x = String(v ?? '').toLowerCase().replace(/[\s-]/g, '_');
    if (['completed', 'complete', 'success', 'successful', 'succeeded', 'paid', 'settled', 'captured'].includes(x)) return 'completed'; // 'approved'/'authorized' stay pending until captured
    if (['failed', 'failure', 'declined', 'error', 'rejected', 'expired'].includes(x)) return 'failed';
    if (['refunded', 'refund', 'partially_refunded'].includes(x)) return 'refunded';
    if (['reversed', 'reversal', 'chargeback', 'charged_back'].includes(x)) return 'reversed';
    if (['cancelled', 'canceled', 'voided', 'void', 'abandoned'].includes(x)) return 'cancelled';
    return 'pending';
}

function txType(v: unknown, fallback: TxType): TxType {
    const x = String(v ?? '').toLowerCase();
    if (x.includes('refund')) return 'refund';
    if (x.includes('commission') || x.includes('fee')) return 'commission';
    if (x.includes('payout') || x.includes('withdraw') || x.includes('settlement')) return 'payout';
    if (x.includes('adjust')) return 'adjustment';
    if (x.includes('payment') || x.includes('charge') || x.includes('purchase')) return 'payment';
    return fallback;
}

export function normalizePerson(platform: PlatformId, kind: PersonRecord['kind'], r: Raw): PersonRecord {
    const first = s(pick(r, 'first_name', 'firstName'));
    const last = s(pick(r, 'last_name', 'lastName'));
    const display = s(pick(r, 'display_name', 'displayName', 'business_name', 'businessName', 'store_name', 'shop_name', 'name', 'full_name'))
        ?? ([first, last].filter(Boolean).join(' ') || null);
    return {
        platform, kind, sourceId: idOf(r),
        displayName: display ? display.slice(0, 120) : null,
        emailMasked: maskEmail(s(pick(r, 'email', 'email_address'))),
        country: s(pick(r, 'country', 'country_code', 'countryCode', 'location.country')),
        status: s(pick(r, 'status', 'state', 'account_status')),
        verification: s(pick(r, 'verification_status', 'verificationStatus', 'kyc_status', 'verified')),
        registeredAt: isoTime(pick(r, 'created_at', 'createdAt', 'registered_at', 'joined_at', 'signup_date')),
        attributes: stripPersonal(r),
    };
}

export function normalizeTransaction(platform: PlatformId, r: Raw, fallbackType: TxType): TransactionRecord {
    // Never guess a currency: a transaction without one is rejected (and logged) rather than misreported.
    const currency = currencyOf(r);
    if (!currency) throw new Error('Transaction has no valid ISO currency code');
    return {
        platform, sourceId: idOf(r),
        type: txType(pick(r, 'type', 'kind', 'category'), fallbackType),
        status: txStatus(pick(r, 'status', 'state', 'payment_status')),
        amountMinor: minorAmount(r, currency, ['amount_minor', 'amountMinor', 'amount_in_minor'], ['amount', 'total', 'value']) ?? 0,
        currency,
        feeMinor: minorAmount(r, currency, ['fee_minor', 'commission_minor', 'platform_fee_minor', 'revenue_minor'], ['fee', 'commission', 'platform_fee', 'service_fee', 'revenue']) ?? 0,
        method: s(pick(r, 'method', 'payment_method', 'channel', 'provider')),
        customerId: s(pick(r, 'customer_id', 'customerId', 'user_id', 'userId', 'buyer_id')),
        relatedType: s(pick(r, 'related_type', 'relatedType', 'order_type')) ?? (pick(r, 'order_id', 'orderId') ? 'order' : pick(r, 'booking_id', 'bookingId') ? 'booking' : pick(r, 'request_id', 'requestId') ? 'errand_request' : null),
        relatedId: s(pick(r, 'related_id', 'relatedId', 'order_id', 'orderId', 'booking_id', 'bookingId', 'request_id', 'requestId')),
        occurredAt: isoTime(pick(r, 'occurred_at', 'paid_at', 'completed_at', 'created_at', 'createdAt', 'date', 'timestamp')) ?? new Date().toISOString(),
        attributes: stripPersonal(r),
    };
}

export function normalizeOrder(platform: PlatformId, kind: OrderRecord['kind'], r: Raw): OrderRecord {
    const currency = currencyOf(r);
    return {
        platform, kind, sourceId: idOf(r),
        status: String(pick(r, 'status', 'state', 'order_status') ?? 'unknown').toLowerCase(),
        amountMinor: minorAmount(r, currency, ['amount_minor', 'total_minor', 'amountMinor'], ['amount', 'total', 'price', 'budget']),
        currency,
        customerId: s(pick(r, 'customer_id', 'customerId', 'buyer_id', 'user_id', 'requester_id')),
        providerId: s(pick(r, 'seller_id', 'sellerId', 'provider_id', 'providerId', 'assignee_id')),
        title: s(pick(r, 'title', 'summary', 'service_name', 'item_name'))?.slice(0, 160) ?? null,
        createdAt: isoTime(pick(r, 'created_at', 'createdAt', 'placed_at', 'requested_at', 'date')) ?? new Date().toISOString(),
        attributes: stripPersonal(r),
    };
}

export function normalizeBooking(platform: PlatformId, r: Raw): BookingRecord {
    const currency = currencyOf(r);
    return {
        platform, sourceId: idOf(r),
        status: String(pick(r, 'status', 'state', 'booking_status') ?? 'unknown').toLowerCase(),
        amountMinor: minorAmount(r, currency, ['amount_minor', 'total_minor'], ['amount', 'total', 'price']),
        currency,
        customerId: s(pick(r, 'customer_id', 'customerId', 'user_id', 'traveller_id')),
        packageId: s(pick(r, 'package_id', 'packageId', 'product_id')),
        title: s(pick(r, 'title', 'package_name', 'destination', 'route'))?.slice(0, 160) ?? null,
        travelDate: (isoTime(pick(r, 'travel_date', 'travelDate', 'departure_date', 'check_in', 'start_date')) ?? '').slice(0, 10) || null,
        createdAt: isoTime(pick(r, 'created_at', 'createdAt', 'booked_at', 'date')) ?? new Date().toISOString(),
        attributes: stripPersonal(r),
    };
}

export function normalizeDispute(platform: PlatformId, r: Raw): DisputeRecord {
    const currency = currencyOf(r);
    return {
        platform, sourceId: idOf(r),
        status: String(pick(r, 'status', 'state') ?? 'open').toLowerCase(),
        reason: s(pick(r, 'reason', 'category', 'type'))?.slice(0, 200) ?? null,
        amountMinor: minorAmount(r, currency, ['amount_minor'], ['amount']),
        currency,
        relatedType: s(pick(r, 'related_type', 'relatedType')) ?? (pick(r, 'order_id') ? 'order' : pick(r, 'booking_id') ? 'booking' : pick(r, 'request_id') ? 'errand_request' : null),
        relatedId: s(pick(r, 'related_id', 'order_id', 'booking_id', 'request_id', 'transaction_id')),
        openedAt: isoTime(pick(r, 'opened_at', 'created_at', 'createdAt', 'date')) ?? new Date().toISOString(),
        resolvedAt: isoTime(pick(r, 'resolved_at', 'closed_at', 'resolvedAt')),
        attributes: stripPersonal(r),
    };
}

export function normalizeCatalog(platform: PlatformId, kind: CatalogRecord['kind'], r: Raw): CatalogRecord {
    const currency = currencyOf(r);
    return {
        platform, kind, sourceId: idOf(r),
        title: s(pick(r, 'title', 'name'))?.slice(0, 160) ?? null,
        status: s(pick(r, 'status', 'state', 'moderation_status')),
        ownerId: s(pick(r, 'seller_id', 'provider_id', 'owner_id', 'partner_id')),
        priceMinor: minorAmount(r, currency, ['price_minor', 'amount_minor'], ['price', 'amount', 'rate']),
        currency,
        createdAt: isoTime(pick(r, 'created_at', 'createdAt', 'listed_at')),
        attributes: stripPersonal(r),
    };
}

/** Maps a resource's raw records to normalised records for the given platform. */
export function normalize(platform: PlatformId, resource: Resource, r: Raw) {
    switch (resource) {
        case 'users': return normalizePerson(platform, 'customer', r);
        case 'sellers': return normalizePerson(platform, 'seller', r);
        case 'providers': return normalizePerson(platform, 'provider', r);
        case 'services': return normalizeCatalog(platform, 'service', r);
        case 'packages': return normalizeCatalog(platform, 'package', r);
        case 'orders': return normalizeOrder(platform, 'order', r);
        case 'requests': return normalizeOrder(platform, 'errand_request', r);
        case 'bookings': return normalizeBooking(platform, r);
        case 'transactions':
        case 'payments': return normalizeTransaction(platform, r, 'payment');
        case 'commissions': return normalizeTransaction(platform, r, 'commission');
        case 'refunds': return normalizeTransaction(platform, r, 'refund');
        case 'disputes': return normalizeDispute(platform, r);
        case 'analytics': throw new Error('analytics is not a record resource');
    }
}
