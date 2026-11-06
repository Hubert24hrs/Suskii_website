/**
 * Validation and sanitisation of CMS content against its field definitions.
 * Plain text is stored as-is and always escaped at render time; rich text and inline HTML
 * are reduced to a strict allowlist here, so nothing unsafe is ever stored or published.
 */
import sanitizeHtml from 'sanitize-html';
import { badRequest } from '../http.js';
import { EMAIL_RE } from '../validate.js';
import type { FieldDef } from './schema.js';

const LINK_SCHEMES = ['https', 'http', 'mailto'];

const transformLinks = (tagName: string, attribs: Record<string, string>) => {
    const href = attribs.href ?? '';
    const external = /^https?:\/\//i.test(href);
    return { tagName, attribs: external ? { ...attribs, target: '_blank', rel: 'noopener' } : attribs };
};

export function sanitizeInline(html: string): string {
    return sanitizeHtml(html, {
        allowedTags: ['a', 'strong', 'em', 'b', 'i', 'br'],
        allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
        allowedSchemes: LINK_SCHEMES,
        transformTags: { a: transformLinks },
        disallowedTagsMode: 'escape',
    }).trim();
}

export function sanitizeRich(html: string): string {
    return sanitizeHtml(html, {
        allowedTags: ['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'b', 'i', 'br', 'blockquote', 'hr', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
        allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'loading'], th: ['scope'] },
        allowedSchemes: LINK_SCHEMES,
        allowedSchemesByTag: { img: ['https'] },
        allowProtocolRelative: false,
        transformTags: {
            a: transformLinks,
            img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy', alt: attribs.alt ?? '' } }),
            h1: 'h2',
        },
        disallowedTagsMode: 'discard',
    }).trim();
}

export interface ImageValue { url: string; alt: string; assetId?: string; width?: number; height?: number }

function cleanUrl(v: unknown, path: string, { allowRelative = false } = {}): string {
    if (typeof v !== 'string' || !v.trim()) throw badRequest(`${path} is required`, { field: path });
    const s = v.trim();
    if (allowRelative && /^(\/|assets\/)[\w\-./%]+$/.test(s) && !s.startsWith('//')) return s;
    let u: URL;
    try { u = new URL(s); } catch { throw badRequest(`${path} must be a full https:// URL`, { field: path }); }
    if (u.protocol !== 'https:') throw badRequest(`${path} must use https://`, { field: path });
    if (u.username || u.password) throw badRequest(`${path} must not include credentials`, { field: path });
    return u.toString();
}

function cleanValue(f: FieldDef, v: unknown, path: string): unknown {
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
        if (f.required && f.type !== 'boolean' && f.type !== 'list') throw badRequest(`${f.label} is required`, { field: path });
        if (f.type === 'boolean') return false;
        if (f.type === 'list') return [];
        return f.type === 'image' ? null : '';
    }
    const tooLong = (s: string) => { if (f.max && s.length > f.max) throw badRequest(`${f.label} must be at most ${f.max} characters`, { field: path }); return s; };
    switch (f.type) {
        case 'text':
        case 'textarea': {
            if (typeof v !== 'string') throw badRequest(`${f.label} must be text`, { field: path });
            const s = f.type === 'text' ? v.replace(/\s+/g, ' ').trim() : v.replace(/\r\n/g, '\n').trim();
            if (f.required && !s) throw badRequest(`${f.label} is required`, { field: path });
            return tooLong(s);
        }
        case 'inline': return tooLong(sanitizeInline(String(v)));
        case 'richtext': return tooLong(sanitizeRich(String(v)));
        case 'email': {
            const s = String(v).trim().toLowerCase();
            if (!EMAIL_RE.test(s)) throw badRequest(`${f.label} must be a valid email`, { field: path });
            return s;
        }
        case 'url': return cleanUrl(v, f.label);
        case 'link': {
            const s = String(v).trim();
            if (/^#[A-Za-z][\w-]*$/.test(s) || /^\/(?!\/)[\w\-./#?=&%]*$/.test(s)) return s;
            return cleanUrl(s, f.label);
        }
        case 'boolean': return v === true || v === 'true';
        case 'date': {
            const d = new Date(String(v));
            if (Number.isNaN(d.getTime())) throw badRequest(`${f.label} must be a valid date`, { field: path });
            return d.toISOString().slice(0, 10);
        }
        case 'image': {
            if (typeof v !== 'object') throw badRequest(`${f.label} must be an image`, { field: path });
            const img = v as Record<string, unknown>;
            const out: ImageValue = { url: cleanUrl(img.url, f.label, { allowRelative: true }), alt: typeof img.alt === 'string' ? img.alt.trim().slice(0, 300) : '' };
            if (typeof img.assetId === 'string' && /^[0-9a-f-]{36}$/i.test(img.assetId)) out.assetId = img.assetId;
            if (Number.isInteger(img.width) && (img.width as number) > 0) out.width = img.width as number;
            if (Number.isInteger(img.height) && (img.height as number) > 0) out.height = img.height as number;
            return out;
        }
        case 'list': {
            if (!Array.isArray(v)) throw badRequest(`${f.label} must be a list`, { field: path });
            if (f.maxItems && v.length > f.maxItems) throw badRequest(`${f.label} can have at most ${f.maxItems} items`, { field: path });
            return v.map((item, i) => cleanObject(f.item ?? [], item, `${path}[${i}]`));
        }
    }
}

function cleanObject(fields: FieldDef[], data: unknown, prefix: string): Record<string, unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw badRequest('Content must be an object', { field: prefix });
    const src = data as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f.key] = cleanValue(f, src[f.key], prefix ? `${prefix}.${f.key}` : f.key);
    return out;
}

/** Returns a cleaned copy containing exactly the declared fields. Unknown keys are dropped. */
export function validateContent(fields: FieldDef[], data: unknown): Record<string, unknown> {
    return cleanObject(fields, data, '');
}

/** Fills missing fields from defaults (used when a section was saved before a field existed). */
export function withDefaults(defaults: Record<string, unknown>, data: Record<string, unknown> | null | undefined): Record<string, unknown> {
    return { ...defaults, ...(data ?? {}) };
}
