-- FlukSite Pro — skema database PostgreSQL.
-- Jalankan sekali saat setup: psql -d fluksite -f server/schema.sql

-- Tabel user untuk autentikasi (password di-hash bcrypt).
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  nik         TEXT,
  role        TEXT NOT NULL DEFAULT 'REGULAR',
  password    TEXT NOT NULL,           -- bcrypt hash
  profile     JSONB NOT NULL DEFAULT '{}'::jsonb, -- field Employee tambahan
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

-- Key-value store untuk semua data aplikasi (employees, leaves, symbols, dll).
-- Value dalam JSONB; aplikasi men-cache di browser dan sync ke sini.
CREATE TABLE IF NOT EXISTS app_data (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabel session yang dipakai oleh connect-pg-simple (express-session).
CREATE TABLE IF NOT EXISTS user_sessions (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT user_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire);

-- Trigger: otomatis update updated_at saat row diubah.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS app_data_updated_at ON app_data;
CREATE TRIGGER app_data_updated_at BEFORE UPDATE ON app_data
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
