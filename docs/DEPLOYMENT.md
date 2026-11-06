# Deploying the admin and CMS

The public website keeps working exactly as before with **no** configuration. The build publishes the committed pages, and `/admin` shows "not set up yet". Turn the admin on with the steps below.

## Current production status

As of 2026-11-06, the admin is **active** on `https://suskii-website.vercel.app`.

| Item | State |
|---|---|
| Database | Neon Postgres (Vercel Marketplace), connected to Production **and Preview**. The tables were created by the build. |
| File storage | Vercel Blob store `suskii-media`, connected with `BLOB_READ_WRITE_TOKEN` (Production and Preview). |
| Secrets | `CENTRAL_ADMIN_SECRET`, `CRON_SECRET` and `SITE_ORIGIN` are set for Production. `ADMIN_BOOTSTRAP_TOKEN` was used once to create the first admin, then removed. |
| First Super Admin | `admin@suskii.com`, created 2026-11-06. **To do:** change the one-time password, turn on MFA, and enable the MFA policy. |
| Health | `GET /api/health` returns `{"ok":true,"admin":"ready"}`. `/api/setup` returns 403, so setup is closed. |
| Not configured yet | `VERCEL_DEPLOY_HOOK_URL` (publishing needs a manual redeploy until it is set), `RESEND_API_KEY` / `MAIL_FROM` (Super Admins share one-time links instead of email), every platform integration, and a custom domain. |
| Known risk | Preview deployments use the **production database**. Give Preview its own Neon branch or database, or remove `DATABASE_URL` from Preview. |

## 1. Database (PostgreSQL)

Any managed PostgreSQL 14+ works: **Neon** (Vercel Marketplace → Neon), Supabase or AWS RDS.

1. Create the database and copy the pooled connection string, with `sslmode=require`.
2. In Vercel → Project → Settings → Environment Variables, add `DATABASE_URL` for **Production** (and a *separate* database for Preview).
3. Migrations run automatically during every Vercel build (`npm run build`). They are forward-only and additive; there are no destructive changes. To run them by hand: `DATABASE_URL=… npm run db:migrate`. Redeploy once after adding `DATABASE_URL`, so the first migration runs.

**Backups.** Use the provider's point-in-time recovery (Neon keeps 7 days of history on the free plan, more on paid plans), and take a periodic logical backup:

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > suskii-admin-$(date +%F).dump
```

Store backups encrypted and outside the provider account. Test a restore with `pg_restore` into a scratch database every quarter.

## 2. Required secrets

| Variable | Notes |
|---|---|
| `CENTRAL_ADMIN_SECRET` | **Required.** 32 or more random characters. It encrypts integration credentials, MFA secrets and CVs. If you change it, saved credentials must be re-entered, MFA must be set up again, and existing CVs become unreadable. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `SITE_ORIGIN` | The public address, for example `https://suskii-website.vercel.app` or `https://admin.suskii.com`. It is used in reset links and webhook URLs. |
| `CRON_SECRET` | 24 or more random characters. Vercel Cron sends it automatically as a Bearer token. |

All values are server-side only. Never prefix them with `NEXT_PUBLIC_` and never commit them. `.env*` files are git-ignored, apart from `.env.example`.

## 3. Optional services

| Variable | Enables |
|---|---|
| `VERCEL_DEPLOY_HOOK_URL` | Publishing updates the live site automatically. Create the hook under Settings → Git → Deploy Hooks (branch `main`). |
| `BLOB_READ_WRITE_TOKEN` | Media uploads and job-application CVs. Add it from Storage → Blob. Required in production for uploads. |
| `RESEND_API_KEY`, `MAIL_FROM` | Invitation and password-reset emails. Without them, Super Admins get one-time links to share instead. |
| `SUSKII_*_API_URL`, `SUSKII_*_API_KEY`, `WEBHOOK_*_SECRET` | Platform connections; see [INTEGRATIONS.md](INTEGRATIONS.md). |
| `ADMIN_BOOTSTRAP_TOKEN` | One-time browser setup of the first Super Admin. Remove it after use. |
| `ALLOW_DEMO_MODE_IN_PRODUCTION` | Leave unset. Set it to `true` only for a clearly labelled demo environment. |

## 4. First administrator

Use **one** of these methods.

**Option A: from a trusted machine**, when you can copy the connection string:

```bash
DATABASE_URL="postgres://…" CENTRAL_ADMIN_SECRET="…" \
ADMIN_EMAIL=you@suskii.com ADMIN_NAME="Your Name" npm run admin:create
```

**Option B: one-time browser or API setup.** Use this when the database variables are marked *Sensitive* in Vercel. The Neon integration does this, so `vercel env pull` returns them empty. This is how production was set up.

1. Add `ADMIN_BOOTSTRAP_TOKEN` (24 or more random characters) to Production and redeploy.
2. Open `/admin/setup` and enter the token, your name, email and password. You can also `POST /api/setup` with `{ token, email, name, password }`. Setup only works while **no** administrator exists.
3. **Remove `ADMIN_BOOTSTRAP_TOKEN` and redeploy.** `GET /api/setup/status` should then report `"bootstrapEnabled": false`.

Then sign in at `/admin/login`:

1. Change the one-time password and turn on two-factor authentication under *My account*.
2. In *Settings → Security policy*, enable **Require two-factor authentication for privileged roles**.
3. Invite everyone else from *Administrators*.

Never create more admins through setup.

## 5. Deploy

The repository is linked to Vercel; pushing to `main` deploys to production.

- **Build:** `npm run build` writes `dist/`, which Vercel serves.
- **API:** the API is one Node function, `api/index.ts` (all `/api/*` paths are rewritten to it), with a maximum duration of 60 s. Don't rename it to a `[...path].ts` catch-all: on Vercel that matches only one path segment.
- **Runtime:** Node `24.x` (pinned in `package.json`). Production dependencies must load without `require()` of ES modules; a test checks this.
- **Cron:** `vercel.json` schedules `/api/cron` daily, which the Hobby plan allows. On Pro, change it to `*/15 * * * *` for 15-minute synchronisation and scheduled publishing.
- **Checking it:** after the deploy, `GET /api/health` returns `{ ok: true, admin: "ready" }`.

## 6. Domain

`suskii.com` belongs to the separate Marketplace application. There are two ways to reach the admin there:

- **Recommended:** add `admin.suskii.com` to this Vercel project and set `SITE_ORIGIN=https://admin.suskii.com`. Cookies are scoped to that host (`__Host-` prefix).
- **Alternative:** in the Marketplace project, proxy `/admin/*` and `/api/*` to this deployment. Do this only if both are served over HTTPS from the same origin.

## Rollback

Every deployment is immutable. In Vercel → Deployments, use **Instant Rollback** on the previous production deployment. The database schema is additive, so older code keeps working against a newer schema.

## Operations checklist

- [x] `CENTRAL_ADMIN_SECRET`, `DATABASE_URL` and `CRON_SECRET` are set for Production.
- [ ] Preview uses its own database, not the production one.
- [x] First Super Admin created (`admin@suskii.com`).
- [ ] Its one-time password is changed, MFA is on, and the MFA policy is enabled.
- [x] `ADMIN_BOOTSTRAP_TOKEN` is not set.
- [x] Blob storage is connected.
- [ ] The deploy hook and email are configured, or knowingly left off.
- [ ] Backups and point-in-time recovery are confirmed. A restore has been tested.
- [ ] Each platform stays **Not Configured** until its team provides the items in INTEGRATIONS.md.
