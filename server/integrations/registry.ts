/**
 * Resolves each platform's adapter from its stored configuration and server environment.
 * Environment variables take precedence over values entered in the admin. Credentials are decrypted
 * only here, on the server, and are never returned to the browser.
 */
import { demoAllowed, PLATFORM_IDS, PLATFORM_NAMES, platformEnv, type PlatformId } from '../config.js';
import type { Db } from '../db.js';
import { decrypt } from '../security.js';
import { PlatformHttpClient, type AuthType } from './http-client.js';
import { MockAdapter } from './adapters/mock.js';
import { RestAdapter } from './adapters/rest.js';
import { specFor, type SpecOverrides } from './adapters/platforms.js';
import { CAPABILITIES, type PlatformAdapter } from './types.js';

export type IntegrationMode = 'not_configured' | 'demo' | 'live';
export type ConnectionState = 'not_configured' | 'disconnected' | 'connecting' | 'connected' | 'degraded' | 'sync_failed' | 'demo';

export interface IntegrationRow {
    platform: PlatformId;
    mode: IntegrationMode;
    enabled: boolean;
    api_url: string;
    auth_type: AuthType;
    auth_header: string;
    credentials_enc: string | null;
    webhook_secret_enc: string | null;
    config: { overrides?: SpecOverrides; timeoutMs?: number; syncIntervalMinutes?: number };
    status: ConnectionState;
    last_health_at: Date | null;
    last_health_ok: boolean | null;
    last_health_message: string | null;
    last_sync_at: Date | null;
    last_sync_ok_at: Date | null;
    updated_at: Date;
}

export async function integrationRows(db: Db): Promise<IntegrationRow[]> {
    return db.query<IntegrationRow>(`SELECT * FROM platform_integrations ORDER BY array_position(ARRAY['marketplace','errands','travel_tour'], platform)`);
}

export async function integrationRow(db: Db, platform: PlatformId): Promise<IntegrationRow> {
    const row = await db.one<IntegrationRow>(`SELECT * FROM platform_integrations WHERE platform = $1`, [platform]);
    if (!row) throw new Error(`Missing integration row for ${platform}`);
    return row;
}

export interface ResolvedConfig {
    apiUrl: string;
    apiUrlSource: 'environment' | 'admin' | 'none';
    credential: string;
    credentialSource: 'environment' | 'admin' | 'none';
    webhookSecret: string;
    webhookSecretSource: 'environment' | 'admin' | 'none';
}

export function resolveConfig(row: IntegrationRow): ResolvedConfig {
    const env = platformEnv(row.platform);
    const fromDb = (enc: string | null): string => {
        if (!enc) return '';
        try { return decrypt(enc); } catch { return ''; }
    };
    const dbCred = fromDb(row.credentials_enc);
    const dbHook = fromDb(row.webhook_secret_enc);
    return {
        apiUrl: env.apiUrl || row.api_url,
        apiUrlSource: env.apiUrl ? 'environment' : row.api_url ? 'admin' : 'none',
        credential: env.apiKey || dbCred,
        credentialSource: env.apiKey ? 'environment' : dbCred ? 'admin' : 'none',
        webhookSecret: env.webhookSecret || dbHook,
        webhookSecretSource: env.webhookSecret ? 'environment' : dbHook ? 'admin' : 'none',
    };
}

export interface ResolvedIntegration {
    platform: PlatformId;
    name: string;
    mode: IntegrationMode;
    /** Effective state shown in the UI. Never "connected" unless a real health check succeeded. */
    state: ConnectionState;
    adapter: PlatformAdapter | null;
    reason: string;
    row: IntegrationRow;
    config: ResolvedConfig;
}

export function liveReady(row: IntegrationRow, cfg: ResolvedConfig): string | null {
    if (!row.enabled) return 'Integration is disabled';
    if (!cfg.apiUrl) return 'API base URL is not set';
    try {
        const u = new URL(cfg.apiUrl);
        if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return 'API base URL must use https://';
    } catch { return 'API base URL is not a valid URL'; }
    if (row.auth_type !== 'none' && !cfg.credential) return 'API credentials are not set';
    return null;
}

export function resolve(row: IntegrationRow, fetchImpl?: typeof fetch): ResolvedIntegration {
    const config = resolveConfig(row);
    const base = { platform: row.platform, name: PLATFORM_NAMES[row.platform], row, config };
    if (row.mode === 'demo') {
        if (!demoAllowed()) return { ...base, mode: 'demo', state: 'not_configured', adapter: null, reason: 'Demo mode is disabled in production' };
        return { ...base, mode: 'demo', state: 'demo', adapter: new MockAdapter(row.platform), reason: 'Demo mode: synthetic data' };
    }
    if (row.mode === 'live') {
        const problem = liveReady(row, config);
        if (problem) return { ...base, mode: 'live', state: row.enabled ? 'disconnected' : 'not_configured', adapter: null, reason: problem };
        const client = new PlatformHttpClient({
            platform: row.platform, baseUrl: config.apiUrl, authType: row.auth_type, authHeader: row.auth_header, credential: config.credential,
            timeoutMs: Math.min(30_000, Math.max(2_000, Number(row.config?.timeoutMs) || 10_000)), maxRetries: 2,
        }, fetchImpl);
        const adapter = new RestAdapter(specFor(row.platform, row.config?.overrides), client);
        const state: ConnectionState = row.status === 'sync_failed' || row.status === 'degraded' || row.status === 'connected' ? row.status
            : row.last_health_ok ? 'connected' : 'disconnected';
        return { ...base, mode: 'live', state, adapter, reason: row.last_health_message ?? 'Not tested yet' };
    }
    return { ...base, mode: 'not_configured', state: 'not_configured', adapter: null, reason: 'Not configured' };
}

export async function resolveAll(db: Db): Promise<ResolvedIntegration[]> {
    return (await integrationRows(db)).map((r) => resolve(r));
}

/** Browser-safe summary: no credentials, only where each value comes from and a masked hint. */
export function publicIntegration(r: ResolvedIntegration) {
    const mask = (v: string) => (v ? `••••${v.slice(-4)}` : null);
    return {
        platform: r.platform,
        name: r.name,
        mode: r.mode,
        state: r.state,
        reason: r.reason,
        enabled: r.row.enabled,
        capabilities: CAPABILITIES[r.platform],
        apiUrl: r.config.apiUrl,
        apiUrlSource: r.config.apiUrlSource,
        authType: r.row.auth_type,
        authHeader: r.row.auth_header,
        credential: { set: !!r.config.credential, source: r.config.credentialSource, hint: mask(r.config.credential) },
        webhookSecret: { set: !!r.config.webhookSecret, source: r.config.webhookSecretSource, hint: mask(r.config.webhookSecret) },
        overrides: r.row.config?.overrides ?? {},
        timeoutMs: Number(r.row.config?.timeoutMs) || 10_000,
        syncIntervalMinutes: Number(r.row.config?.syncIntervalMinutes) || 60,
        lastHealthAt: r.row.last_health_at,
        lastHealthOk: r.row.last_health_ok,
        lastHealthMessage: r.row.last_health_message,
        lastSyncAt: r.row.last_sync_at,
        lastSyncOkAt: r.row.last_sync_ok_at,
        demoAllowed: demoAllowed(),
    };
}

export const ALL_PLATFORMS = PLATFORM_IDS;
