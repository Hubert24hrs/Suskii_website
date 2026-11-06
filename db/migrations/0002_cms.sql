-- 0002: corporate CMS, revisions, media library, contact inquiries, careers.

CREATE TABLE IF NOT EXISTS cms_entries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collection   text NOT NULL CHECK (collection IN ('section', 'news', 'job')),
    key          text NOT NULL,
    title        text NOT NULL,
    status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'pending_review', 'approved', 'published', 'archived')),
    draft        jsonb NOT NULL DEFAULT '{}'::jsonb,
    published    jsonb,
    version      integer NOT NULL DEFAULT 1,
    publish_at   timestamptz,
    published_at timestamptz,
    published_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewed_by  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    created_by   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_by   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);
-- Slugs / section keys are unique per collection among non-deleted entries.
CREATE UNIQUE INDEX IF NOT EXISTS cms_entries_collection_key ON cms_entries (collection, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cms_entries_schedule_idx ON cms_entries (publish_at) WHERE publish_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS cms_revisions (
    id         bigserial PRIMARY KEY,
    entry_id   uuid NOT NULL REFERENCES cms_entries(id) ON DELETE CASCADE,
    version    integer NOT NULL,
    status     text NOT NULL,
    data       jsonb NOT NULL,
    note       text NOT NULL DEFAULT '',
    author_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entry_id, version)
);

CREATE TABLE IF NOT EXISTS media_assets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    filename    text NOT NULL,
    storage_key text NOT NULL,
    url         text NOT NULL,
    mime        text NOT NULL,
    width       integer,
    height      integer,
    size_bytes  integer NOT NULL,
    alt         text NOT NULL DEFAULT '',
    variants    jsonb NOT NULL DEFAULT '[]'::jsonb,
    kind        text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'document')),
    is_private  boolean NOT NULL DEFAULT false,
    uploaded_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS media_assets_created_idx ON media_assets (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contact_inquiries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    name        text NOT NULL,
    email       text NOT NULL,
    phone       text,
    topic       text NOT NULL DEFAULT 'general',
    message     text NOT NULL,
    status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'spam')),
    assigned_to uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    notes       text NOT NULL DEFAULT '',
    ip_hash     text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_inquiries_created_idx ON contact_inquiries (created_at DESC);

CREATE TABLE IF NOT EXISTS job_applications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_entry_id  uuid REFERENCES cms_entries(id) ON DELETE SET NULL,
    job_slug      text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    name          text NOT NULL,
    email         text NOT NULL,
    phone         text,
    profile_url   text,
    cover_letter  text NOT NULL DEFAULT '',
    resume_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
    status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'shortlisted', 'rejected', 'hired')),
    notes         text NOT NULL DEFAULT '',
    ip_hash       text,
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_applications_created_idx ON job_applications (created_at DESC);
