-- Migration 0001: initial schema for OpexNow Stamp
-- Multi-tenant e-Meterai stamping service.

CREATE TABLE IF NOT EXISTS tenants (
  id                              TEXT PRIMARY KEY,
  name                            TEXT NOT NULL,
  status                          TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  production_enabled              INTEGER NOT NULL DEFAULT 0,
  peruri_identity                 TEXT,                              -- JSON { nama_dipungut, no_identitas }
  peruri_credentials_encrypted    TEXT,                              -- base64 AES-GCM blob (AAD = tenant_id)
  staging_daily_limit             INTEGER NOT NULL DEFAULT 20,
  created_at                      TEXT NOT NULL,
  updated_at                      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);

CREATE TABLE IF NOT EXISTS api_keys (
  id                TEXT PRIMARY KEY,      -- key id, e.g. opx_key_xxx
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  secret_hash       TEXT NOT NULL,         -- sha256 hex of the secret (shown once on creation)
  secret_encrypted  TEXT NOT NULL,         -- AES-GCM blob; allows HMAC verification without raw storage
  created_at        TEXT NOT NULL,
  last_used_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id);

CREATE TABLE IF NOT EXISTS templates (
  id                 TEXT PRIMARY KEY,     -- tmpl_xxx
  tenant_id          TEXT NOT NULL,
  name               TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  anchors            TEXT NOT NULL,        -- JSON [ { keyword, dx_pt, dy_pt }, ... ] ordered, first match wins
  box                TEXT NOT NULL,        -- JSON { width_pt, height_pt }
  default_position   TEXT NOT NULL,        -- JSON { x, y, page }
  sample_storage_key TEXT,
  source             TEXT NOT NULL DEFAULT 'manual',   -- ui | nlp
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates (tenant_id);

CREATE TABLE IF NOT EXISTS stamp_jobs (
  id                     TEXT PRIMARY KEY, -- job_xxx
  tenant_id              TEXT NOT NULL,
  template_id            TEXT,
  stamp_target           TEXT NOT NULL,    -- staging | production
  status                 TEXT NOT NULL,    -- pending_anchor | pending_sn | sn_issued | signing | signed | failed
  serial_number          TEXT,
  qr_storage_key         TEXT,
  unsigned_storage_key   TEXT,
  signed_storage_key     TEXT,
  error                  TEXT,             -- JSON { stage, message }
  anchor_match           TEXT,             -- JSON { matched, keyword, confidence, used_default, page, x, y }
  document_metadata      TEXT,             -- JSON invoice metadata
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON stamp_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON stamp_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS console_users (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,            -- pbkdf2$100000$salt$hash
  role           TEXT NOT NULL DEFAULT 'admin',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  subject     TEXT NOT NULL,               -- user_id or api_key id
  kind        TEXT NOT NULL,               -- console | api
  token_hash  TEXT NOT NULL UNIQUE,        -- sha256 hex of the presented token
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions (token_hash);
