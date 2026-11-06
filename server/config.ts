import { randomBytes } from 'node:crypto';

/**
 * Typed, validated runtime configuration. All secrets are read server-side only.
 * Nothing here is ever sent to the browser.
 */
export type AppEnv = 'development' | 'test' | 'production';
export type PlatformId = 'marketplace' | 'errands' | 'travel_tour';

export const PLATFORM_IDS: PlatformId[] = ['marketplace', 'errands', 'travel_tour'];

export const PLATFORM_NAMES: Record<PlatformId, string> = {
    marketplace: 'SUSKII Marketplace',
    errands: 'SUSKII Errands',
    travel_tour: 'SUSKII Travel & Tours',
};

const ENV_KEYS: Record<PlatformId, { url: string; key: string; webhook: string }> = {
    marketplace: { url: 'SUSKII_MARKETPLACE_API_URL', key: 'SUSKII_MARKETPLACE_API_KEY', webhook: 'WEBHOOK_MARKETPLACE_SECRET' },
    errands: { url: 'SUSKII_ERRANDS_API_URL', key: 'SUSKII_ERRANDS_API_KEY', webhook: 'WEBHOOK_ERRANDS_SECRET' },
    travel_tour: { url: 'SUSKII_TRAVEL_API_URL', key: 'SUSKII_TRAVEL_API_KEY', webhook: 'WEBHOOK_TRAVEL_SECRET' },
};

const read = (name: string): string => (process.env[name] ?? '').trim();

export function appEnv(): AppEnv {
    const v = read('APP_ENV') || (process.env.VERCEL_ENV === 'production' ? 'production' : read('NODE_ENV'));
    if (v === 'production' || v === 'test') return v;
    return 'development';
}

export const isProduction = (): boolean => appEnv() === 'production';

export function databaseUrl(): string {
    return read('DATABASE_URL');
}

export function isDatabaseConfigured(): boolean {
    return databaseUrl() !== '';
}

/**
 * Secret used to sign CSRF tokens and encrypt integration credentials at rest.
 * Production refuses to run admin features without a strong value; development gets an
 * ephemeral per-process secret so nothing insecure is ever hard-coded.
 */
let devSecret: string | undefined;
export function centralSecret(): string {
    const v = read('CENTRAL_ADMIN_SECRET');
    if (v.length >= 32) return v;
    if (isProduction()) throw new Error('CENTRAL_ADMIN_SECRET must be set to at least 32 characters in production');
    if (!devSecret) devSecret = cryptoRandom(48);
    return devSecret;
}

function cryptoRandom(bytes: number): string {
    return randomBytes(bytes).toString('base64url');
}

export function platformEnv(id: PlatformId) {
    const k = ENV_KEYS[id];
    return { apiUrl: read(k.url), apiKey: read(k.key), webhookSecret: read(k.webhook), keys: k };
}

/** Demo adapters must be explicitly allowed in production; they never switch on silently. */
export function demoAllowed(): boolean {
    return !isProduction() || read('ALLOW_DEMO_MODE_IN_PRODUCTION') === 'true';
}

export function siteOrigin(): string {
    return read('SITE_ORIGIN') || 'https://suskii-website.vercel.app';
}

export function deployHookUrl(): string {
    return read('VERCEL_DEPLOY_HOOK_URL');
}

export function cronSecret(): string {
    return read('CRON_SECRET');
}

export function blobToken(): string {
    return read('BLOB_READ_WRITE_TOKEN');
}

export function mailConfig() {
    return { resendKey: read('RESEND_API_KEY'), from: read('MAIL_FROM') || 'SUSKII Admin <no-reply@suskii.com>' };
}

export function bootstrapToken(): string {
    return read('ADMIN_BOOTSTRAP_TOKEN');
}
