-- 0001: administrators, roles & permissions, sessions, security and audit.
-- Additive only. All timestamps are timestamptz (stored as UTC).

CREATE TABLE IF NOT EXISTS admin_users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL,
    name            text NOT NULL,
    password_hash   text NOT NULL,
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    mfa_enabled     boolean NOT NULL DEFAULT false,
    mfa_secret_enc  text,
    failed_logins   integer NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    last_login_at   timestamptz,
    password_changed_at timestamptz NOT NULL DEFAULT now(),
    created_by      uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_key ON admin_users (lower(email));

CREATE TABLE IF NOT EXISTS admin_roles (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    is_system   boolean NOT NULL DEFAULT false,
    is_privileged boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_permissions (
    id          text PRIMARY KEY,
    category    text NOT NULL,
    description text NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
    role_id       text NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    permission_id text NOT NULL REFERENCES admin_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS admin_user_roles (
    user_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    role_id    text NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    granted_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

-- Session ids are SHA-256 hashes of the cookie token; the raw token is never stored.
CREATE TABLE IF NOT EXISTS admin_sessions (
    id               text PRIMARY KEY,
    user_id          uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    csrf_token       text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    idle_expires_at  timestamptz NOT NULL,
    expires_at       timestamptz NOT NULL,
    revoked_at       timestamptz,
    ip               text,
    user_agent       text
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions (user_id);

CREATE TABLE IF NOT EXISTS admin_mfa_challenges (
    id         text PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    attempts   integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
    id        bigserial PRIMARY KEY,
    user_id   uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at   timestamptz
);
CREATE INDEX IF NOT EXISTS admin_recovery_codes_user_idx ON admin_recovery_codes (user_id);

CREATE TABLE IF NOT EXISTS admin_password_resets (
    token_hash text PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
    key          text NOT NULL,
    window_start timestamptz NOT NULL,
    count        integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          bigserial PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    actor_id    uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    actor_email text,
    action      text NOT NULL,
    outcome     text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
    target_type text,
    target_id   text,
    ip          text,
    user_agent  text,
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_logs_at_idx ON audit_logs (at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action, at DESC);

CREATE TABLE IF NOT EXISTS site_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS central_notifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    type         text NOT NULL,
    severity     text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
    title        text NOT NULL,
    body         text NOT NULL DEFAULT '',
    link         text,
    permission   text,
    platform     text
);
CREATE INDEX IF NOT EXISTS central_notifications_created_idx ON central_notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id uuid NOT NULL REFERENCES central_notifications(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    read_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
);

-- Durable job queue for work that must survive a single request (webhook processing, sync, scheduled publishing).
CREATE TABLE IF NOT EXISTS background_jobs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type         text NOT NULL,
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
    status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    attempts     integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    run_after    timestamptz NOT NULL DEFAULT now(),
    locked_at    timestamptz,
    last_error   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS background_jobs_ready_idx ON background_jobs (status, run_after);
