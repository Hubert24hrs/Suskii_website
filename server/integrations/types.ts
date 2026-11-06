/**
 * Shared integration types. Each platform declares which resources it actually exposes —
 * the central admin never assumes the three platforms offer identical data or operations.
 */
import type { PlatformId } from '../config.js';

export type Resource =
    | 'users' | 'sellers' | 'providers' | 'services' | 'packages'
    | 'orders' | 'requests' | 'bookings'
    | 'transactions' | 'payments' | 'commissions' | 'refunds' | 'disputes' | 'analytics';

/** Proposed integration contract (from the project brief). Verify against each real API before going live. */
export const CAPABILITIES: Record<PlatformId, Resource[]> = {
    marketplace: ['users', 'sellers', 'orders', 'transactions', 'payments', 'commissions', 'refunds', 'disputes', 'analytics'],
    errands: ['users', 'providers', 'services', 'requests', 'transactions', 'payments', 'commissions', 'disputes', 'analytics'],
    travel_tour: ['users', 'packages', 'bookings', 'transactions', 'payments', 'refunds', 'analytics'],
};

/** Resources mirrored into central reference tables by synchronisation (analytics is fetched live). */
export const SYNCED: Resource[] = ['users', 'sellers', 'providers', 'services', 'packages', 'orders', 'requests', 'bookings', 'transactions', 'payments', 'commissions', 'refunds', 'disputes'];

export type TxStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'reversed' | 'cancelled';
export type TxType = 'payment' | 'refund' | 'commission' | 'payout' | 'adjustment';

interface Base {
    platform: PlatformId;
    sourceId: string;
    /** Original platform fields that are not personal data, preserved for reference. */
    attributes: Record<string, unknown>;
    isDemo?: boolean;
}

export interface PersonRecord extends Base {
    kind: 'customer' | 'seller' | 'provider' | 'partner';
    displayName: string | null;
    emailMasked: string | null;
    country: string | null;
    status: string | null;
    verification: string | null;
    registeredAt: string | null;
}

export interface TransactionRecord extends Base {
    type: TxType;
    status: TxStatus;
    amountMinor: number;
    currency: string;
    /** Platform revenue attached to this transaction (commission / service fee), same currency. */
    feeMinor: number;
    method: string | null;
    customerId: string | null;
    relatedType: string | null;
    relatedId: string | null;
    occurredAt: string;
}

export interface OrderRecord extends Base {
    kind: 'order' | 'errand_request';
    status: string;
    amountMinor: number | null;
    currency: string | null;
    customerId: string | null;
    providerId: string | null;
    title: string | null;
    createdAt: string;
}

export interface BookingRecord extends Base {
    status: string;
    amountMinor: number | null;
    currency: string | null;
    customerId: string | null;
    packageId: string | null;
    title: string | null;
    travelDate: string | null;
    createdAt: string;
}

export interface DisputeRecord extends Base {
    status: string;
    reason: string | null;
    amountMinor: number | null;
    currency: string | null;
    relatedType: string | null;
    relatedId: string | null;
    openedAt: string;
    resolvedAt: string | null;
}

export interface CatalogRecord extends Base {
    kind: 'listing' | 'service' | 'package';
    title: string | null;
    status: string | null;
    ownerId: string | null;
    priceMinor: number | null;
    currency: string | null;
    createdAt: string | null;
}

export type AnyRecord = PersonRecord | TransactionRecord | OrderRecord | BookingRecord | DisputeRecord | CatalogRecord;

export interface ListOptions {
    cursor?: string | null;
    pageSize?: number;
    updatedSince?: string | null;
}

export interface Page<T> {
    items: T[];
    nextCursor: string | null;
}

export interface HealthResult {
    ok: boolean;
    latencyMs: number;
    message: string;
}

export interface PlatformAdapter {
    readonly platform: PlatformId;
    readonly mode: 'live' | 'demo';
    readonly capabilities: Resource[];
    health(): Promise<HealthResult>;
    list(resource: Resource, opts?: ListOptions): Promise<Page<AnyRecord>>;
}

export class IntegrationError extends Error {
    constructor(public platform: PlatformId, public code: 'timeout' | 'network' | 'auth' | 'rate_limited' | 'not_found' | 'bad_response' | 'server' | 'unsupported' | 'not_configured',
        message: string, public status?: number, public retryable = false) {
        super(message);
    }
}

/** Which central reference table a resource is stored in. */
export const RESOURCE_KIND: Record<Exclude<Resource, 'analytics'>, { table: string; kind?: string; txType?: TxType }> = {
    users: { table: 'customer_references', kind: 'customer' },
    sellers: { table: 'customer_references', kind: 'seller' },
    providers: { table: 'customer_references', kind: 'provider' },
    services: { table: 'catalog_references', kind: 'service' },
    packages: { table: 'catalog_references', kind: 'package' },
    orders: { table: 'order_references', kind: 'order' },
    requests: { table: 'order_references', kind: 'errand_request' },
    bookings: { table: 'booking_references' },
    transactions: { table: 'transaction_references', txType: 'payment' },
    payments: { table: 'transaction_references', txType: 'payment' },
    commissions: { table: 'transaction_references', txType: 'commission' },
    refunds: { table: 'transaction_references', txType: 'refund' },
    disputes: { table: 'dispute_references' },
};
