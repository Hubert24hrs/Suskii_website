/**
 * Server-side HTTP client for platform APIs. Credentials never leave the server.
 * - per-request timeout
 * - controlled retries (GET only) on network errors, 5xx and 429, with exponential backoff + jitter
 * - honours Retry-After (capped)
 * - structured IntegrationError results
 */
import type { PlatformId } from '../config.js';
import { IntegrationError } from './types.js';

export type AuthType = 'none' | 'bearer' | 'api_key_header' | 'basic';

export interface ClientConfig {
    platform: PlatformId;
    baseUrl: string;
    authType: AuthType;
    authHeader: string;
    credential: string;
    timeoutMs: number;
    maxRetries: number;
}

export interface RequestOptions {
    query?: Record<string, string | number | undefined | null>;
    method?: 'GET' | 'POST';
    body?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildUrl(baseUrl: string, path: string, query: RequestOptions['query'] = {}): string {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = new URL(path.replace(/^\//, ''), base);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    return url.toString();
}

export function authHeaders(cfg: Pick<ClientConfig, 'authType' | 'authHeader' | 'credential'>): Record<string, string> {
    if (!cfg.credential || cfg.authType === 'none') return {};
    switch (cfg.authType) {
        case 'bearer': return { Authorization: `Bearer ${cfg.credential}` };
        case 'api_key_header': return { [cfg.authHeader || 'X-API-Key']: cfg.credential };
        case 'basic': return { Authorization: `Basic ${Buffer.from(cfg.credential).toString('base64')}` };
    }
}

export class PlatformHttpClient {
    constructor(private cfg: ClientConfig, private fetchImpl: typeof fetch = fetch) {}

    async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
        const method = opts.method ?? 'GET';
        const url = buildUrl(this.cfg.baseUrl, path, opts.query);
        const retries = method === 'GET' ? this.cfg.maxRetries : 0;
        let lastError: IntegrationError | undefined;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (attempt > 0) await sleep(Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 250);
            let res: Response;
            try {
                res = await this.fetchImpl(url, {
                    method,
                    headers: { Accept: 'application/json', 'User-Agent': 'SuskiiCentralAdmin/1.0', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders(this.cfg) },
                    body: opts.body ? JSON.stringify(opts.body) : undefined,
                    signal: AbortSignal.timeout(this.cfg.timeoutMs),
                    redirect: 'error',
                });
            } catch (e) {
                const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
                lastError = new IntegrationError(this.cfg.platform, timeout ? 'timeout' : 'network',
                    timeout ? `No response within ${this.cfg.timeoutMs} ms` : 'Could not reach the platform API', undefined, true);
                continue;
            }
            if (res.status === 429) {
                const retryAfter = Number(res.headers.get('retry-after'));
                lastError = new IntegrationError(this.cfg.platform, 'rate_limited', 'The platform API is rate limiting requests', 429, true);
                if (attempt < retries && Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(10, retryAfter) * 1000);
                continue;
            }
            if (res.status >= 500) {
                lastError = new IntegrationError(this.cfg.platform, 'server', `The platform API returned ${res.status}`, res.status, true);
                continue;
            }
            if (res.status === 401 || res.status === 403) throw new IntegrationError(this.cfg.platform, 'auth', 'The platform API rejected the credentials', res.status);
            if (res.status === 404) throw new IntegrationError(this.cfg.platform, 'not_found', `Endpoint not found: ${path}`, 404);
            if (!res.ok) throw new IntegrationError(this.cfg.platform, 'bad_response', `The platform API returned ${res.status}`, res.status);
            const text = await res.text();
            try {
                return (text ? JSON.parse(text) : null) as T;
            } catch {
                throw new IntegrationError(this.cfg.platform, 'bad_response', 'The platform API returned invalid JSON', res.status);
            }
        }
        throw lastError ?? new IntegrationError(this.cfg.platform, 'network', 'Request failed');
    }
}
