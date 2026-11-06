# CLAUDE.md — working on the SUSKII website

The SUSKII corporate site (`https://suskii-website.vercel.app`) plus a central admin and CMS at `/admin`.

- **Public site:** static HTML, CSS and vanilla JS, with no framework.
- **Admin:** a vanilla-JS single-page app in `admin/`, served by one TypeScript Vercel Function (`api/index.ts` → `server/`), on PostgreSQL (Neon in production).

The admin is live and active as of 2026-11-06. See [Current production state](#current-production-state).

## Commands

```bash
npm install
npm run dev            # site + admin at http://localhost:5173; embedded PostgreSQL (PGlite) in .data/pglite
npm run admin:create   # ADMIN_EMAIL=… ADMIN_NAME=… [ADMIN_PASSWORD=…] — first admin; refuses if one exists
npm test               # scripts/check-site.mjs + Vitest (80 tests, in-memory PGlite)
npm run test:e2e       # Playwright (10 tests). If its browsers aren't installed:
                       #   PLAYWRIGHT_CHROMIUM_PATH=<path to chrome-headless-shell.exe> npm run test:e2e
npm run typecheck      # tsc --noEmit, strict, NodeNext
npm run lint           # html-validate on *.html and admin/index.html
npm run build          # writes dist/ (what Vercel serves); bakes CMS content in if DATABASE_URL is set
npm audit              # keep at 0 vulnerabilities
```

Before calling work done, run `typecheck`, `lint`, `npm test` and `npm ci`. `npm ci` resolves peer dependencies as strictly as Vercel does.

## Layout

```
index.html, privacy.html, terms.html, 404.html, referral.html   public pages (committed, and the CMS template)
css/styles.css, js/main.js                                     public design system and progressive enhancement
admin/            admin SPA: app.js (router/shell), lib.js (DOM, api(), formatting), charts.js, views/*.js, admin.css
api/index.ts      the only Vercel Function; vercel.json rewrites /api/:path* to it
server/           app.ts + http.ts (router), db.ts (pg | PGlite), migrate.ts, auth/, routes/, cms/, integrations/,
                  reporting/, media/, mail.ts, audit.ts, notify.ts, jobs.ts
db/migrations/    forward-only SQL (0001_admin_core, 0002_cms, 0003_integrations)
scripts/          build-site.ts, dev-server.ts, migrate.ts, create-admin.ts, check-site.mjs
tests/, e2e/      Vitest and Playwright
docs/             ADMIN.md (features, roles, security), INTEGRATIONS.md (platform API contract), DEPLOYMENT.md
```

## How the CMS reaches the public site

- Elements in `index.html` carry `data-cms`, `data-cms-attr`, `data-cms-html`, `data-cms-list`, `data-cms-banner`, `data-cms-jsonld` and `data-cms-slot` markers.
- `server/cms/schema.ts` defines each section's fields. Its **defaults are the current site content**, and `tests/cms-render.test.ts` checks that rendering the defaults reproduces `index.html` exactly. If you change visible copy in `index.html`, change the matching default too, or that test fails.
- At build time, `scripts/build-site.ts` renders the published content into `dist/`, along with `/news/` and `/careers/` and sitemap entries. If the database is missing or unreachable, it publishes the committed pages unchanged. Never let the CMS break the public deploy.
- Publishing triggers `VERCEL_DEPLOY_HOOK_URL`. That variable isn't set yet, so for now "Republish site" or a manual redeploy is needed.

## Rules (from the project brief; do not relax them)

- **Never commit secrets.** `.env*` (except `.env.example`), `.data/` and `dist/` are git-ignored. Browser code must not contain secrets; `tests/bundle.test.ts` checks this.
- **No public admin registration and no default passwords.** Only Super Admins grant privileged roles. Enforce permissions in the server (`requireAdmin(ctx, perm)`), not only in the UI.
- **Never present synthetic data as real.** Demo mode is per platform, labelled DEMO MODE everywhere and never stored. It is off in production unless `ALLOW_DEMO_MODE_IN_PRODUCTION=true`. Never fall back to demo silently.
- **Money:**
  - Revenue counts only *completed* payments; `approved` and `authorized` stay pending.
  - Amounts are kept in minor units in their original currency, and are never converted or summed across currencies.
  - A record with no currency is rejected, never guessed.
  - The admin never marks a payment successful.
- **No live claims without proof.** A platform shows "Connected" only after a real health check succeeds. The platform API paths are *proposed contracts*; nothing is connected yet (see docs/INTEGRATIONS.md).
- **Migrations** are additive only. A test rejects `DROP`, `TRUNCATE` and `DELETE FROM`. Add a new numbered file; never edit an applied one.
- **External links:** only verified URLs. Add new ones to `VERIFIED_URLS` in `scripts/check-site.mjs`. The partner domains (myeyahomes.com, eyaautos.com) are placeholders listed in `NOT_YET_LIVE`; the real domains will come later.
- **Asset versions:** after editing `css/styles.css` or `js/main.js`, bump `?v=` in every HTML file and `ASSET_VERSION` in `server/cms/pages.ts` (currently `2.7.0`).

## Vercel gotchas (learned the hard way)

- **Functions:** `api/[...path].ts` matches only **one** path segment on Vercel. Keep the single `api/index.ts` plus the `/api/:path*` → `/api` rewrite. `tests/bundle.test.ts` guards this.
- **ES modules:** Vercel's function loader can't `require()` ES modules, although local Node 22 can. `sanitize-html` 2.18 pulls ESM-only `htmlparser2` 12, so `package.json` overrides it to `^10.1.0`. A test loads the API with `--no-experimental-require-module`; keep it.
- **Node and test tooling:**
  - `engines.node` is pinned to `24.x`. A `>=` range makes Vercel pick the newest major.
  - `html-validate` 11 only accepts `vitest` 3 or 4. Don't upgrade vitest to 5 until html-validate allows it; `npm ci` fails on Vercel otherwise.
- **Environment variables:**
  - The Neon variables (`DATABASE_URL` and friends) are **Sensitive**: `vercel env pull` returns them empty, so `npm run admin:create` can't reach the production database from a laptop. To create another first-admin-style account, use Admin → Administrators → Invite. In an emergency: set `ADMIN_BOOTSTRAP_TOKEN`, redeploy, `POST /api/setup`, then remove the token and redeploy.
  - Preview deployments currently share the production `DATABASE_URL`. Don't run destructive experiments on preview links.
- **Preview access:** preview URLs are behind Vercel login (HTTP 302 to vercel.com). Use the browser pane while signed in to Vercel. `vercel curl` did not work on this Windows setup.

## Current production state

As of 2026-11-06 (PRs #2 and #3 merged):

- **Vercel project:** `hubert25-s-projects/suskii-website`. Production is the `main` branch.
- **Storage:** Neon Postgres connected to Production and Preview. Blob store `suskii-media` connected (`BLOB_READ_WRITE_TOKEN`).
- **Production variables:** `CENTRAL_ADMIN_SECRET`, `CRON_SECRET` and `SITE_ORIGIN` are set. `ADMIN_BOOTSTRAP_TOKEN` was used once and then removed.
- **Not set yet:** `VERCEL_DEPLOY_HOOK_URL`, `RESEND_API_KEY` / `MAIL_FROM`, and all `SUSKII_*_API_*` / `WEBHOOK_*_SECRET`.
- **First Super Admin:** `admin@suskii.com`. The owner must change the one-time password and turn on MFA.
- **Health check:** `GET /api/health` returns `{"ok":true,"admin":"ready"}`.
- **Cron:** runs daily on the Hobby plan.
- **Open decisions:** the admin domain (`admin.suskii.com` is recommended; `suskii.com` is the separate Marketplace app), a separate Preview database, the email provider, and each platform team's API details.

## Working agreements

- Work on a branch and open a PR. **Ask the owner before merging to `main`**, because it deploys to production. The auto-mode permission check blocks `gh pr merge` until the owner explicitly says "merge PR #N".
- Do not create third-party accounts (for example Neon) on the owner's behalf; ask them to do that step.
- Verify changes in a browser (`npm run dev`, or the `suskii-dev` entry in `.claude/launch.json`) as well as with tests.
