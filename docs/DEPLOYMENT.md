# Deploying the admin and CMS

The public website keeps working exactly as before with **no** configuration. The build publishes the committed pages, and `/admin` shows "not set up yet". Turn the admin on with the steps below.

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

```bash
DATABASE_URL="postgres://…" CENTRAL_ADMIN_SECRET="…" \
ADMIN_EMAIL=you@suskii.com ADMIN_NAME="Your Name" npm run admin:create
```

Sign in at `/admin/login`, change the one-time password, and turn on two-factor authentication under *My account*. Then, in *Settings → Security policy*, enable **Require two-factor authentication for privileged roles**.

## 5. Deploy

The repository is linked to Vercel; pushing to `main` deploys to production.

- **Build:** `npm run build` writes `dist/`, which Vercel serves.
- **API:** the API is one Node function, `api/[...path].ts`, with a maximum duration of 60 s.
- **Cron:** `vercel.json` schedules `/api/cron` daily, which the Hobby plan allows. On Pro, change it to `*/15 * * * *` for 15-minute synchronisation and scheduled publishing.
- **Checking it:** after the deploy, `GET /api/health` returns `{ ok: true, admin: "ready" }`.

## 6. Domain

`suskii.com` belongs to the separate Marketplace application. There are two ways to reach the admin there:

- **Recommended:** add `admin.suskii.com` to this Vercel project and set `SITE_ORIGIN=https://admin.suskii.com`. Cookies are scoped to that host (`__Host-` prefix).
- **Alternative:** in the Marketplace project, proxy `/admin/*` and `/api/*` to this deployment. Do this only if both are served over HTTPS from the same origin.

## Rollback

Every deployment is immutable. In Vercel → Deployments, use **Instant Rollback** on the previous production deployment. The database schema is additive, so older code keeps working against a newer schema.

## Operations checklist

- [ ] `CENTRAL_ADMIN_SECRET`, `DATABASE_URL` and `CRON_SECRET` are set for Production, with separate values for Preview.
- [ ] First Super Admin created, password changed, MFA on, and the MFA policy enabled.
- [ ] `ADMIN_BOOTSTRAP_TOKEN` is not set.
- [ ] Blob, the deploy hook and email are configured, or knowingly left off.
- [ ] Backups and point-in-time recovery are confirmed. A restore has been tested.
- [ ] Each platform stays **Not Configured** until its team provides the items in INTEGRATIONS.md.
