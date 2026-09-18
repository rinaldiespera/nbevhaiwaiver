-- =========================================================================
-- NBEVHAI Cloud Waiver App — initial database schema
-- Provider-neutral Postgres SQL. Run on any Postgres-compatible server.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- waiver_type
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waiver_type (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    docx_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS waiver_type_name_unq
    ON waiver_type (name);

CREATE UNIQUE INDEX IF NOT EXISTS waiver_type_slug_unq
    ON waiver_type (slug);

-- -------------------------------------------------------------------------
-- signed_waiver
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signed_waiver (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    waiver_type_id UUID NOT NULL REFERENCES waiver_type(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    waiver_type_name TEXT NOT NULL,
    version_signed INTEGER NOT NULL,
    signer_name TEXT NOT NULL,
    signature_image_url TEXT NOT NULL,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    downloaded BOOLEAN NOT NULL DEFAULT FALSE,
    downloaded_at TIMESTAMPTZ
);

-- Duplicate-sign check: (waiver_type, current_version, case-insensitive name)
CREATE INDEX IF NOT EXISTS signed_waiver_duplicate_idx
    ON signed_waiver (waiver_type_id, version_signed, lower(signer_name));

-- Retention / housekeeping: locate rows eligible for purging
CREATE INDEX IF NOT EXISTS signed_waiver_retention_idx
    ON signed_waiver (downloaded, downloaded_at);

-- Date-filtered list downloads
CREATE INDEX IF NOT EXISTS signed_waiver_signed_at_idx
    ON signed_waiver (signed_at);
