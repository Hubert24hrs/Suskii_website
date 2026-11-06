import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../server/db.js';
import { detectType } from '../server/media/service.js';
import { as, call, createAdmin, createSuperAdmin, freshDb, login, newIp, type Session } from './helpers.js';

let db: Db;
let owner: Session, analyst: Session;
let png: Uint8Array;
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'.padEnd(200, ' '));

beforeAll(async () => {
    db = await freshDb();
    await createSuperAdmin(db);
    await createAdmin(db, 'analyst@suskii.test', ['analyst']);
    owner = await login('owner@suskii.test');
    analyst = await login('analyst@suskii.test');
    png = new Uint8Array(await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#E8461E' } }).png().toBuffer());
});

const upload = (s: Session, bytes: Uint8Array, type: string, name = 'banner.png') =>
    as(s)('POST', '/api/media', undefined, { raw: bytes as unknown as BodyInit, headers: { 'content-type': type, 'x-filename': encodeURIComponent(name), 'x-alt-text': encodeURIComponent('Orange banner') } });

describe('media library', () => {
    it('detects file types from their content, not their name', () => {
        expect(detectType(png)).toBe('image/png');
        expect(detectType(PDF)).toBe('application/pdf');
        expect(detectType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    });

    it('re-encodes uploads as WebP with responsive variants and keeps the description', async () => {
        const res = await upload(owner, png, 'image/png');
        expect(res.status).toBe(200);
        expect(res.body.asset.mime).toBe('image/webp');
        expect(res.body.asset.width).toBe(1600);
        expect(res.body.asset.alt).toBe('Orange banner');
        expect(res.body.asset.variants.map((v: any) => v.width)).toEqual([400, 800, 1200]);
    });

    it('refuses SVG, disguised and unauthorised uploads', async () => {
        const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
        expect((await upload(owner, svg, 'image/svg+xml', 'logo.svg')).status).toBe(400);
        expect((await upload(owner, new TextEncoder().encode('MZ executable'), 'image/png', 'fake.png')).status).toBe(400);
        expect((await upload(analyst, png, 'image/png')).status).toBe(403);
    });

    it('will not delete an image that published content uses', async () => {
        const asset = (await upload(owner, png, 'image/png', 'used.png')).body.asset;
        const id = (await db.one<{ id: string }>(`SELECT id FROM cms_entries WHERE key = 'site.seo'`))!.id;
        const entry = (await as(owner)('GET', `/api/cms/entries/${id}`)).body.entry;
        await as(owner)('PUT', `/api/cms/entries/${id}`, { data: { ...entry.draft, ogImage: { url: asset.url, alt: '', assetId: asset.id } }, version: entry.version });
        expect((await as(owner)('DELETE', `/api/media/${asset.id}`)).status).toBe(400);
        const unused = (await upload(owner, png, 'image/png', 'unused.png')).body.asset;
        expect((await as(owner)('DELETE', `/api/media/${unused.id}`)).status).toBe(200);
    });
});

describe('job applications', () => {
    beforeAll(async () => {
        const created = await as(owner)('POST', '/api/cms/entries', { collection: 'job', slug: 'engineer', data: {
            title: 'Engineer', department: 'Tech', location: 'Kigali', employment: 'Full-time', summary: 'Build things.', body: '<p>Role</p>', applyOpen: true, closingDate: null,
        } });
        await as(owner)('POST', `/api/cms/entries/${created.body.entry.id}/publish`);
    });

    const apply = (file: Uint8Array, name = 'cv.pdf', job = 'engineer') => {
        const fd = new FormData();
        fd.set('job', job); fd.set('name', 'Grace Hopper'); fd.set('email', 'grace@example.test'); fd.set('coverLetter', 'Hello');
        fd.set('resume', new File([file as BlobPart], name, { type: 'application/pdf' }));
        return call('POST', '/api/public/applications', { raw: fd, headers: { accept: 'application/json' }, ip: newIp() });
    };

    it('accepts a PDF CV, stores it encrypted, and lets authorised staff download it', async () => {
        const res = await apply(PDF);
        expect(res.status).toBe(200);
        const app = (await as(owner)('GET', '/api/applications')).body.items[0];
        expect(app.has_resume).toBe(true);
        const asset = await db.one<{ storage_key: string; url: string; is_private: boolean }>(`SELECT storage_key, url, is_private FROM media_assets WHERE kind = 'document'`);
        expect(asset!.is_private).toBe(true);
        expect(asset!.url).toBe(''); // never publicly addressable in local storage
        const stored = await readFile(join(process.cwd(), '.data', 'private', asset!.storage_key.replace(/^private:/, '')));
        expect(stored.subarray(0, 4).toString()).toBe('SKE1');
        expect(stored.includes(Buffer.from('%PDF'))).toBe(false);
        const dl = await call('GET', `/api/applications/${app.id}/resume`, { cookie: owner.cookie });
        expect(dl.status).toBe(200);
        expect(dl.text.startsWith('%PDF')).toBe(true);
        expect((await call('GET', `/api/applications/${app.id}/resume`, { cookie: analyst.cookie })).status).toBe(403);
        expect((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'application.download_cv'`))!.n).toBe(1);
    });

    it('refuses non-PDF files and roles that are not accepting applications', async () => {
        expect((await apply(new TextEncoder().encode('not a pdf at all'.padEnd(100, '.')), 'cv.pdf')).status).toBe(400);
        expect((await apply(PDF, 'cv.pdf', 'does-not-exist')).status).toBe(400);
    });
});
