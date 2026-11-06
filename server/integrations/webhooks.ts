/**
 * Webhook receiver: POST /api/webhooks/:platform
 *
 * Contract (proposed — share with each platform team):
 *   Headers  X-Suskii-Timestamp: <unix seconds>
 *            X-Suskii-Signature: v1=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>  (comma-separate for rotation)
 *   Body     { "id": "evt_…", "type": "payment.completed", "created_at": "ISO-8601", "data": { …record… } }
 *
 * Security: platform-specific secrets, constant-time signature comparison, ±5 minute timestamp window,
 * unique event ids (replays and duplicates are acknowledged but never processed twice), event allowlist,
 * every delivery logged. Processing runs in a durable job so slow work never blocks the sender.
 */
import { PLATFORM_IDS, type PlatformId } from '../config.js';
import type { Db } from '../db.js';
import { json, readText } from '../http.js';
import { enqueue, registerJob } from '../jobs.js';
import { hmacHex, safeEqual } from '../security.js';
import { normalize } from './normalize.js';
import { upsertRecord } from './references.js';
import { integrationRow, resolveConfig } from './registry.js';
import { CAPABILITIES, type Resource } from './types.js';

export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const MAX_WEBHOOK_BYTES = 512 * 1024;

export const EVENT_RESOURCE: Record<string, Resource> = {
    'user.created': 'users', 'user.updated': 'users',
    'order.created': 'orders', 'order.completed': 'orders', 'order.cancelled': 'orders',
    'request.created': 'requests', 'request.accepted': 'requests', 'request.completed': 'requests',
    'booking.created': 'bookings', 'booking.confirmed': 'bookings', 'booking.cancelled': 'bookings',
    'payment.pending': 'payments', 'payment.completed': 'payments', 'payment.failed': 'payments',
    'refund.created': 'refunds', 'refund.completed': 'refunds',
    'dispute.created': 'disputes',
    'commission.created': 'commissions',
};

/** Payment / refund events carry their status in the event type; it overrides an absent or stale field. */
const STATUS_FROM_EVENT: Record<string, string> = {
    'payment.pending': 'pending', 'payment.completed': 'completed', 'payment.failed': 'failed',
    'refund.created': 'pending', 'refund.completed': 'completed',
    'order.completed': 'completed', 'order.cancelled': 'cancelled',
    'request.accepted': 'accepted', 'request.completed': 'completed',
    'booking.confirmed': 'confirmed', 'booking.cancelled': 'cancelled',
};

export function signPayload(secret: string, timestamp: number, body: string): string {
    return `v1=${hmacHex(secret, `${timestamp}.${body}`)}`;
}

export function verifySignature(secret: string, timestampHeader: string | null, signatureHeader: string | null, body: string, nowMs = Date.now()):
    { ok: true } | { ok: false; reason: string } {
    if (!timestampHeader || !signatureHeader) return { ok: false, reason: 'missing signature headers' };
    const ts = Number(timestampHeader);
    if (!Number.isInteger(ts)) return { ok: false, reason: 'invalid timestamp' };
    if (Math.abs(nowMs / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp outside the allowed window (possible replay)' };
    const expected = signPayload(secret, ts, body);
    const candidates = signatureHeader.split(',').map((x) => x.trim()).filter((x) => x.startsWith('v1='));
    return candidates.some((c) => safeEqual(c, expected)) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

async function logDelivery(db: Db, platform: string, d: { eventId?: string | null; eventType?: string | null; valid: boolean; outcome: 'accepted' | 'duplicate' | 'rejected'; reason?: string; status: number; ip: string }) {
    await db.query(
        `INSERT INTO webhook_deliveries (platform, event_id, event_type, signature_valid, outcome, reason, http_status, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [platform, d.eventId ?? null, d.eventType ?? null, d.valid, d.outcome, d.reason ?? null, d.status, d.ip],
    );
}

export async function receiveWebhook(db: Db, platformParam: string, req: Request, ip: string): Promise<Response> {
    if (!(PLATFORM_IDS as string[]).includes(platformParam)) return json({ error: 'unknown platform' }, { status: 404 });
    const platform = platformParam as PlatformId;
    const reject = async (status: number, reason: string, valid = false, meta: { eventId?: string; eventType?: string } = {}) => {
        await logDelivery(db, platform, { ...meta, valid, outcome: 'rejected', reason, status, ip });
        return json({ error: reason }, { status });
    };

    const row = await integrationRow(db, platform);
    const { webhookSecret } = resolveConfig(row);
    if (!webhookSecret) return reject(503, 'webhooks are not configured for this platform');
    if (!row.enabled || row.mode !== 'live') return reject(409, 'this platform is not connected in live mode');

    let body: string;
    try { body = await readText(req, MAX_WEBHOOK_BYTES); } catch { return reject(413, 'payload too large'); }

    const sig = verifySignature(webhookSecret, req.headers.get('x-suskii-timestamp'), req.headers.get('x-suskii-signature'), body);
    if (!sig.ok) return reject(401, sig.reason);

    let event: { id?: unknown; type?: unknown; created_at?: unknown; data?: unknown };
    try { event = JSON.parse(body); } catch { return reject(400, 'malformed JSON', true); }
    const eventId = typeof event.id === 'string' && event.id.length <= 200 ? event.id : '';
    const eventType = typeof event.type === 'string' ? event.type : '';
    if (!eventId) return reject(400, 'missing event id', true);
    const resource = EVENT_RESOURCE[eventType];
    if (!resource) return reject(400, `unsupported event type: ${eventType || '(none)'}`, true, { eventId, eventType });
    if (!CAPABILITIES[platform].includes(resource)) return reject(422, `${eventType} is not applicable to ${platform}`, true, { eventId, eventType });
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return reject(400, 'missing event data object', true, { eventId, eventType });

    const inserted = await db.one<{ id: string }>(
        `INSERT INTO platform_events (platform, event_id, event_type, occurred_at, payload) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (platform, event_id) DO NOTHING RETURNING id`,
        [platform, eventId, eventType, typeof event.created_at === 'string' && !Number.isNaN(Date.parse(event.created_at)) ? event.created_at : null, JSON.stringify(event)],
    );
    if (!inserted) {
        await logDelivery(db, platform, { eventId, eventType, valid: true, outcome: 'duplicate', reason: 'event already received', status: 200, ip });
        return json({ ok: true, duplicate: true });
    }
    await logDelivery(db, platform, { eventId, eventType, valid: true, outcome: 'accepted', status: 202, ip });
    const jobId = await enqueue(db, 'process_event', { eventId: inserted.id });
    // Try to process immediately; if it fails the queued job retries with backoff.
    await processEvent(db, inserted.id).then(
        () => db.query(`UPDATE background_jobs SET status = 'succeeded', updated_at = now() WHERE id = $1 AND status = 'queued'`, [jobId]),
        () => undefined,
    );
    return json({ ok: true }, { status: 202 });
}

export async function processEvent(db: Db, id: string): Promise<void> {
    const ev = await db.one<{ id: string; platform: PlatformId; event_type: string; payload: { data: Record<string, unknown> }; status: string }>(
        `SELECT id, platform, event_type, payload, status FROM platform_events WHERE id = $1`, [id],
    );
    if (!ev || ev.status === 'processed' || ev.status === 'ignored') return;
    const resource = EVENT_RESOURCE[ev.event_type];
    try {
        const data = { ...ev.payload.data };
        if (STATUS_FROM_EVENT[ev.event_type] && !data.status) data.status = STATUS_FROM_EVENT[ev.event_type];
        const record = normalize(ev.platform, resource, data);
        await upsertRecord(db, resource, record as never);
        await db.query(`UPDATE platform_events SET status = 'processed', processed_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1`, [id]);
    } catch (e) {
        await db.query(`UPDATE platform_events SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 500)]);
        throw e;
    }
}

registerJob('process_event', async (db, payload) => processEvent(db, String(payload.eventId)));
