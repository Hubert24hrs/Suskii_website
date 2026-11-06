# Platform integrations

The central admin connects to **SUSKII Marketplace**, **SUSKII Errands** and **SUSKII Travel & Tours** separately. Each platform keeps its own database. The admin only reads, and it stores a minimal reference copy (IDs, statuses, amounts, timestamps, masked emails) in its own database for reporting.

> **Status: no platform is connected yet.** The endpoint paths below are *proposed contracts* from the project brief. None of them is assumed to exist. Each platform stays **Not Configured** until its team confirms or provides its real API and a health check passes.

## How a platform is connected

1. The platform team provides the information in [What each platform team must provide](#what-each-platform-team-must-provide).
2. A Super Admin sets the values in Vercel environment variables (preferred) or in **Admin → Integrations**.

   | Variable | Example |
   |---|---|
   | `SUSKII_MARKETPLACE_API_URL` | `https://api.suskii.com/v1` |
   | `SUSKII_MARKETPLACE_API_KEY` | the token or key; for Basic auth use `user:password` |
   | `WEBHOOK_MARKETPLACE_SECRET` | 24 or more random characters, shared with the platform team |

   The same three variables exist for `ERRANDS` and `TRAVEL`. Environment values take precedence over admin-entered values, and admin-entered secrets are encrypted at rest (AES-256-GCM).
3. In **Integrations → Configuration**:
   - set the mode to **Live**
   - choose the authentication type (`Bearer`, `API key header`, `Basic` or `None`)
   - set a timeout and a sync interval
   - optionally override endpoint paths and pagination under *Advanced*
4. **Test connection** calls the health path. The platform shows **Connected** only if that call succeeds.
5. **Synchronise now**, or wait for the scheduled job. The dashboards show live figures only after the first successful sync.

### Connection states

| State | Meaning |
|---|---|
| Not Configured | Mode is not set, or the integration is disabled. |
| Disconnected | Configured, but the health check has not passed. |
| Connecting | A health check is running. |
| Connected | The last health check or sync succeeded. |
| Degraded | Some resources failed to sync. |
| Synchronization Failed | The whole last sync failed. Data may be stale and the dashboards say so. |
| Demo Mode | Synthetic data, labelled everywhere. Never stored, and never in production unless explicitly allowed. |

## Proposed API contract (all platforms)

Base URL: `https://…` (HTTPS is required). Every request is a `GET` with `Accept: application/json` and the agreed authentication header.

### Pagination

- Cursor style (the default): `?limit=100&cursor=<opaque>&updated_since=<ISO-8601>`. The response gives the next cursor as `next_cursor`, `nextCursor`, `meta.next_cursor` or `next`, and omits it or returns `null` on the last page.
- Page style (configurable): `?page=1&limit=100&updated_since=…`. The last page has fewer than `limit` items.
- The parameter names can be overridden per platform.

### Responses

A bare array, or an object with the items in `data`, `items`, `results`, `records` or `rows`.

### Incremental sync

The `updated_since` parameter must return records **created or changed** since that time. Without it, every sync re-reads everything.

### Errors

The admin interprets responses like this:

| Response | Meaning |
|---|---|
| `401` / `403` | Bad credentials. Not retried. |
| `404` | Wrong path. |
| `429` | Rate limited. `Retry-After` is honoured. |
| `5xx` | Retried with backoff (GET only). |
| Any other non-2xx | An error. |

### Fields read

Common aliases are accepted. Unknown extra fields are kept in `attributes`, except personal data.

| Record | Required | Used if present |
|---|---|---|
| Any | `id` (or `_id`, `uuid`, `reference`) | `created_at`, `updated_at` |
| User | `id` | `email` (stored masked), `display_name`, `name`, `first_name`, `last_name`, `country`, `status`, `verification_status`, `created_at` |
| Transaction, payment, refund or commission | `id`, `currency` (ISO 4217), `amount` (decimal) **or** `amount_minor` (integer) | `status`, `type`, `fee` / `commission` / `platform_fee` (or `*_minor`), `method`, `customer_id`, `order_id` / `booking_id` / `request_id`, `occurred_at` / `paid_at` / `created_at` |
| Order or errand request | `id`, `status` | `amount`, `currency`, `customer_id`, `seller_id` / `provider_id`, `title`, `created_at` |
| Booking | `id`, `status` | `amount`, `currency`, `customer_id`, `package_id`, `title`, `travel_date`, `created_at` |
| Dispute | `id`, `status` | `reason`, `amount`, `currency`, `related_type`, `related_id`, `opened_at`, `resolved_at` |

### Payment status mapping

Confirm this mapping with each platform.

| Platform value | Central status | Counts as revenue? |
|---|---|---|
| `completed`, `complete`, `success`, `successful`, `succeeded`, `paid`, `settled`, `captured` | completed | **Yes** (the fee or commission) |
| `failed`, `declined`, `error`, `rejected`, `expired` | failed | No |
| `refunded`, `partially_refunded` | refunded | No |
| `reversed`, `chargeback` | reversed | No |
| `cancelled`, `canceled`, `void`, `abandoned` | cancelled | No |
| anything else (including `approved`, `authorized`, missing) | pending | No |

A transaction **without a valid currency is rejected** and logged; a currency is never assumed.

### Personal data

The admin never stores phone numbers, addresses, names split into first and last, card or bank numbers, national IDs, dates of birth, coordinates, IP addresses, passwords or tokens. Emails are stored masked (`j•••@example.com`). The platforms should send only what is needed.

## Webhooks (optional, for real-time updates)

```
POST https://suskii-website.vercel.app/api/webhooks/{marketplace|errands|travel_tour}
Content-Type: application/json
X-Suskii-Timestamp: <unix seconds>
X-Suskii-Signature: v1=<hex HMAC-SHA256(webhook_secret, "<timestamp>.<raw body>")>

{ "id": "evt_123", "type": "payment.completed", "created_at": "2026-01-01T12:00:00Z", "data": { …record as above… } }
```

- **Event types:**
  - `user.created`, `user.updated`
  - `order.created`, `order.completed`, `order.cancelled`
  - `request.created`, `request.accepted`, `request.completed`
  - `booking.created`, `booking.confirmed`, `booking.cancelled`
  - `payment.pending`, `payment.completed`, `payment.failed`
  - `refund.created`, `refund.completed`
  - `dispute.created`
  - `commission.created`

  Only events for resources the platform provides are accepted.
- **Signature rules:**
  - A timestamp more than 5 minutes off is rejected, which prevents replays.
  - Each `id` is processed once; repeats get `200 {duplicate: true}`.
  - During secret rotation, several signatures can be sent comma-separated.
- **Responses:**

  | Code | Meaning |
  |---|---|
  | `202` | Accepted |
  | `200` | Duplicate |
  | `400` | Malformed or unknown event |
  | `401` | Bad signature or timestamp |
  | `409` | Platform not in live mode |
  | `413` | Body over 512 KB |
  | `422` | Event not applicable to this platform |
  | `503` | Secret not configured |

  The platform should retry on `5xx` and network errors with backoff.
- The `data.status` sent by the platform wins over the status implied by the event type. The central admin never decides that a payment succeeded.

Example signer (Node.js):

```js
import { createHmac } from 'node:crypto';
const ts = Math.floor(Date.now() / 1000);
const body = JSON.stringify(event);
const sig = 'v1=' + createHmac('sha256', process.env.SUSKII_WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suskii-Timestamp': String(ts), 'X-Suskii-Signature': sig }, body });
```

## What each platform team must provide

### For every platform

1. **The production API base URL** (HTTPS), plus a staging URL if one exists.
2. **The authentication method:**
   - a server-to-server token or API key, with its header name (`Authorization: Bearer …`, `X-API-Key`, or Basic)
   - its scope, which must be **read-only**
   - its rotation policy
   - any IP allowlisting (Vercel functions have no fixed outbound IP unless Secure Compute is used)
3. **A health-check path** that is cheap and authenticated (for example `GET /users?limit=1` or `GET /health`).
4. **Pagination:** cursor or page style, the parameter names, the maximum page size and the response envelope.
5. **Incremental sync:** an `updated_since`-style filter, and whether deletions appear (soft-delete flag or tombstones).
6. **Rate limits**, and whether `Retry-After` is sent.
7. **The real endpoint paths and field names** for each resource listed below, with one sample JSON response each, sanitised.
8. **Status vocabularies** for payments, orders, requests, bookings and disputes, to confirm the mapping above.
9. **Money format:** decimal or minor units, the currency field, which currencies are possible (for example NGN, RWF), and which field holds the platform's fee or commission.
10. **Time zone** of timestamps; ISO-8601 with an offset is preferred.
11. **Webhooks** (optional): whether the platform can send the events above, signed as described, and a contact for rotating the shared secret.
12. **Management actions** (optional, for later): the admin shows these disabled until a platform offers an API for them (refunds, cancellations, verification, suspension and so on). Each needs a write endpoint, an idempotency key, the authorisation rules, and confirmation that the platform audits it.

### SUSKII Marketplace (`marketplace`)

Proposed endpoints:

| Resource | Path |
|---|---|
| Users | `/users` |
| Sellers | `/sellers` |
| Orders | `/orders` |
| Transactions | `/transactions` |
| Payments | `/payments` |
| Commissions | `/commissions` |
| Refunds | `/refunds` |
| Disputes | `/disputes` |
| Analytics | `/analytics` |

Specific questions:

- **Transactions or payments?** Does `/transactions` include payments, refunds and commissions with a `type` field, or are they separate? (Sync reads `transactions` and skips `payments` when both exist.)
- **Order statuses:** which status means *completed* or *delivered*, and are cancellations separate?
- **Seller verification:** which field holds the seller verification and KYC status?
- **Disputes:** what are the dispute statuses, and which field links a dispute to its order or transaction?
- **Platform services:** is `suskii.com` (the Angular app) backed by an API at `api.suskii.com`, or by another service? Which team owns it?

### SUSKII Errands (`errands`)

Proposed endpoints:

| Resource | Path |
|---|---|
| Users | `/users` |
| Providers | `/providers` |
| Services | `/services` |
| Requests | `/requests` |
| Transactions | `/transactions` |
| Payments | `/payments` |
| Commissions | `/commissions` |
| Disputes | `/disputes` |
| Analytics | `/analytics` |

Specific questions:

- **Request lifecycle:** what is the full list of request statuses? The admin counts `open`, `pending`, `accepted`, `assigned`, `in_progress` and `ongoing` as *active*.
- **Pricing:** does a request carry its own price and currency, or does only the payment?
- **Provider records:** which fields hold provider verification and service areas?
- **Currencies:** which currencies apply (for example RWF only, or also NGN)?

### SUSKII Travel & Tours (`travel_tour`)

Proposed endpoints:

| Resource | Path |
|---|---|
| Users | `/users` |
| Packages | `/packages` |
| Bookings | `/bookings` |
| Transactions | `/transactions` |
| Payments | `/payments` |
| Refunds | `/refunds` |
| Analytics | `/analytics` |

Specific questions:

- **Booking statuses:** what are they, and which field holds the travel or departure date?
- **Revenue:** how are deposits, instalments and partial refunds represented? Which amount is revenue (a commission or margin field)?
- **Third-party payments:** are bookings paid to third-party operators? If so, which share is SUSKII's?
- **Disputes:** this platform has no disputes in the proposed contract. Confirm whether it has any.

## Synchronisation

- **Schedule:** Vercel Cron calls `/api/cron` with `Authorization: Bearer $CRON_SECRET`. On the Hobby plan it runs daily (`0 6 * * *` in `vercel.json`); on Pro it can run more often, for example `*/15 * * * *`. Each platform also respects its own *sync interval*.
- **Each run, per platform that is due:**
  - each supported resource, page by page, from the last successful sync time
  - upsert into the reference tables, keyed by `(platform, source_id)`, so there are no duplicates
- **Failures:**
  - Failed resources are logged, the platform is marked *Degraded* or *Synchronization Failed*, and a notification is sent.
  - The other platforms and the dashboards keep working.
  - Malformed rows are skipped, not stored.
- **Time budget:** a run stops before the function time limit, and the next run continues.
- **Where to look:** every job, webhook delivery, processed event and log line is shown in *Integrations → Sync & event history*.
