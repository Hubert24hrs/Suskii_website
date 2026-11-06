/**
 * Idempotent upserts of normalised platform records into central reference tables.
 * Primary keys include the original platform id, so re-syncing or replaying events never duplicates rows.
 */
import type { Db } from '../db.js';
import type { AnyRecord, BookingRecord, CatalogRecord, DisputeRecord, OrderRecord, PersonRecord, Resource, TransactionRecord } from './types.js';

const j = (v: unknown) => JSON.stringify(v ?? {});

export async function upsertRecord(db: Db, resource: Resource, rec: AnyRecord): Promise<void> {
    if ((rec as { isDemo?: boolean }).isDemo) throw new Error('Refusing to store demo data in reference tables');
    switch (resource) {
        case 'users':
        case 'sellers':
        case 'providers': {
            const r = rec as PersonRecord;
            await db.query(
                `INSERT INTO customer_references (platform, kind, source_id, display_name, email_masked, country, status, verification, registered_at, attributes, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
                 ON CONFLICT (platform, kind, source_id) DO UPDATE SET display_name = EXCLUDED.display_name, email_masked = EXCLUDED.email_masked,
                     country = EXCLUDED.country, status = EXCLUDED.status, verification = EXCLUDED.verification, registered_at = EXCLUDED.registered_at,
                     attributes = EXCLUDED.attributes, synced_at = now()`,
                [r.platform, r.kind, r.sourceId, r.displayName, r.emailMasked, r.country, r.status, r.verification, r.registeredAt, j(r.attributes)],
            );
            return;
        }
        case 'services':
        case 'packages': {
            const r = rec as CatalogRecord;
            await db.query(
                `INSERT INTO catalog_references (platform, kind, source_id, title, status, owner_source_id, price_minor, currency, created_at_source, attributes, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
                 ON CONFLICT (platform, kind, source_id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, owner_source_id = EXCLUDED.owner_source_id,
                     price_minor = EXCLUDED.price_minor, currency = EXCLUDED.currency, attributes = EXCLUDED.attributes, synced_at = now()`,
                [r.platform, r.kind, r.sourceId, r.title, r.status, r.ownerId, r.priceMinor, r.currency, r.createdAt, j(r.attributes)],
            );
            return;
        }
        case 'orders':
        case 'requests': {
            const r = rec as OrderRecord;
            await db.query(
                `INSERT INTO order_references (platform, kind, source_id, status, amount_minor, currency, customer_source_id, provider_source_id, title, created_at_source, attributes, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
                 ON CONFLICT (platform, kind, source_id) DO UPDATE SET status = EXCLUDED.status, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
                     customer_source_id = EXCLUDED.customer_source_id, provider_source_id = EXCLUDED.provider_source_id, title = EXCLUDED.title,
                     attributes = EXCLUDED.attributes, synced_at = now()`,
                [r.platform, r.kind, r.sourceId, r.status, r.amountMinor, r.currency, r.customerId, r.providerId, r.title, r.createdAt, j(r.attributes)],
            );
            return;
        }
        case 'bookings': {
            const r = rec as BookingRecord;
            await db.query(
                `INSERT INTO booking_references (platform, source_id, status, amount_minor, currency, customer_source_id, package_source_id, title, travel_date, created_at_source, attributes, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
                 ON CONFLICT (platform, source_id) DO UPDATE SET status = EXCLUDED.status, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
                     customer_source_id = EXCLUDED.customer_source_id, package_source_id = EXCLUDED.package_source_id, title = EXCLUDED.title,
                     travel_date = EXCLUDED.travel_date, attributes = EXCLUDED.attributes, synced_at = now()`,
                [r.platform, r.sourceId, r.status, r.amountMinor, r.currency, r.customerId, r.packageId, r.title, r.travelDate, r.createdAt, j(r.attributes)],
            );
            return;
        }
        case 'transactions':
        case 'payments':
        case 'commissions':
        case 'refunds': {
            const r = rec as TransactionRecord;
            await db.query(
                `INSERT INTO transaction_references (platform, type, source_id, status, amount_minor, currency, fee_minor, method, customer_source_id, related_type, related_source_id, occurred_at, attributes, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
                 ON CONFLICT (platform, type, source_id) DO UPDATE SET status = EXCLUDED.status, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
                     fee_minor = EXCLUDED.fee_minor, method = EXCLUDED.method, related_type = EXCLUDED.related_type, related_source_id = EXCLUDED.related_source_id,
                     occurred_at = EXCLUDED.occurred_at, attributes = EXCLUDED.attributes, synced_at = now()`,
                [r.platform, r.type, r.sourceId, r.status, r.amountMinor, r.currency, r.feeMinor, r.method, r.customerId, r.relatedType, r.relatedId, r.occurredAt, j(r.attributes)],
            );
            return;
        }
        case 'disputes': {
            const r = rec as DisputeRecord;
            await db.query(
                `INSERT INTO dispute_references (platform, source_id, status, reason, amount_minor, currency, related_type, related_source_id, opened_at, resolved_at, attributes, synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
                 ON CONFLICT (platform, source_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, amount_minor = EXCLUDED.amount_minor,
                     currency = EXCLUDED.currency, resolved_at = EXCLUDED.resolved_at, attributes = EXCLUDED.attributes, synced_at = now()`,
                [r.platform, r.sourceId, r.status, r.reason, r.amountMinor, r.currency, r.relatedType, r.relatedId, r.openedAt, r.resolvedAt, j(r.attributes)],
            );
            return;
        }
        case 'analytics':
            return;
    }
}
