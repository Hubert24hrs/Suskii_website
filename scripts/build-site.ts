/**
 * Production build (Vercel runs `npm run build`):
 *  1. Copies only public files into dist/ (server code, migrations and tooling are never published).
 *  2. If DATABASE_URL is set: applies migrations and bakes published CMS content into the static pages,
 *     generating /news and /careers. If the database is not configured or unreachable, the committed
 *     pages are published unchanged — the public site can never be broken by the CMS.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDatabaseConfigured } from '../server/config.js';

const ROOT = process.cwd();
const OUT = join(ROOT, 'dist');
const PUBLIC_FILES = ['index.html', 'privacy.html', 'terms.html', '404.html', 'referral.html', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'site.webmanifest'];
const PUBLIC_DIRS = ['assets', 'css', 'js', 'admin'];
const ORIGIN = 'https://suskii-website.vercel.app';

async function copyPublic(): Promise<void> {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    for (const f of PUBLIC_FILES) await cp(join(ROOT, f), join(OUT, f));
    for (const d of PUBLIC_DIRS) if (existsSync(join(ROOT, d))) await cp(join(ROOT, d), join(OUT, d), { recursive: true });
}

/** Break-glass admin password recovery (server/auth/recovery.ts). Never runs on Preview deployments. */
async function maybeRecoverAdmin(db: import('../server/db.js').Db): Promise<void> {
    const email = process.env.ADMIN_RECOVERY_EMAIL ?? '';
    const passwordHash = process.env.ADMIN_RECOVERY_PASSWORD_HASH ?? '';
    if (!email && !passwordHash) return;
    if (process.env.VERCEL_ENV === 'preview') {
        console.warn('[build] ADMIN_RECOVERY_* is set on a Preview deployment; ignored. Set it for Production only.');
        return;
    }
    try {
        const { applyPasswordRecovery } = await import('../server/auth/recovery.js');
        const res = await applyPasswordRecovery(db, { email, passwordHash, resetMfa: process.env.ADMIN_RECOVERY_RESET_MFA === 'true' });
        console.log(`[build] admin recovery: ${res.message}`);
    } catch (e) {
        console.error('[build] admin recovery failed:', (e as Error).message);
    }
}

async function bakeCms(): Promise<string> {
    const { getDb } = await import('../server/db.js');
    const { migrate } = await import('../server/migrate.js');
    const { renderSitePages } = await import('../server/cms/site.js');
    const db = await getDb();
    const applied = await migrate(db, (m) => console.log(`[build] migration ${m}`));
    await maybeRecoverAdmin(db);
    const pages = await renderSitePages(db, await readFile(join(ROOT, 'index.html'), 'utf8'));
    for (const [path, html] of pages) {
        const file = path === '/' ? join(OUT, 'index.html') : join(OUT, ...path.split('/').filter(Boolean), 'index.html');
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(file, html);
    }
    const extraUrls = [...pages.keys()].filter((p) => p !== '/');
    if (extraUrls.length) {
        const sitemap = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');
        const today = new Date().toISOString().slice(0, 10);
        const extra = extraUrls.map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${today}</lastmod><priority>0.5</priority></url>`).join('\n');
        await writeFile(join(OUT, 'sitemap.xml'), sitemap.replace('</urlset>', `${extra}\n</urlset>`));
    }
    await db.close();
    return `CMS content published: ${pages.size} page(s), ${applied.length} new migration(s)`;
}

async function main(): Promise<void> {
    await copyPublic();
    if (!isDatabaseConfigured()) {
        console.log('[build] DATABASE_URL is not set: publishing the committed static pages unchanged.');
        return;
    }
    try {
        console.log(`[build] ${await bakeCms()}`);
    } catch (e) {
        // Never fail the public deployment because of the CMS: keep the committed pages.
        console.error('[build] WARNING: could not load CMS content; publishing committed pages unchanged.', (e as Error).message);
        await cp(join(ROOT, 'index.html'), join(OUT, 'index.html'));
    }
}

main().catch((e) => {
    console.error('[build] failed', e);
    process.exit(1);
});
