/**
 * The three platform adapters. Each owns its endpoint map and capability list, so each platform can be
 * connected independently and differences between their APIs stay contained here.
 *
 * The paths below are the PROPOSED integration contracts from the project brief. None of them is assumed
 * to exist: before switching a platform to live, inspect its real API and adjust its spec (or override
 * individual paths in Integrations → Advanced, stored in platform_integrations.config).
 */
import type { PlatformId } from '../../config.js';
import { CAPABILITIES } from '../types.js';
import { DEFAULT_PAGINATION, type RestAdapterSpec } from './rest.js';

export const MARKETPLACE_SPEC: RestAdapterSpec = {
    platform: 'marketplace',
    capabilities: CAPABILITIES.marketplace,
    healthPath: '/users?limit=1',
    pagination: DEFAULT_PAGINATION,
    endpoints: {
        users: '/users', sellers: '/sellers', orders: '/orders', transactions: '/transactions', payments: '/payments',
        commissions: '/commissions', refunds: '/refunds', disputes: '/disputes', analytics: '/analytics',
    },
};

export const ERRANDS_SPEC: RestAdapterSpec = {
    platform: 'errands',
    capabilities: CAPABILITIES.errands,
    healthPath: '/users?limit=1',
    pagination: DEFAULT_PAGINATION,
    endpoints: {
        users: '/users', providers: '/providers', services: '/services', requests: '/requests', transactions: '/transactions',
        payments: '/payments', commissions: '/commissions', disputes: '/disputes', analytics: '/analytics',
    },
};

export const TRAVEL_SPEC: RestAdapterSpec = {
    platform: 'travel_tour',
    capabilities: CAPABILITIES.travel_tour,
    healthPath: '/users?limit=1',
    pagination: DEFAULT_PAGINATION,
    endpoints: {
        users: '/users', packages: '/packages', bookings: '/bookings', transactions: '/transactions', payments: '/payments',
        refunds: '/refunds', analytics: '/analytics',
    },
};

export const BASE_SPECS: Record<PlatformId, RestAdapterSpec> = {
    marketplace: MARKETPLACE_SPEC,
    errands: ERRANDS_SPEC,
    travel_tour: TRAVEL_SPEC,
};

export interface SpecOverrides {
    endpoints?: Partial<RestAdapterSpec['endpoints']>;
    healthPath?: string;
    pagination?: Partial<RestAdapterSpec['pagination']>;
}

/** Keeps only well-formed overrides for resources the platform supports. Used before storing and before use. */
export function sanitizeOverrides(platform: PlatformId, raw: unknown): SpecOverrides {
    const base = BASE_SPECS[platform];
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: SpecOverrides = {};
    const eps = (src.endpoints && typeof src.endpoints === 'object' ? src.endpoints : {}) as Record<string, unknown>;
    for (const [res, path] of Object.entries(eps)) {
        if (base.capabilities.includes(res as never) && typeof path === 'string' && path.length <= 200 && /^\/[\w\-./{}]*$/.test(path)) {
            (out.endpoints ??= {})[res as keyof RestAdapterSpec['endpoints']] = path;
        }
    }
    if (typeof src.healthPath === 'string' && src.healthPath.length <= 200 && /^\/[\w\-./?=&]*$/.test(src.healthPath)) out.healthPath = src.healthPath;
    const o = (src.pagination && typeof src.pagination === 'object' ? src.pagination : {}) as Record<string, unknown>;
    const pag: Partial<RestAdapterSpec['pagination']> = {};
    if (o.style === 'cursor' || o.style === 'page') pag.style = o.style;
    for (const k of ['cursorParam', 'pageParam', 'sizeParam', 'sinceParam'] as const) {
        const v = o[k];
        if (typeof v === 'string' && /^[A-Za-z_][\w.]{0,40}$/.test(v)) pag[k] = v;
    }
    if (Object.keys(pag).length) out.pagination = pag;
    return out;
}

/** Applies validated per-platform overrides from the database without changing the platform's capabilities. */
export function specFor(platform: PlatformId, overrides: SpecOverrides = {}): RestAdapterSpec {
    const base = BASE_SPECS[platform];
    const clean = sanitizeOverrides(platform, overrides);
    return {
        ...base,
        endpoints: { ...base.endpoints, ...clean.endpoints },
        healthPath: clean.healthPath ?? base.healthPath,
        pagination: { ...base.pagination, ...clean.pagination },
    };
}
