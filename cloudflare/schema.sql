-- Run once against a NEW Cloudflare D1 database before creating your admin account.
-- This schema is for the Cloudflare deployment; local Node SQLite remains separate.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_one_admin ON users(role) WHERE role='admin';
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role='member'),
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('lead','instagram','dm','reply','call','win')),
  title TEXT NOT NULL, url TEXT NOT NULL, unique_key TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT '', service TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  lead_id TEXT REFERENCES submissions(id), proof TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  stage TEXT NOT NULL DEFAULT 'new', follow_up TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT NOT NULL DEFAULT '',
  reviewer_id TEXT REFERENCES users(id), review_note TEXT NOT NULL DEFAULT '',
  CHECK((kind IN ('lead','instagram') AND lead_id IS NULL) OR (kind IN ('dm','reply','call','win') AND lead_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS submissions_user ON submissions(user_id,created_at);
CREATE INDEX IF NOT EXISTS submissions_lead ON submissions(lead_id,status);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL, target_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are immutable'); END;
CREATE TABLE IF NOT EXISTS mutation_checks (id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
