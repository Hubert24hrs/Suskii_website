# SUSKII central admin

The admin lives at **`/admin`** on this deployment (`https://suskii-website.vercel.app/admin`). It manages the corporate website and shows operations across SUSKII Marketplace, SUSKII Errands and SUSKII Travel & Tours. Each platform keeps its own database; the admin reads from them through their APIs and never writes to them.

> `suskii.com` is the separate Marketplace application. To serve the admin at `suskii.com/admin`, either point a subdomain such as `admin.suskii.com` at this Vercel project (recommended), or add a rewrite in the Marketplace project that proxies `/admin` and `/api` to this deployment.

## Contents

- [Signing in](#signing-in)
- [Pages](#pages)
- [Roles and permissions](#roles-and-permissions)
- [Corporate CMS](#corporate-cms)
- [Data rules](#data-rules)
- [Security measures](#security-measures)
- [Running it locally](#running-it-locally)
- [Tests](#tests)
- [Architecture](#architecture)

## Signing in

| Route | Purpose |
|---|---|
| `/admin/login` | Email and password, then a two-factor code if enabled. Redirects to `/admin/overview`. |
| `/admin/forgot` | Sends a 30-minute reset link (needs `RESEND_API_KEY`; otherwise a Super Admin issues the link). |
| `/admin/reset?token=…` | Sets a new password. The token is removed from the address bar immediately and works once. |
| `/admin/setup` | One-time creation of the first Super Admin. It works only while no administrator exists **and** `ADMIN_BOOTSTRAP_TOKEN` is set. |
| `/admin/account` | Your password, two-factor authentication, recovery codes and active sessions. |

There is no public registration. Administrators are invited from **Administrators**, and they set their own password through a one-time link. Nobody ever shares a password.

### Creating the first administrator

Use one of these. Both refuse to run once any administrator exists.

```bash
# Recommended: from a trusted machine, using the production DATABASE_URL
ADMIN_EMAIL=you@suskii.com ADMIN_NAME="Your Name" npm run admin:create
```

The command prints a strong one-time password. Change it after signing in, then turn on two-factor authentication.

The alternative is browser setup: set `ADMIN_BOOTSTRAP_TOKEN` (24 or more random characters) in Vercel, redeploy, open `/admin/setup` and enter the token. **Remove the variable afterwards.**

## Pages

| Section | Route | Notes |
|---|---|---|
| Overview | `/admin/overview` | KPIs, trends, platform comparison, status distribution, user growth, orders, errands and bookings, and platform status. Filters: platform, date range (today, 7, 30 or 90 days, custom), live or demo data. CSV export. |
| Platform Management | `/admin/platforms` | Connection state, the data each platform provides, and shortcuts. Management actions stay **disabled** until a platform exposes an API for them. |
| Transactions | `/admin/transactions` | Payments, refunds and commissions, read-only. |
| Orders | `/admin/orders` | Marketplace orders. |
| Errands | `/admin/errands` | Errand requests. |
| Travel & Bookings | `/admin/bookings` | Travel bookings. |
| Customers | `/admin/customers` | Platform customers. Emails are masked and personal data stays on the platforms. |
| Sellers & Providers | `/admin/providers` | Marketplace sellers and Errands providers. |
| Payments | `/admin/payments` | Payment status exactly as each platform reports it. |
| Commissions | `/admin/commissions` | Commission transactions. |
| Refunds & Disputes | `/admin/refunds` | Two tabs. Decisions are made on the owning platform. |
| Financial Reports | `/admin/finance` | Per-currency and per-platform GTV, revenue, refunds, commissions and pending payments, plus daily revenue. |
| Analytics | `/admin/analytics` | Success, failure and refund rates, growth and the activity mix. |
| Notifications | `/admin/notifications` | Sync failures, new inquiries and applications, filtered by permission. |
| Corporate CMS | `/admin/cms` | Website sections, News and Careers. See [Corporate CMS](#corporate-cms). |
| Media Library | `/admin/media` | Image uploads with descriptions (alt text). |
| Contact Inquiries | `/admin/inquiries` | Messages from the website contact form. Each has a status, notes and assignment. |
| Careers & Applications | `/admin/careers` | Applications for published job openings. CVs are downloaded through the server, and each download is audited. |
| Administrators | `/admin/users` | Invite, edit roles, disable, unlock, issue reset links, revoke sessions. |
| Roles & Permissions | `/admin/roles` | The permission matrix, plus custom roles. |
| Audit Logs | `/admin/audit-logs` | Every sign-in and every sensitive change. Filterable and exportable. |
| Integrations | `/admin/integrations` | Per-platform mode, URL, authentication, credentials (write-only), webhooks, connection test, manual sync, and history. |
| Settings | `/admin/settings` | Organisation details, the security policy (idle timeout, MFA for privileged roles) and deployment status. |

Every list has loading, empty and error states. Tables scroll on small screens, and below 960 px the sidebar becomes a drawer.

## Roles and permissions

Permissions are enforced by the server on every API request; the interface only hides what a role cannot use.

| Role | Can do |
|---|---|
| **Super Admin** | Everything, including granting privileged roles. |
| **Corporate Admin** *(privileged)* | CMS (edit, review, publish, delete), media, inquiries, careers, overview and analytics, reading settings and administrators. |
| **Finance Admin** *(privileged)* | Financial data on all platforms, overview, analytics, integration status. |
| **Marketplace Manager** | Marketplace records and finance, overview and analytics for that platform only. |
| **Errands Manager** | The same, for Errands only. |
| **Travel Manager** | The same, for Travel & Tours only. |
| **Content Manager** | Draft and edit content, and manage media. **Cannot approve or publish.** |
| **Analyst** | Read-only access to the overview, analytics and financial reports for all platforms. |

Rules:

- Only Super Admins can grant privileged roles.
- The last active Super Admin cannot be disabled or demoted.
- You cannot disable yourself.
- Built-in roles are fixed. Custom roles are listed under Roles & Permissions.

## Corporate CMS

The CMS edits the existing website in place: the same pages, URLs, SEO tags and structured data. Elements in `index.html` carry `data-cms` markers. At build time, published content is written into the static HTML, so visitors get plain, fast static pages.

**Workflow:** Draft → Pending review → Approved → Published, with Archived as a side state.

- Saving always creates a **draft**. Drafts are never public.
- Content Managers submit for review. Reviewers (`cms.review`) approve or request changes, with a note.
- Publishers (`cms.publish`) publish approved content. An administrator who has both review and publish rights can approve and publish in one step.
- **Scheduling:** approved content can be scheduled. The cron job publishes it on its first run after the scheduled time.
- **Revisions:** every save and state change is kept. Restoring a revision makes it a new draft; the live site only changes when that draft is published.
- **Preview:** "Preview draft" renders the saved draft inside the real page, with a "Preview · not published" bar and `noindex`.
- **Optimistic locking:** if someone else saved after you opened an entry, your save is refused rather than overwriting their work.
- **Reset to original** restores a section's draft to the website's original content.
- **News** (`/news/`, `/news/<slug>/`) and **Careers** (`/careers/`, `/careers/<slug>/`) pages are generated when they have published entries. Footer links appear automatically.
- **Sanitisation:** plain text is always escaped. Inline and rich-text fields are reduced to a strict allowlist on save. Scripts, event handlers, iframes and `javascript:` URLs are removed. Only `https://`, `mailto:` and site-relative links are accepted.
- **Going live:** publishing calls `VERCEL_DEPLOY_HOOK_URL`, and the live site updates in about a minute. Without the hook, changes go live on the next deployment ("Republish site" triggers it manually).

**Editable sections:** search and social sharing; Hero; Ecosystem; Platforms introduction; Marketplace, Errands and Travel & Tours (including availability notices and banners); Why SUSKII; About (with office locations); FAQ; Partners; Contact; Social links; Footer.

## Data rules

- **Never synthetic as real.** Demo mode is a per-platform setting, it is labelled **DEMO MODE** on every screen that shows it, demo record IDs start with `DEMO-`, and demo data is never stored or mixed with live data. Production disables demo mode unless `ALLOW_DEMO_MODE_IN_PRODUCTION=true`.
- **Revenue comes only from completed payments.**
  - Gross transaction value is the sum of completed payment amounts.
  - Platform revenue is the platform fee or commission on completed payments.
  - Pending, failed, refunded, reversed and cancelled payments are excluded.
  - Unknown, approved or authorised statuses count as pending.
- **Original currencies.** Every amount is stored in minor units with its ISO currency (RWF has 0 decimals, NGN has 2). Totals are shown per currency and are never converted or added across currencies. A record without a currency is rejected, never guessed.
- **The central admin never marks payments successful.** Statuses come from the platforms.
- **No live claims without a connection.** A platform shows *Connected* only after a real health check succeeds. Figures appear only after a successful synchronisation, and partial or failed syncs are shown as warnings.
- **Personal data stays on the platforms.** References keep IDs, masked emails and non-personal attributes; phone numbers, addresses, card and ID numbers are dropped.

## Security measures

| Area | Measure |
|---|---|
| Passwords | scrypt (N=2¹⁵, r=8, p=1), with a constant-time comparison. Passwords must be at least 12 characters and use three character classes, and may not contain the email name or common words. Timing is equalised for unknown accounts. |
| Sessions | 256-bit random token, stored only as a SHA-256 hash. The cookie is `HttpOnly`, `Secure` (production), `SameSite=Strict` and uses the `__Host-` prefix in production. Sessions expire after 30 minutes idle (configurable) and 12 hours absolute. They can be revoked individually, revoked all at once, and are revoked automatically on password reset, password change and account disablement. |
| CSRF | Per-session token in `X-CSRF-Token` on every state-changing request, plus an `Origin` check. |
| MFA | TOTP (RFC 6238), with the secret encrypted at rest. Ten single-use recovery codes are stored as hashes. Settings can require MFA for privileged roles, and enrolment is enforced server-side. |
| Brute force | Database-backed rate limits that work across serverless instances: login (20 per IP and 8 failures per account per 15 minutes), MFA, password reset, setup, public forms. Accounts lock for 15 minutes after 10 failures. One generic error message prevents account enumeration. |
| Authorisation | Each route declares its permission and the server checks it per request. Platform data is scoped to the platforms a role may read, and financial fields are removed without `finance.read`. |
| Secrets | Integration credentials and webhook secrets are encrypted with AES-256-GCM (key derived from `CENTRAL_ADMIN_SECRET` with HKDF). They are write-only from the browser, which only sees "set / source / last 4 characters". Environment variables take precedence. Nothing secret is in any browser file, and a test checks this. |
| Webhooks | HMAC-SHA256 over `timestamp.body`, a ±5-minute window, and constant-time comparison. Unique event IDs prevent replays and duplicates. There is an event allowlist per platform, a 512 KB limit, and every delivery is logged. |
| Uploads | File type is detected from content, not from the name. SVG and active content are refused. Images are re-encoded to WebP without metadata and capped at 4 MB. CVs are PDF only, encrypted at rest, never public, and downloaded through an audited endpoint. |
| Headers | `/admin`: CSP `default-src 'self'` with no inline script, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `noindex`, `no-store`. The API adds `nosniff` and HSTS in production. `robots.txt` disallows `/admin` and `/api/`. |
| Audit | Append-only `audit_logs` record sign-ins (successful and failed), MFA, password changes, user and role changes, settings, CMS actions, media, integration changes, tests, syncs and CV downloads, with actor, IP and target. Sensitive values are redacted. |
| Database | Forward-only migrations, each in a transaction. A test asserts there is no `DROP`, `TRUNCATE` or `DELETE`. |

## Running it locally

```bash
npm install
npm run dev                  # http://localhost:5173 (site) and http://localhost:5173/admin
ADMIN_EMAIL=me@suskii.test ADMIN_NAME="Me" npm run admin:create   # first local admin (prints a password)
```

`npm run dev` uses an embedded PostgreSQL (PGlite) in `.data/pglite`, so no database server is needed. To try the dashboards, set a platform to **Demo** in Integrations. A `.env` file is loaded if present (see `.env.example`).

## Tests

```bash
npm test              # site checks + 80 unit and integration tests (in-memory PostgreSQL)
npm run test:e2e      # Playwright: login, protected routes, CMS publish, contact form, mobile
npm run typecheck     # TypeScript, strict
npm run lint          # html-validate
```

If Playwright's own browsers are not installed, point it at an installed Chromium:
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

Coverage includes:

- migrations are non-destructive and idempotent
- the homepage renders identically from the CMS defaults
- authentication, sessions, CSRF, MFA and password reset
- rate limits and lockout
- RBAC scoping and privilege escalation
- the CMS workflow, scheduling, revisions and sanitisation
- that drafts are never public
- webhook signatures, replays and duplicates
- revenue and currency rules, and the separation of demo and live data
- mock adapters
- that a failing platform cannot crash the admin
- that secrets never reach the browser
- uploads, and CV encryption

## Architecture

```
admin/                 Admin SPA (vanilla ES modules, no build step): app.js shell, views/*, lib.js, charts.js, admin.css
api/index.ts           The single Vercel Function (vercel.json rewrites /api/* to it); routes everything under /api to server/
server/
  app.ts, http.ts      Router, security headers, errors
  db.ts, migrate.ts    PostgreSQL (pg) / PGlite, forward-only migrations
  auth/                rbac.ts (roles, permissions), session.ts (sessions, CSRF, rate limits)
  routes/              auth, admin, cms, data (overview, records, integrations, inquiries, careers), public (forms, webhooks, cron)
  cms/                 schema (content model), content (validation and sanitisation), render (static baking), pages (news, careers), service (workflow)
  integrations/        types (capabilities), adapters (REST per platform and a mock), http-client, normalize, references, sync, webhooks, registry
  reporting/           metrics (pure calculations), dataset (scope, live SQL aggregates, demo)
  media/               storage (Vercel Blob or local), service (validation, WebP, encrypted documents)
db/migrations/         0001_admin_core, 0002_cms, 0003_integrations
scripts/               build-site (bakes CMS content into dist/), dev-server, migrate, create-admin, check-site
tests/, e2e/           Vitest and Playwright
```

**Build:** `npm run build` copies the public files into `dist/` (an allowlist, so server code is never published). If `DATABASE_URL` is set it runs migrations and writes the published CMS content into the pages. If the database is unavailable, the committed pages are published unchanged, so a CMS problem can never take the website down.
