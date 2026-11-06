/**
 * Assembles the API. One entry point serves every /api route (a single Vercel function).
 */
import { PLATFORM_IDS, type PlatformId } from './config.js';
import { clientIp, type Ctx, errorResponse, json, notFound, Router, withSecurityHeaders } from './http.js';
import { registerJob } from './jobs.js';
import { syncPlatform } from './integrations/sync.js';
import './integrations/webhooks.js'; // registers the process_event job
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { cmsRoutes } from './routes/cms.js';
import { dataRoutes } from './routes/data.js';
import { publicRoutes } from './routes/public.js';

registerJob('sync_platform', async (db, payload) => {
    const platform = String(payload.platform) as PlatformId;
    if (!PLATFORM_IDS.includes(platform)) throw new Error('Unknown platform');
    const summary = await syncPlatform(db, platform, { trigger: 'cron' });
    if (summary.status === 'failed') throw new Error(summary.message || 'Synchronisation failed');
});

export const router = new Router();
publicRoutes(router);
authRoutes(router);
adminRoutes(router);
cmsRoutes(router);
dataRoutes(router);

export async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const ctx: Ctx = { req, url, params: {}, ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? '', state: {} };
    try {
        const m = router.match(req.method, url.pathname);
        if (m === null) throw notFound('No such API endpoint');
        if (m === 'method') return withSecurityHeaders(json({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }, { status: 405 }));
        ctx.params = m.params;
        const res = await m.route.handler(ctx);
        return withSecurityHeaders(res);
    } catch (e) {
        return withSecurityHeaders(errorResponse(e));
    }
}
