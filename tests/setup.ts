// Test environment: embedded in-memory PostgreSQL, no external services, deterministic secrets.
process.env.APP_ENV = 'test';
process.env.DATABASE_URL = 'pglite:memory';
process.env.CENTRAL_ADMIN_SECRET = 'test-only-secret-0123456789-abcdefghijklmnop';
process.env.SITE_ORIGIN = 'http://localhost:5173';
for (const k of ['VERCEL_DEPLOY_HOOK_URL', 'RESEND_API_KEY', 'BLOB_READ_WRITE_TOKEN', 'ADMIN_BOOTSTRAP_TOKEN', 'CRON_SECRET',
    'SUSKII_MARKETPLACE_API_URL', 'SUSKII_MARKETPLACE_API_KEY', 'WEBHOOK_MARKETPLACE_SECRET',
    'SUSKII_ERRANDS_API_URL', 'SUSKII_ERRANDS_API_KEY', 'WEBHOOK_ERRANDS_SECRET',
    'SUSKII_TRAVEL_API_URL', 'SUSKII_TRAVEL_API_KEY', 'WEBHOOK_TRAVEL_SECRET', 'ALLOW_DEMO_MODE_IN_PRODUCTION']) delete process.env[k];
