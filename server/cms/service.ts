/**
 * CMS persistence and editorial workflow:
 *   draft → pending_review → approved → published → archived
 * Editors (cms.edit) draft and submit; reviewers (cms.review) approve or reject; publishers
 * (cms.publish) publish, unpublish or schedule. A user holding both review and publish may publish
 * directly — the approval is recorded against them.
 */
import { deployHookUrl } from '../config.js';
import type { Db } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../http.js';
import type { AdminContext } from '../auth/session.js';
import { COLLECTION_FIELDS, SECTIONS, SECTION_BY_KEY, type FieldDef } from './schema.js';
import { validateContent } from './content.js';
import type { SiteContent } from './render.js';

export type Collection = 'section' | 'news' | 'job';
export type Status = 'draft' | 'pending_review' | 'approved' | 'published' | 'archived';
export type Action = 'submit' | 'approve' | 'reject' | 'publish' | 'unpublish' | 'schedule' | 'unschedule' | 'archive' | 'restore';

export interface EntryRow {
    id: string;
    collection: Collection;
    key: string;
    title: string;
    status: Status;
    draft: Record<string, unknown>;
    published: Record<string, unknown> | null;
    version: number;
    publish_at: Date | null;
    published_at: Date | null;
    created_at: Date;
    updated_at: Date;
    created_by: string | null;
    updated_by: string | null;
}

export function fieldsFor(collection: Collection, key: string): FieldDef[] {
    if (collection === 'section') {
        const def = SECTION_BY_KEY.get(key);
        if (!def) throw notFound('Unknown section');
        return def.fields;
    }
    return COLLECTION_FIELDS[collection];
}

/** Imports the website's current content as the first published version of every section. */
export async function seedCmsDefaults(db: Db): Promise<void> {
    for (const s of SECTIONS) {
        const row = await db.one<{ id: string }>(
            `INSERT INTO cms_entries (collection, key, title, status, draft, published, version, published_at)
             VALUES ('section', $1, $2, 'published', $3, $3, 1, now())
             ON CONFLICT (collection, key) WHERE deleted_at IS NULL DO NOTHING RETURNING id`,
            [s.key, s.title, JSON.stringify(s.defaults)],
        );
        if (row) {
            await db.query(`INSERT INTO cms_revisions (entry_id, version, status, data, note) VALUES ($1, 1, 'published', $2, 'Imported from the existing website')`,
                [row.id, JSON.stringify(s.defaults)]);
        }
    }
}

export async function listEntries(db: Db, collection: Collection): Promise<EntryRow[]> {
    return db.query<EntryRow>(
        `SELECT e.*, u.name AS updated_by_name FROM cms_entries e LEFT JOIN admin_users u ON u.id = e.updated_by
         WHERE e.collection = $1 AND e.deleted_at IS NULL ORDER BY ${collection === 'section' ? 'e.key' : 'e.updated_at DESC'}`,
        [collection],
    );
}

export async function getEntry(db: Db, id: string): Promise<EntryRow> {
    const row = await db.one<EntryRow>(`SELECT * FROM cms_entries WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!row) throw notFound('Content entry not found');
    return row;
}

export async function revisions(db: Db, id: string) {
    return db.query(
        `SELECT r.id, r.version, r.status, r.note, r.created_at, u.name AS author_name, u.email AS author_email
         FROM cms_revisions r LEFT JOIN admin_users u ON u.id = r.author_id WHERE r.entry_id = $1 ORDER BY r.version DESC LIMIT 100`,
        [id],
    );
}

async function addRevision(db: Db, entry: { id: string }, version: number, status: Status, data: unknown, admin: AdminContext, note: string) {
    await db.query(`INSERT INTO cms_revisions (entry_id, version, status, data, note, author_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.id, version, status, JSON.stringify(data), note.slice(0, 300), admin.user.id]);
}

export async function createEntry(db: Db, admin: AdminContext, collection: 'news' | 'job', slug: string, data: unknown): Promise<EntryRow> {
    if (!admin.permissions.has('cms.edit')) throw forbidden();
    const clean = validateContent(fieldsFor(collection, slug), data);
    const exists = await db.one(`SELECT 1 FROM cms_entries WHERE collection = $1 AND key = $2 AND deleted_at IS NULL`, [collection, slug]);
    if (exists) throw conflict('An entry with this slug already exists. Choose another slug.');
    return db.tx(async (t) => {
        const row = await t.one<EntryRow>(
            `INSERT INTO cms_entries (collection, key, title, draft, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
            [collection, slug, String(clean.title), JSON.stringify(clean), admin.user.id],
        );
        await addRevision(t, row!, 1, 'draft', clean, admin, 'Created');
        return row!;
    });
}

export async function saveDraft(db: Db, admin: AdminContext, id: string, data: unknown, note = '', expectedVersion?: number): Promise<EntryRow> {
    if (!admin.permissions.has('cms.edit')) throw forbidden();
    const entry = await getEntry(db, id);
    if (entry.status === 'archived') throw badRequest('Restore this entry before editing it.');
    if (expectedVersion !== undefined && expectedVersion !== entry.version) {
        throw conflict('Someone else saved this content after you opened it. Reload to see their changes.');
    }
    const clean = validateContent(fieldsFor(entry.collection, entry.key), data);
    const title = entry.collection === 'section' ? entry.title : String(clean.title);
    return db.tx(async (t) => {
        const row = await t.one<EntryRow>(
            `UPDATE cms_entries SET draft = $2, title = $3, status = 'draft', publish_at = NULL, version = version + 1,
                 updated_by = $4, updated_at = now() WHERE id = $1 RETURNING *`,
            [id, JSON.stringify(clean), title, admin.user.id],
        );
        await addRevision(t, row!, row!.version, 'draft', clean, admin, note || 'Draft saved');
        return row!;
    });
}

const NEED: Record<Action, ('cms.edit' | 'cms.review' | 'cms.publish' | 'cms.delete')[]> = {
    submit: ['cms.edit'],
    approve: ['cms.review'],
    reject: ['cms.review'],
    publish: ['cms.publish'],
    schedule: ['cms.publish'],
    unschedule: ['cms.publish'],
    unpublish: ['cms.publish'],
    archive: ['cms.delete'],
    restore: ['cms.delete'],
};

export interface TransitionResult { entry: EntryRow; liveChanged: boolean }

export async function transition(db: Db, admin: AdminContext, id: string, action: Action, opts: { note?: string; publishAt?: Date | null } = {}): Promise<TransitionResult> {
    for (const p of NEED[action]) if (!admin.permissions.has(p)) throw forbidden();
    const entry = await getEntry(db, id);
    const s = entry.status;
    const canSelfApprove = admin.permissions.has('cms.review') && admin.permissions.has('cms.publish');
    const isSection = entry.collection === 'section';
    const hasUnpublishedDraft = JSON.stringify(entry.draft) !== JSON.stringify(entry.published);

    const update = async (set: string, params: unknown[], status: Status, note: string, liveChanged = false): Promise<TransitionResult> =>
        db.tx(async (t) => {
            const row = await t.one<EntryRow>(`UPDATE cms_entries SET ${set}, status = '${status}', version = version + 1, updated_by = $2, updated_at = now() WHERE id = $1 RETURNING *`,
                [id, admin.user.id, ...params]);
            await addRevision(t, row!, row!.version, status, row!.draft, admin, opts.note ? `${note}: ${opts.note}` : note);
            return { entry: row!, liveChanged };
        });

    switch (action) {
        case 'submit':
            if (s !== 'draft') throw badRequest('Only drafts can be submitted for review.');
            return update('reviewed_by = NULL', [], 'pending_review', 'Submitted for review');
        case 'approve':
            if (s !== 'pending_review') throw badRequest('Only content pending review can be approved.');
            return update('reviewed_by = $2', [], 'approved', 'Approved');
        case 'reject':
            if (s !== 'pending_review') throw badRequest('Only content pending review can be sent back.');
            return update('reviewed_by = NULL', [], 'draft', 'Changes requested');
        case 'publish': {
            if (s === 'archived') throw badRequest('Restore this entry before publishing it.');
            if (s === 'published' && !hasUnpublishedDraft) throw badRequest('This content is already live.');
            if (s !== 'approved' && !canSelfApprove) throw badRequest('Content must be approved before it is published.');
            return update(`published = draft, published_at = now(), published_by = $2, publish_at = NULL, reviewed_by = COALESCE(reviewed_by, $2)`, [], 'published', 'Published', true);
        }
        case 'schedule': {
            if (!opts.publishAt || opts.publishAt.getTime() < Date.now() + 60_000) throw badRequest('Choose a publication time at least a minute in the future.');
            if (s !== 'approved' && !canSelfApprove) throw badRequest('Content must be approved before it can be scheduled.');
            if (s === 'archived') throw badRequest('Restore this entry first.');
            return update(`publish_at = $3, reviewed_by = COALESCE(reviewed_by, $2)`, [opts.publishAt.toISOString()], 'approved', `Scheduled for ${opts.publishAt.toISOString()}`);
        }
        case 'unschedule':
            if (!entry.publish_at) throw badRequest('This entry is not scheduled.');
            return update('publish_at = NULL', [], s === 'published' ? 'published' : 'approved', 'Schedule cancelled');
        case 'unpublish':
            if (isSection) throw badRequest('Homepage sections cannot be unpublished. Edit them, or reset them to the original content.');
            if (!entry.published) throw badRequest('This entry is not published.');
            return update('published = NULL, published_at = NULL', [], 'draft', 'Unpublished', true);
        case 'archive':
            if (isSection) throw badRequest('Homepage sections cannot be archived.');
            return update('published = NULL, publish_at = NULL', [], 'archived', 'Archived', entry.published !== null);
        case 'restore':
            if (s !== 'archived') throw badRequest('Only archived entries can be restored.');
            return update('reviewed_by = NULL', [], 'draft', 'Restored from archive');
    }
}

export async function restoreRevision(db: Db, admin: AdminContext, id: string, revisionId: number): Promise<EntryRow> {
    const rev = await db.one<{ data: Record<string, unknown>; version: number }>(`SELECT data, version FROM cms_revisions WHERE id = $1 AND entry_id = $2`, [revisionId, id]);
    if (!rev) throw notFound('Revision not found');
    return saveDraft(db, admin, id, rev.data, `Restored version ${rev.version}`);
}

export async function resetSection(db: Db, admin: AdminContext, id: string): Promise<EntryRow> {
    const entry = await getEntry(db, id);
    const def = SECTION_BY_KEY.get(entry.key);
    if (entry.collection !== 'section' || !def) throw badRequest('Only homepage sections can be reset.');
    return saveDraft(db, admin, id, def.defaults, 'Reset to the original website content');
}

export async function deleteEntry(db: Db, admin: AdminContext, id: string): Promise<{ liveChanged: boolean }> {
    if (!admin.permissions.has('cms.delete')) throw forbidden();
    const entry = await getEntry(db, id);
    if (entry.collection === 'section') throw badRequest('Homepage sections cannot be deleted.');
    await db.query(`UPDATE cms_entries SET deleted_at = now(), published = NULL, updated_by = $2, updated_at = now() WHERE id = $1`, [id, admin.user.id]);
    return { liveChanged: entry.published !== null };
}

// ─── Reading published content for the public site ───
export async function publishedSiteContent(db: Db): Promise<SiteContent> {
    const rows = await db.query<{ key: string; published: Record<string, unknown> | null }>(
        `SELECT key, published FROM cms_entries WHERE collection = 'section' AND deleted_at IS NULL AND published IS NOT NULL`,
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.published!]));
}

export async function draftSiteContent(db: Db, overrideId?: string): Promise<SiteContent> {
    const live = await publishedSiteContent(db);
    if (overrideId) {
        const e = await getEntry(db, overrideId);
        if (e.collection === 'section') live[e.key] = e.draft;
    }
    return live;
}

export interface PublishedItem { key: string; data: Record<string, unknown>; published_at: Date }

export async function publishedCollection(db: Db, collection: 'news' | 'job'): Promise<PublishedItem[]> {
    return db.query<PublishedItem>(
        `SELECT key, published AS data, published_at FROM cms_entries
         WHERE collection = $1 AND deleted_at IS NULL AND published IS NOT NULL ORDER BY published_at DESC`,
        [collection],
    );
}

/** Publishes approved entries whose scheduled time has passed. Returns how many went live. */
export async function runScheduledPublishing(db: Db): Promise<number> {
    const due = await db.query<{ id: string; version: number }>(
        `UPDATE cms_entries SET published = draft, published_at = now(), status = 'published', publish_at = NULL, version = version + 1, updated_at = now()
         WHERE publish_at IS NOT NULL AND publish_at <= now() AND status = 'approved' AND deleted_at IS NULL
         RETURNING id, version`,
    );
    for (const d of due) {
        await db.query(`INSERT INTO cms_revisions (entry_id, version, status, data, note)
                        SELECT id, version, 'published', draft, 'Published on schedule' FROM cms_entries WHERE id = $1`, [d.id]);
    }
    return due.length;
}

/**
 * Asks Vercel to rebuild the static site so published content goes live. The build bakes content
 * into the pages, keeping the public site fully static and fast.
 */
export async function triggerRebuild(db: Db, reason: string): Promise<{ triggered: boolean; message: string }> {
    const url = deployHookUrl();
    let triggered = false;
    let message = 'Saved. Set VERCEL_DEPLOY_HOOK_URL so publishing updates the live site automatically; until then changes go live on the next deployment.';
    if (url) {
        try {
            const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8000) });
            triggered = res.ok;
            message = res.ok ? 'Publishing started. The live site updates in about a minute.' : `The deploy hook returned ${res.status}. Changes will go live on the next deployment.`;
        } catch {
            message = 'Could not reach the deploy hook. Changes will go live on the next deployment.';
        }
    }
    await db.query(
        `INSERT INTO site_settings (key, value, updated_at) VALUES ('cms.lastRebuild', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({ at: new Date().toISOString(), reason, triggered })],
    );
    return { triggered, message };
}
