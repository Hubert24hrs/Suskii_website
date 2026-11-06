# Changelog

All notable changes to the SUSKII website. Dates are UTC.

## 3.0.2 — 2026-11-06: production activation

- **Activated the central admin on production.** These were set up in Vercel, not in the code:
  - Neon Postgres connected
  - Vercel Blob store `suskii-media` connected
  - `CENTRAL_ADMIN_SECRET`, `CRON_SECRET` and `SITE_ORIGIN` set
  - the first Super Admin, `admin@suskii.com`, created through one-time setup; the setup token was then removed
- **Documentation:**
  - added `CLAUDE.md` (commands, architecture, rules, Vercel pitfalls) and this changelog
  - `docs/DEPLOYMENT.md` now records the production status and the second first-admin method
  - updated the README

## 3.0.1 — 2026-11-06: Vercel fixes (PR #3)

- **Fixed every `/api` request crashing on Vercel (`ERR_REQUIRE_ESM`).**
  - Cause: `sanitize-html` 2.18 `require()`s `htmlparser2` 12, which is ESM-only. Vercel's loader rejects that.
  - Fix: `htmlparser2` is overridden to `^10.1.0`, which ships both CommonJS and ESM.
- **Fixed nested API paths returning 404 on Vercel.**
  - Cause: `api/[...path].ts` only matched one path segment.
  - Fix: replaced it with `api/index.ts` and a `/api/:path*` rewrite.
- **Added regression tests** for both: the API must load with `--no-experimental-require-module`, and `vercel.json` must route every `/api` path to the function.

## 3.0.0 — 2026-11-06: central admin, CMS and integrations (PR #2)

- **Admin at `/admin`**, with 23 sections: overview, platforms, transactions, orders, errands, bookings, customers, providers, payments, commissions, refunds and disputes, finance, analytics, notifications, CMS, media, inquiries, careers, administrators, roles, audit logs, integrations and settings. It also has sign-in, two-factor, password recovery and account pages, and works on phones.
- **Corporate CMS** for the existing homepage, with URLs and SEO unchanged:
  - workflow: Draft → Pending Review → Approved → Published → Archived
  - revisions, scheduling, preview and optimistic locking
  - News and Careers pages, a contact form, and job applications with encrypted CV storage
- **Security:**
  - scrypt passwords, and hashed, HttpOnly `SameSite=Strict` sessions with idle and absolute expiry
  - CSRF protection, TOTP MFA, rate limits and lockout
  - 8 roles enforced on the server
  - AES-256-GCM for stored secrets
  - an audit log, and a strict admin Content Security Policy (CSP)
- **Integration layer** for Marketplace, Errands and Travel & Tours:
  - adapters, a retrying HTTP client, and normalisers that strip personal data
  - signed webhooks with replay protection, and cron sync
  - a labelled demo mode
  - nothing connected yet; see `docs/INTEGRATIONS.md`
- **Reporting:** revenue counts completed payments only; each currency is kept separate; partial-data warnings are shown.
- **Other changes:**
  - PostgreSQL migrations, PGlite for local development and tests
  - 80 Vitest tests and 10 Playwright tests
  - `robots.txt` now disallows `/admin` and `/api/`
  - Node pinned to 24.x
- **Bugs found while testing and fixed:**
  - an invalid JSON escape in `vercel.json`
  - successful sign-ins counted towards the lockout limit
  - a transaction without a currency was assumed to be NGN
  - `approved` card payments counted as revenue
  - the meta description was longer than the editor allowed
  - the Careers footer link returned 404 when no jobs were published

## 2.x — before 2026-11-06

- **2.6:** the corporate ecosystem redesign:
  - the Marketplace, Errands and Travel & Tours showcase, the official logo, and the Y-shaped hero diagram
  - offices in Kigali, Lagos, "Across Africa" and "Globally soon"
  - the Partners section (My Eya Homes, Eya Autos; placeholder domains)
  - fixes for mobile, iPhone and iPad
  - performance and accessibility work (PageSpeed mobile 99, desktop 100)
  - removed the floating install bar, the Mobile Apps section and the final call-to-action section
