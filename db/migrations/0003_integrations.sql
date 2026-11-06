-- 0003: platform integrations, webhooks, synchronisation and central reporting references.
-- Each platform stays the authoritative source of its own data. Reference rows hold only what the
-- central admin needs for monitoring; original platform IDs are preserved and duplicates are impossible.

CREATE TABLE IF NOT EXISTS platform_integrations (
    platform          text PRIMARY KEY CHECK (platform IN ('marketplace', 'errands', 'travel_tour')),
    mode              text NOT NULL DEFAULT 'not_configured' CHECK (mode IN ('not_configured', 'demo', 'live')),
    enabled           boolean NOT NULL DEFAULT false,
    api_url           text NOT NULL DEFAULT '',
    auth_type         text NOT NULL DEFAULT 'bearer' CHECK (auth_type IN ('none', 'bearer', 'api_key_header', 'basic')),
    auth_header       text NOT NULL DEFAULT 'X-API-Key',
    credentials_enc   text,
    webhook_secret_enc text,
    config            jsonb NOT NULL DEFAULT '{}'::jsonb,
    status            text NOT NULL DEFAULT 'not_configured'
                      CHECK (status IN ('not_configured', 'disconnected', 'connecting', 'connected', 'degraded', 'sync_failed', 'demo')),
    last_health_at    timestamptz,
    last_health_ok    boolean,
    last_health_message text,
    last_sync_at      timestamptz,
    last_sync_ok_at   timestamptz,
    updated_by        uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_integrations (platform) VALUES ('marketplace'), ('errands'), ('travel_tour')
    ON CONFLICT (platform) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform     text NOT NULL,
    event_id     text NOT NULL,
    event_type   text NOT NULL,
    occurred_at  timestamptz,
    received_at  timestamptz NOT NULL DEFAULT now(),
    payload      jsonb NOT NULL,
    status       text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
    attempts     integer NOT NULL DEFAULT 0,
    processed_at timestamptz,
    error        text,
    UNIQUE (platform, event_id)
);
CREATE INDEX IF NOT EXISTS platform_events_received_idx ON platform_events (platform, received_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              bigserial PRIMARY KEY,
    platform        text NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    event_id        text,
    event_type      text,
    signature_valid boolean NOT NULL,
    outcome         text NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'rejected')),
    reason          text,
    http_status     integer NOT NULL,
    ip              text
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_received_idx ON webhook_deliveries (platform, received_at DESC);

CREATE TABLE IF NOT EXISTS sync_jobs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform         text NOT NULL,
    resource         text NOT NULL,
    trigger          text NOT NULL CHECK (trigger IN ('manual', 'cron', 'webhook')),
    status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
    started_at       timestamptz,
    finished_at      timestamptz,
    records_fetched  integer NOT NULL DEFAULT 0,
    records_upserted integer NOT NULL DEFAULT 0,
    error            text,
    requested_by     uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_jobs_platform_idx ON sync_jobs (platform, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_logs (
    id          bigserial PRIMARY KEY,
    sync_job_id uuid REFERENCES sync_jobs(id) ON DELETE CASCADE,
    platform    text NOT NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    level       text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    message     text NOT NULL,
    data        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sync_logs_platform_idx ON sync_logs (platform, at DESC);

-- Minimal people references: no full contact details are copied.
CREATE TABLE IF NOT EXISTS customer_references (
    platform      text NOT NULL,
    kind          text NOT NULL CHECK (kind IN ('customer', 'seller', 'provider', 'partner')),
    source_id     text NOT NULL,
    display_name  text,
    email_masked  text,
    country       text,
    status        text,
    verification  text,
    registered_at timestamptz,
    source_updated_at timestamptz,
    attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (platform, kind, source_id)
);
CREATE INDEX IF NOT EXISTS customer_references_registered_idx ON customer_references (platform, kind, registered_at);

-- Financial events as reported by each platform. Amounts are integer minor units in their original currency.
CREATE TABLE IF NOT EXISTS transaction_references (
    platform        text NOT NULL,
    type            text NOT NULL CHECK (type IN ('payment', 'refund', 'commission', 'payout', 'adjustment')),
    source_id       text NOT NULL,
    status          text NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'reversed', 'cancelled')),
    amount_minor    bigint NOT NULL,
    currency        char(3) NOT NULL,
    fee_minor       bigint NOT NULL DEFAULT 0,
    method          text,
    customer_source_id text,
    related_type    text,
    related_source_id text,
    occurred_at     timestamptz NOT NULL,
    source_updated_at timestamptz,
    attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (platform, type, source_id)
);
CREATE INDEX IF NOT EXISTS transaction_references_time_idx ON transaction_references (platform, occurred_at);
CREATE INDEX IF NOT EXISTS transaction_references_status_idx ON transaction_references (status, occurred_at);

CREATE TABLE IF NOT EXISTS order_references (
    platform        text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('order', 'errand_request')),
    source_id       text NOT NULL,
    status          text NOT NULL,
    amount_minor    bigint,
    currency        char(3),
    customer_source_id text,
    provider_source_id text,
    title           text,
    created_at_source timestamptz NOT NULL,
    source_updated_at timestamptz,
    attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (platform, kind, source_id)
);
CREATE INDEX IF NOT EXISTS order_references_time_idx ON order_references (platform, kind, created_at_source);

CREATE TABLE IF NOT EXISTS booking_references (
    platform        text NOT NULL,
    source_id       text NOT NULL,
    status          text NOT NULL,
    amount_minor    bigint,
    currency        char(3),
    customer_source_id text,
    package_source_id text,
    title           text,
    travel_date     date,
    created_at_source timestamptz NOT NULL,
    source_updated_at timestamptz,
    attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (platform, source_id)
);
CREATE INDEX IF NOT EXISTS booking_references_time_idx ON booking_references (platform, created_at_source);

CREATE TABLE IF NOT EXISTS dispute_references (
    platform        text NOT NULL,
    source_id       text NOT NULL,
    status          text NOT NULL,
    reason          text,
    amount_minor    bigint,
    currency        char(3),
    related_type    text,
    related_source_id text,
    opened_at       timestamptz NOT NULL,
    resolved_at     timestamptz,
    attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (platform, source_id)
);

-- Catalogue items (marketplace listings, errand services, travel packages): counts and moderation state only.
CREATE TABLE IF NOT EXISTS catalog_references (
    platform     text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('listing', 'service', 'package')),
    source_id    text NOT NULL,
    title        text,
    status       text,
    owner_source_id text,
    price_minor  bigint,
    currency     char(3),
    created_at_source timestamptz,
    attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (platform, kind, source_id)
);
