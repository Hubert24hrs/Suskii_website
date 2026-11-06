/**
 * Small, explicit input validators. Every value from a request passes through one of these
 * before it reaches business logic; SQL always uses bound parameters.
 */
import { badRequest } from './http.js';

interface StrOpts { min?: number; max?: number; trim?: boolean; pattern?: RegExp; message?: string }

export function str(v: unknown, field: string, o: StrOpts = {}): string {
    if (typeof v !== 'string') throw badRequest(`${field} is required`, { field });
    const s = o.trim === false ? v : v.trim();
    const min = o.min ?? 1;
    if (s.length < min) throw badRequest(o.message ?? `${field} is required`, { field });
    if (o.max !== undefined && s.length > o.max) throw badRequest(`${field} must be at most ${o.max} characters`, { field });
    if (o.pattern && !o.pattern.test(s)) throw badRequest(o.message ?? `${field} is not valid`, { field });
    return s;
}

export function optStr(v: unknown, field: string, o: StrOpts = {}): string | null {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
    return str(v, field, { ...o, min: o.min ?? 0 });
}

export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}`, { field });
    return v as T;
}

export function optOneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T | null {
    if (v === undefined || v === null || v === '') return null;
    return oneOf(v, field, allowed);
}

export function bool(v: unknown, field: string): boolean {
    if (typeof v !== 'boolean') throw badRequest(`${field} must be true or false`, { field });
    return v;
}

export function int(v: unknown, field: string, o: { min?: number; max?: number } = {}): number {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n)) throw badRequest(`${field} must be a whole number`, { field });
    if (o.min !== undefined && n < o.min) throw badRequest(`${field} must be ≥ ${o.min}`, { field });
    if (o.max !== undefined && n > o.max) throw badRequest(`${field} must be ≤ ${o.max}`, { field });
    return n;
}

export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function email(v: unknown, field = 'email'): string {
    return str(v, field, { max: 254, pattern: EMAIL_RE, message: 'Enter a valid email address' }).toLowerCase();
}

export function httpUrl(v: unknown, field: string, o: { allowHttp?: boolean } = {}): string {
    const s = str(v, field, { max: 2048 });
    let u: URL;
    try { u = new URL(s); } catch { throw badRequest(`${field} must be a full URL (https://…)`, { field }); }
    if (u.protocol !== 'https:' && !(o.allowHttp && u.protocol === 'http:')) throw badRequest(`${field} must use https://`, { field });
    if (u.username || u.password) throw badRequest(`${field} must not contain credentials`, { field });
    return u.toString();
}

/** Site-relative path (/…), an anchor (#…) or a full https URL. */
export function linkTarget(v: unknown, field: string): string {
    const s = str(v, field, { max: 2048 });
    if (/^#[A-Za-z][\w-]*$/.test(s) || /^\/(?!\/)[\w\-./#?=&%]*$/.test(s) || /^mailto:[^\s<>"]+$/.test(s)) return s;
    return httpUrl(s, field);
}

export function slug(v: unknown, field = 'slug'): string {
    return str(v, field, { max: 120, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: 'Use lowercase letters, numbers and hyphens (e.g. product-launch-2026)' });
}

export function isoDate(v: unknown, field: string): Date {
    const s = str(v, field, { max: 40 });
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw badRequest(`${field} must be a valid date/time`, { field });
    return d;
}

export function optIsoDate(v: unknown, field: string): Date | null {
    if (v === undefined || v === null || v === '') return null;
    return isoDate(v, field);
}

export function uuid(v: unknown, field = 'id'): string {
    return str(v, field, { max: 36, pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message: `${field} is not a valid id` });
}
