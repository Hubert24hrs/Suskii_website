/**
 * Media uploads: validates real file type from magic bytes (never trusts the filename),
 * re-encodes images with sharp (strips metadata such as GPS), and produces responsive WebP sizes.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { badRequest, HttpError, notFound } from '../http.js';
import { storage } from './storage.js';
import { decryptBytes, encryptBytes, isEncryptedBytes } from '../security.js';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel functions accept ~4.5 MB request bodies
const VARIANT_WIDTHS = [400, 800, 1200];
const MAX_WIDTH = 2000;

export type DetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif' | 'application/pdf';

export function detectType(b: Uint8Array): DetectedType | null {
    const at = (i: number, ...bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
    if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
    if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
    if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif';
    if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
    return null;
}

export function safeFilename(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? 'file';
    return base.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(0, 120) || 'file';
}

export interface MediaRow {
    id: string; filename: string; url: string; mime: string; width: number | null; height: number | null;
    size_bytes: number; alt: string; variants: { width: number; url: string }[]; kind: 'image' | 'document'; created_at: Date;
}

export async function uploadImage(db: Db, input: { bytes: Uint8Array; filename: string; alt: string; userId: string }): Promise<MediaRow> {
    if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'payload_too_large', 'Images must be 4 MB or smaller.');
    const type = detectType(input.bytes);
    if (!type || type === 'application/pdf') throw badRequest('Upload a JPEG, PNG, WebP, GIF or AVIF image. SVG is not accepted because it can contain scripts.');
    const sharp = (await import('sharp')).default;
    let meta;
    try {
        meta = await sharp(input.bytes, { limitInputPixels: 40_000_000 }).metadata();
    } catch {
        throw badRequest('This image could not be read. It may be damaged.');
    }
    const id = randomUUID();
    const store = storage();
    const animated = type === 'image/gif' && (meta.pages ?? 1) > 1;
    // Animated GIFs are kept as-is; everything else becomes optimised WebP without metadata.
    const main = animated
        ? { data: input.bytes, info: { width: meta.width ?? 0, height: meta.height ?? 0, size: input.bytes.byteLength } }
        : await sharp(input.bytes).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const mime = animated ? 'image/gif' : 'image/webp';
    const ext = animated ? 'gif' : 'webp';
    const stem = safeFilename(input.filename).replace(/\.[a-z0-9]+$/i, '');
    const saved = await store.put(`media/${id}/${stem}.${ext}`, new Uint8Array(main.data), mime);
    const variants: { width: number; url: string; key: string }[] = [];
    if (!animated) {
        for (const w of VARIANT_WIDTHS) {
            if ((main.info.width ?? 0) <= w) continue;
            const buf = await sharp(input.bytes).rotate().resize({ width: w }).webp({ quality: 80 }).toBuffer();
            const v = await store.put(`media/${id}/${stem}-${w}.webp`, new Uint8Array(buf), 'image/webp');
            variants.push({ width: w, url: v.url, key: v.key });
        }
    }
    const row = await db.one<MediaRow>(
        `INSERT INTO media_assets (id, filename, storage_key, url, mime, width, height, size_bytes, alt, variants, kind, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'image', $11) RETURNING *`,
        [id, safeFilename(input.filename), saved.key, saved.url, mime, main.info.width, main.info.height, main.info.size ?? main.data.byteLength,
            input.alt.slice(0, 300), JSON.stringify(variants), input.userId],
    );
    return row!;
}

/** Stores a private document (e.g. a CV). Its location is never shown on the public site. */
export async function storeDocument(db: Db, input: { bytes: Uint8Array; filename: string }): Promise<string> {
    if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'payload_too_large', 'Files must be 4 MB or smaller.');
    if (detectType(input.bytes) !== 'application/pdf') throw badRequest('Upload your CV as a PDF.');
    const id = randomUUID();
    // CVs are encrypted before they leave the server, so the stored object is useless without CENTRAL_ADMIN_SECRET.
    const saved = await storage().put(`private/${id}/${randomUUID()}.bin`, encryptBytes(input.bytes), 'application/octet-stream', { private: true });
    await db.query(
        `INSERT INTO media_assets (id, filename, storage_key, url, mime, size_bytes, kind, is_private) VALUES ($1, $2, $3, $4, 'application/pdf', $5, 'document', true)`,
        [id, safeFilename(input.filename), saved.key, saved.url, input.bytes.byteLength],
    );
    return id;
}

export async function readDocument(db: Db, id: string): Promise<{ bytes: Uint8Array; filename: string }> {
    const row = await db.one<{ storage_key: string; url: string; filename: string }>(`SELECT storage_key, url, filename FROM media_assets WHERE id = $1 AND kind = 'document' AND deleted_at IS NULL`, [id]);
    if (!row) throw notFound('File not found');
    const stored = await storage().get({ key: row.storage_key, url: row.url });
    return { bytes: isEncryptedBytes(stored) ? decryptBytes(stored) : stored, filename: row.filename };
}

export async function deleteMedia(db: Db, id: string): Promise<MediaRow> {
    const row = await db.one<MediaRow & { storage_key: string }>(`SELECT * FROM media_assets WHERE id = $1 AND deleted_at IS NULL AND kind = 'image'`, [id]);
    if (!row) throw notFound('Media not found');
    const inUse = await db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM cms_entries WHERE deleted_at IS NULL AND (draft::text LIKE $1 OR published::text LIKE $1)`, [`%${row.url}%`],
    );
    if ((inUse?.n ?? 0) > 0) throw badRequest('This image is used by website content. Replace it there before deleting it.');
    const store = storage();
    await store.remove({ key: row.storage_key, url: row.url }).catch(() => {});
    for (const v of row.variants as { url: string; key?: string }[]) await store.remove({ key: v.key ?? '', url: v.url }).catch(() => {});
    await db.query(`UPDATE media_assets SET deleted_at = now() WHERE id = $1`, [id]);
    return row;
}
