/**
 * Generic REST adapter used by the three platform adapters. Endpoint paths, pagination style and
 * query parameter names are per-platform configuration, so a real API that differs from the proposed
 * contract can be connected by configuration (Integrations → Advanced) or a small adapter change.
 */
import type { PlatformId } from '../../config.js';
import { PlatformHttpClient } from '../http-client.js';
import { normalize } from '../normalize.js';
import { type AnyRecord, type HealthResult, IntegrationError, type ListOptions, type Page, type PlatformAdapter, type Resource } from '../types.js';

export interface PaginationConfig {
    style: 'cursor' | 'page';
    cursorParam: string;
    pageParam: string;
    sizeParam: string;
    sinceParam: string;
}

export interface RestAdapterSpec {
    platform: PlatformId;
    capabilities: Resource[];
    endpoints: Partial<Record<Resource, string>>;
    healthPath: string;
    pagination: PaginationConfig;
}

export const DEFAULT_PAGINATION: PaginationConfig = {
    style: 'cursor', cursorParam: 'cursor', pageParam: 'page', sizeParam: 'limit', sinceParam: 'updated_since',
};

type Raw = Record<string, unknown>;

export function extractItems(body: unknown): Raw[] {
    if (Array.isArray(body)) return body as Raw[];
    if (body && typeof body === 'object') {
        for (const k of ['data', 'items', 'results', 'records', 'rows']) {
            const v = (body as Raw)[k];
            if (Array.isArray(v)) return v as Raw[];
        }
    }
    throw new Error('Response does not contain a list (expected an array or { data: [...] })');
}

export function extractCursor(body: unknown): string | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const b = body as Raw;
    const meta = (b.meta ?? b.pagination ?? {}) as Raw;
    const v = b.next_cursor ?? b.nextCursor ?? meta.next_cursor ?? meta.nextCursor ?? b.next;
    return typeof v === 'string' && v ? v : null;
}

export class RestAdapter implements PlatformAdapter {
    readonly mode = 'live' as const;
    readonly platform: PlatformId;
    readonly capabilities: Resource[];

    constructor(private spec: RestAdapterSpec, private client: PlatformHttpClient) {
        this.platform = spec.platform;
        this.capabilities = spec.capabilities;
    }

    async health(): Promise<HealthResult> {
        const started = Date.now();
        try {
            await this.client.request(this.spec.healthPath);
            return { ok: true, latencyMs: Date.now() - started, message: 'Connected' };
        } catch (e) {
            const message = e instanceof IntegrationError ? `${e.code}: ${e.message}` : 'Unexpected error';
            return { ok: false, latencyMs: Date.now() - started, message };
        }
    }

    async list(resource: Resource, opts: ListOptions = {}): Promise<Page<AnyRecord>> {
        if (!this.capabilities.includes(resource) || resource === 'analytics') {
            throw new IntegrationError(this.platform, 'unsupported', `${resource} is not available from this platform`);
        }
        const path = this.spec.endpoints[resource];
        if (!path) throw new IntegrationError(this.platform, 'unsupported', `No endpoint configured for ${resource}`);
        const p = this.spec.pagination;
        const pageSize = Math.min(200, opts.pageSize ?? 100);
        const query: Record<string, string | number | null | undefined> = { [p.sizeParam]: pageSize, [p.sinceParam]: opts.updatedSince ?? undefined };
        if (p.style === 'cursor') query[p.cursorParam] = opts.cursor ?? undefined;
        else query[p.pageParam] = Number(opts.cursor ?? '1');
        const body = await this.client.request(path, { query });
        let rows: Raw[];
        try {
            rows = extractItems(body);
        } catch (e) {
            throw new IntegrationError(this.platform, 'bad_response', (e as Error).message);
        }
        const items: AnyRecord[] = [];
        for (const row of rows) {
            try { items.push(normalize(this.platform, resource, row) as AnyRecord); } catch { /* skip malformed rows; counted by sync */ }
        }
        const nextCursor = p.style === 'cursor' ? extractCursor(body) : rows.length >= pageSize ? String(Number(opts.cursor ?? '1') + 1) : null;
        return { items, nextCursor };
    }

    /** Analytics are fetched on demand and never stored. */
    async analytics(query: Record<string, string>): Promise<unknown> {
        const path = this.spec.endpoints.analytics;
        if (!path) throw new IntegrationError(this.platform, 'unsupported', 'Analytics endpoint not configured');
        return this.client.request(path, { query });
    }
}
