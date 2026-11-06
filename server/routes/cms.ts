import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { audit } from '../audit.js';
import { requireAdmin } from '../auth/session.js';
import { badRequest, HttpError, json, notFound, pagination, readBytes, readJson, type Router } from '../http.js';
import { MAX_UPLOAD_BYTES, deleteMedia, uploadImage } from '../media/service.js';
import { storageConfigured } from '../media/storage.js';
import { COLLECTION_FIELDS, SECTIONS } from '../cms/schema.js';
import { mergeContent, renderHome } from '../cms/render.js';
import { renderArticle, renderJob } from '../cms/pages.js';
import {
    type Action, createEntry, deleteEntry, draftSiteContent, getEntry, listEntries, publishedCollection, resetSection, restoreRevision, revisions,
    saveDraft, transition, triggerRebuild,
} from '../cms/service.js';
import { int, oneOf, optIsoDate, optStr, slug, uuid } from '../validate.js';

const ACTIONS = ['submit', 'approve', 'reject', 'publish', 'unpublish', 'schedule', 'unschedule', 'archive', 'restore'] as const satisfies readonly Action[];

export async function loadTemplate(name: 'index.html'): Promise<string> {
    return readFile(join(process.cwd(), name), 'utf8');
}

export function cmsRoutes(r: Router): void {
    r.get('/api/cms/schema', async (ctx) => {
        await requireAdmin(ctx, 'cms.read');
        return json({
            sections: SECTIONS.map(({ key, title, group, description, fields }) => ({ key, title, group, description, fields })),
            collections: COLLECTION_FIELDS,
        });
    });

    r.get('/api/cms/entries', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'cms.read');
        const collection = oneOf(ctx.url.searchParams.get('collection') ?? 'section', 'collection', ['section', 'news', 'job'] as const);
        const rows = await listEntries(db, collection);
        return json({
            items: rows.map((e) => ({
                id: e.id, collection: e.collection, key: e.key, title: e.title, status: e.status, version: e.version,
                publishAt: e.publish_at, publishedAt: e.published_at, updatedAt: e.updated_at, updatedByName: (e as any).updated_by_name ?? null,
                hasUnpublishedChanges: e.published !== null && JSON.stringify(e.draft) !== JSON.stringify(e.published),
                isLive: e.published !== null,
            })),
        });
    });

    r.get('/api/cms/entries/:id', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'cms.read');
        const entry = await getEntry(db, uuid(ctx.params.id));
        return json({ entry, revisions: await revisions(db, entry.id) });
    });

    r.post('/api/cms/entries', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'cms.edit');
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const collection = oneOf(body.collection, 'collection', ['news', 'job'] as const);
        const entry = await createEntry(db, admin, collection, slug(body.slug), body.data);
        await audit(db, ctx, admin.user, { action: 'cms.create', targetType: `cms_${collection}`, targetId: entry.id, metadata: { slug: entry.key } });
        return json({ entry });
    });

    r.put('/api/cms/entries/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'cms.edit');
        const body = await readJson<{ data?: unknown; note?: unknown; version?: unknown }>(ctx.req);
        const entry = await saveDraft(db, admin, uuid(ctx.params.id), body.data, optStr(body.note, 'note', { max: 200 }) ?? '', body.version === undefined ? undefined : int(body.version, 'version'));
        await audit(db, ctx, admin.user, { action: 'cms.save_draft', targetType: `cms_${entry.collection}`, targetId: entry.id, metadata: { key: entry.key, version: entry.version } });
        return json({ entry });
    });

    r.post('/api/cms/entries/:id/:action', async (ctx) => {
        const id = uuid(ctx.params.id);
        if (ctx.params.action === 'restore-revision') {
            const { db, admin } = await requireAdmin(ctx, 'cms.edit');
            const body = await readJson<{ revisionId?: unknown }>(ctx.req);
            const entry = await restoreRevision(db, admin, id, int(body.revisionId, 'revisionId', { min: 1 }));
            await audit(db, ctx, admin.user, { action: 'cms.restore_revision', targetType: `cms_${entry.collection}`, targetId: id, metadata: { revisionId: body.revisionId } });
            return json({ entry });
        }
        if (ctx.params.action === 'reset') {
            const { db, admin } = await requireAdmin(ctx, 'cms.edit');
            const entry = await resetSection(db, admin, id);
            await audit(db, ctx, admin.user, { action: 'cms.reset_section', targetType: 'cms_section', targetId: id, metadata: { key: entry.key } });
            return json({ entry });
        }
        const action = oneOf(ctx.params.action, 'action', ACTIONS);
        const { db, admin } = await requireAdmin(ctx, 'cms.read');
        const body = ctx.req.headers.get('content-type')?.includes('json') ? await readJson<{ note?: unknown; publishAt?: unknown }>(ctx.req) : {};
        const result = await transition(db, admin, id, action, { note: optStr(body.note, 'note', { max: 300 }) ?? undefined, publishAt: optIsoDate(body.publishAt, 'publishAt') });
        await audit(db, ctx, admin.user, { action: `cms.${action}`, targetType: `cms_${result.entry.collection}`, targetId: id, metadata: { key: result.entry.key, publishAt: result.entry.publish_at } });
        const rebuild = result.liveChanged ? await triggerRebuild(db, `${action} ${result.entry.key}`) : null;
        return json({ entry: result.entry, rebuild });
    });

    r.delete('/api/cms/entries/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'cms.delete');
        const id = uuid(ctx.params.id);
        const entry = await getEntry(db, id);
        const res = await deleteEntry(db, admin, id);
        await audit(db, ctx, admin.user, { action: 'cms.delete', targetType: `cms_${entry.collection}`, targetId: id, metadata: { key: entry.key, title: entry.title } });
        const rebuild = res.liveChanged ? await triggerRebuild(db, `delete ${entry.key}`) : null;
        return json({ ok: true, rebuild });
    });

    // Preview renders draft content inside the real page template; never cached, never indexed.
    r.get('/api/cms/preview/:id', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'cms.read');
        const entry = await getEntry(db, uuid(ctx.params.id));
        let html: string;
        if (entry.collection === 'section') {
            const content = mergeContent(await draftSiteContent(db, entry.id));
            const news = await publishedCollection(db, 'news');
            const jobs = await publishedCollection(db, 'job');
            html = renderHome(await loadTemplate('index.html'), content, { preview: { label: entry.title }, newsCount: news.length, jobsCount: jobs.length, contactForm: true });
        } else if (entry.collection === 'news') {
            html = renderArticle(entry.key, entry.draft, { preview: true });
        } else {
            html = renderJob(entry.key, entry.draft, { preview: true, applyEnabled: false });
        }
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'; form-action 'none'",
                'X-Frame-Options': 'SAMEORIGIN',
            },
        });
    });

    r.post('/api/cms/rebuild', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'cms.publish');
        const res = await triggerRebuild(db, 'manual');
        await audit(db, ctx, admin.user, { action: 'cms.rebuild', metadata: { triggered: res.triggered } });
        return json(res);
    });

    // ─── Media library ───
    r.get('/api/media', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'media.read');
        const { pageSize, offset, page } = pagination(ctx.url, { pageSize: 40 });
        const q = (ctx.url.searchParams.get('q') ?? '').slice(0, 80);
        const params: unknown[] = q ? [`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`] : [];
        const where = `kind = 'image' AND deleted_at IS NULL${q ? ' AND (filename ILIKE $1 OR alt ILIKE $1)' : ''}`;
        const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM media_assets WHERE ${where}`, params))?.n ?? 0;
        const items = await db.query(`SELECT m.id, m.filename, m.url, m.mime, m.width, m.height, m.size_bytes, m.alt, m.variants, m.created_at, u.name AS uploaded_by_name
                                      FROM media_assets m LEFT JOIN admin_users u ON u.id = m.uploaded_by WHERE ${where.replace(/\b(kind|deleted_at|filename|alt)\b/g, 'm.$1')}
                                      ORDER BY m.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
        return json({ items, total, page, pageSize, storageConfigured: storageConfigured() });
    });

    r.post('/api/media', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'media.manage');
        const filename = decodeURIComponent(ctx.req.headers.get('x-filename') ?? 'upload');
        const alt = decodeURIComponent(ctx.req.headers.get('x-alt-text') ?? '');
        const type = ctx.req.headers.get('content-type') ?? '';
        if (!type.startsWith('image/') && type !== 'application/octet-stream') throw badRequest('Send the image file as the request body.');
        const bytes = await readBytes(ctx.req, MAX_UPLOAD_BYTES).catch((e) => {
            if (e instanceof HttpError && e.status === 413) throw new HttpError(413, 'payload_too_large', 'Images must be 4 MB or smaller.');
            throw e;
        });
        const asset = await uploadImage(db, { bytes, filename, alt, userId: admin.user.id });
        await audit(db, ctx, admin.user, { action: 'media.upload', targetType: 'media', targetId: asset.id, metadata: { filename: asset.filename, bytes: asset.size_bytes } });
        return json({ asset });
    });

    r.patch('/api/media/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'media.manage');
        const id = uuid(ctx.params.id);
        const body = await readJson<{ alt?: unknown }>(ctx.req);
        const alt = optStr(body.alt, 'alt', { max: 300 }) ?? '';
        const row = await db.one(`UPDATE media_assets SET alt = $2 WHERE id = $1 AND deleted_at IS NULL AND kind = 'image' RETURNING id`, [id, alt]);
        if (!row) throw notFound('Media not found');
        await audit(db, ctx, admin.user, { action: 'media.update_alt', targetType: 'media', targetId: id });
        return json({ ok: true });
    });

    r.delete('/api/media/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'media.manage');
        const row = await deleteMedia(db, uuid(ctx.params.id));
        await audit(db, ctx, admin.user, { action: 'media.delete', targetType: 'media', targetId: row.id, metadata: { filename: row.filename } });
        return json({ ok: true });
    });
}
