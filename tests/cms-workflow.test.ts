import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../server/db.js';
import { runScheduledPublishing } from '../server/cms/service.js';
import { renderSitePages } from '../server/cms/site.js';
import { as, call, createAdmin, createSuperAdmin, freshDb, login, type Session } from './helpers.js';

let db: Db;
let owner: Session, editor: Session, reviewer: Session;
const template = readFileSync('index.html', 'utf8');
const news = (title: string) => ({ title, summary: 'Short summary.', body: '<p>Article body</p>', date: '2026-03-01', author: '', seoTitle: '', seoDescription: '', cover: null });

beforeAll(async () => {
    db = await freshDb();
    await createSuperAdmin(db);
    await createAdmin(db, 'editor@suskii.test', ['content_manager']);
    // A reviewer who can approve but not publish.
    await db.query(`INSERT INTO admin_roles (id, name, description, is_system, is_privileged) VALUES ('custom_reviewer', 'Reviewer', '', false, false)`);
    for (const p of ['cms.read', 'cms.review']) await db.query(`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ('custom_reviewer', $1)`, [p]);
    await createAdmin(db, 'reviewer@suskii.test', ['custom_reviewer']);
    [owner, editor, reviewer] = await Promise.all([login('owner@suskii.test'), login('editor@suskii.test'), login('reviewer@suskii.test')]);
});

async function sectionId(key: string): Promise<string> {
    return (await db.one<{ id: string }>(`SELECT id FROM cms_entries WHERE collection = 'section' AND key = $1`, [key]))!.id;
}

describe('editorial workflow', () => {
    it('drafts are never public until approved and published', async () => {
        const id = await sectionId('home.hero');
        const entry = (await as(editor)('GET', `/api/cms/entries/${id}`)).body.entry;
        const saved = await as(editor)('PUT', `/api/cms/entries/${id}`, { data: { ...entry.draft, eyebrow: 'Draft badge text' }, version: entry.version });
        expect(saved.status).toBe(200);
        expect(saved.body.entry.status).toBe('draft');
        let pages = await renderSitePages(db, template);
        expect(pages.get('/')).not.toContain('Draft badge text');

        expect((await as(editor)('POST', `/api/cms/entries/${id}/publish`)).status).toBe(403);
        expect((await as(editor)('POST', `/api/cms/entries/${id}/submit`)).body.entry.status).toBe('pending_review');
        expect((await as(editor)('POST', `/api/cms/entries/${id}/approve`)).status).toBe(403);
        expect((await as(reviewer)('POST', `/api/cms/entries/${id}/approve`)).body.entry.status).toBe('approved');
        expect((await as(reviewer)('POST', `/api/cms/entries/${id}/publish`)).status).toBe(403);
        pages = await renderSitePages(db, template);
        expect(pages.get('/')).not.toContain('Draft badge text');

        const pub = await as(owner)('POST', `/api/cms/entries/${id}/publish`);
        expect(pub.status).toBe(200);
        expect(pub.body.entry.status).toBe('published');
        expect(pub.body.rebuild.triggered).toBe(false); // no deploy hook configured in tests
        pages = await renderSitePages(db, template);
        expect(pages.get('/')).toContain('Draft badge text');
    });

    it('a reviewer can send content back with a note', async () => {
        const id = await sectionId('home.faq');
        const entry = (await as(editor)('GET', `/api/cms/entries/${id}`)).body.entry;
        await as(editor)('PUT', `/api/cms/entries/${id}`, { data: entry.draft, version: entry.version });
        await as(editor)('POST', `/api/cms/entries/${id}/submit`);
        const rejected = await as(reviewer)('POST', `/api/cms/entries/${id}/reject`, { note: 'Please shorten' });
        expect(rejected.body.entry.status).toBe('draft');
        const revs = (await as(editor)('GET', `/api/cms/entries/${id}`)).body.revisions;
        expect(revs[0].note).toMatch(/Please shorten/);
    });

    it('rejects stale saves (optimistic locking) instead of overwriting', async () => {
        const id = await sectionId('site.footer');
        const entry = (await as(editor)('GET', `/api/cms/entries/${id}`)).body.entry;
        expect((await as(editor)('PUT', `/api/cms/entries/${id}`, { data: entry.draft, version: entry.version })).status).toBe(200);
        expect((await as(editor)('PUT', `/api/cms/entries/${id}`, { data: entry.draft, version: entry.version })).status).toBe(409);
    });

    it('sanitises rich content on save', async () => {
        const created = await as(editor)('POST', '/api/cms/entries', { collection: 'news', slug: 'xss-check', data: { ...news('XSS check'), body: '<p>ok</p><script>alert(1)</script><img src="x" onerror="y()">' } });
        expect(created.status).toBe(200);
        expect(created.body.entry.draft.body).not.toMatch(/script|onerror/);
    });

    it('creates, publishes, unpublishes, archives and restores news; slugs are unique', async () => {
        const created = await as(editor)('POST', '/api/cms/entries', { collection: 'news', slug: 'launch', data: news('We launched') });
        expect(created.status).toBe(200);
        expect((await as(editor)('POST', '/api/cms/entries', { collection: 'news', slug: 'launch', data: news('Again') })).status).toBe(409);
        expect((await as(editor)('POST', '/api/cms/entries', { collection: 'news', slug: 'Bad Slug!', data: news('x') })).status).toBe(400);
        const id = created.body.entry.id;
        let pages = await renderSitePages(db, template);
        expect(pages.has('/news/launch/')).toBe(false);
        expect((await as(owner)('POST', `/api/cms/entries/${id}/publish`)).status).toBe(200);
        pages = await renderSitePages(db, template);
        expect(pages.get('/news/launch/')).toContain('We launched');
        expect(pages.get('/news/')).toContain('/news/launch/');
        expect(pages.get('/careers/')).toContain('no open roles'); // linked from the footer, so it must exist
        expect(pages.get('/')).toContain('href="/news/"');
        expect((await as(owner)('POST', `/api/cms/entries/${id}/unpublish`)).status).toBe(200);
        pages = await renderSitePages(db, template);
        expect(pages.has('/news/launch/')).toBe(false);
        expect((await as(owner)('POST', `/api/cms/entries/${id}/archive`)).body.entry.status).toBe('archived');
        expect((await as(editor)('PUT', `/api/cms/entries/${id}`, { data: news('x') })).status).toBe(400);
        expect((await as(owner)('POST', `/api/cms/entries/${id}/restore`)).body.entry.status).toBe('draft');
    });

    it('schedules publication and the scheduler publishes when due', async () => {
        const created = await as(editor)('POST', '/api/cms/entries', { collection: 'news', slug: 'scheduled', data: news('Scheduled story') });
        const id = created.body.entry.id;
        expect((await as(owner)('POST', `/api/cms/entries/${id}/schedule`, { publishAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
        const sched = await as(owner)('POST', `/api/cms/entries/${id}/schedule`, { publishAt: new Date(Date.now() + 3600_000).toISOString() });
        expect(sched.status).toBe(200);
        expect(await runScheduledPublishing(db)).toBe(0);
        await db.query(`UPDATE cms_entries SET publish_at = now() - interval '1 minute' WHERE id = $1`, [id]);
        expect(await runScheduledPublishing(db)).toBe(1);
        const pages = await renderSitePages(db, template);
        expect(pages.get('/news/scheduled/')).toContain('Scheduled story');
    });

    it('restores an earlier revision as a new draft without touching the live site', async () => {
        const id = await sectionId('home.hero');
        const { revisions } = (await as(owner)('GET', `/api/cms/entries/${id}`)).body;
        const first = revisions[revisions.length - 1];
        const restored = await as(owner)('POST', `/api/cms/entries/${id}/restore-revision`, { revisionId: first.id });
        expect(restored.body.entry.status).toBe('draft');
        expect(restored.body.entry.draft.eyebrow).toBe('The SUSKII ecosystem');
        expect((await renderSitePages(db, template)).get('/')).toContain('Draft badge text');
    });

    it('homepage sections cannot be deleted or archived', async () => {
        const id = await sectionId('home.about');
        expect((await as(owner)('DELETE', `/api/cms/entries/${id}`)).status).toBe(400);
        expect((await as(owner)('POST', `/api/cms/entries/${id}/archive`)).status).toBe(400);
    });

    it('preview requires a session and is marked noindex', async () => {
        const id = await sectionId('home.hero');
        expect((await call('GET', `/api/cms/preview/${id}`)).status).toBe(401);
        const res = await call('GET', `/api/cms/preview/${id}`, { cookie: owner.cookie });
        expect(res.status).toBe(200);
        expect(res.text).toContain('noindex');
        expect(res.text).toContain('Preview');
    });

    it('records every content action in the audit log', async () => {
        const actions = (await db.query<{ action: string }>(`SELECT DISTINCT action FROM audit_logs WHERE action LIKE 'cms.%'`)).map((r) => r.action);
        for (const a of ['cms.save_draft', 'cms.submit', 'cms.approve', 'cms.reject', 'cms.publish', 'cms.unpublish', 'cms.archive', 'cms.restore', 'cms.schedule', 'cms.create', 'cms.restore_revision']) expect(actions).toContain(a);
    });
});

describe('public forms', () => {
    it('accepts valid inquiries, ignores bots, validates input and rate-limits', async () => {
        const ok = await call('POST', '/api/public/inquiries', { body: { name: 'Ada', email: 'ada@example.test', topic: 'general', message: 'Hello there, a question.' }, ip: '192.0.2.10' });
        expect(ok.status).toBe(200);
        const bot = await call('POST', '/api/public/inquiries', { body: { name: 'Bot', email: 'bot@example.test', message: 'spam spam spam', website: 'http://spam' }, ip: '192.0.2.11' });
        expect(bot.status).toBe(200);
        expect((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM contact_inquiries WHERE name = 'Bot'`))!.n).toBe(0);
        expect((await call('POST', '/api/public/inquiries', { body: { name: 'A', email: 'not-an-email', message: 'Hello there' }, ip: '192.0.2.12' })).status).toBe(400);
        const form = await call('POST', '/api/public/inquiries', { raw: new URLSearchParams({ name: 'No JS', email: 'nojs@example.test', message: 'Sent without JavaScript' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, ip: '192.0.2.13' });
        expect(form.status).toBe(303);
        expect(form.headers.get('location')).toBe('/?inquiry=sent#contact');
        const statuses: number[] = [];
        for (let i = 0; i < 7; i++) statuses.push((await call('POST', '/api/public/inquiries', { body: { name: 'R', email: 'r@example.test', message: 'Repeated message text' }, ip: '192.0.2.99' })).status);
        expect(statuses).toContain(429);
        const n = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM central_notifications WHERE type = 'inquiry.new'`);
        expect(n!.n).toBeGreaterThan(0);
    });
});
