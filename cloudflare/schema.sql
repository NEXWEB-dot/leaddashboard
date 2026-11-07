-- Run once against a NEW Cloudflare D1 database before creating your admin account.
-- This schema is for the Cloudflare deployment; local Node SQLite remains separate.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
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

/* Capacity optimization schema */
/* Additive capacity migration. Existing users, submissions and audit records are preserved. */
CREATE TABLE IF NOT EXISTS workspace_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 0,ready INTEGER NOT NULL DEFAULT 0,cache_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))));
INSERT OR IGNORE INTO workspace_meta(id,revision,ready) VALUES(1,0,0);
CREATE TABLE IF NOT EXISTS summary_counts(bucket TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,count INTEGER NOT NULL CHECK(count>=0),PRIMARY KEY(bucket,user_id,kind));
CREATE TABLE IF NOT EXISTS queue_counts(user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,status TEXT NOT NULL,count INTEGER NOT NULL CHECK(count>=0),PRIMARY KEY(user_id,kind,status));
CREATE INDEX IF NOT EXISTS submissions_kind_created ON submissions(kind,created_at DESC,id DESC);
/* Index each supported lead-filter shape; partial indexes exclude posts/outreach rows. */
CREATE INDEX IF NOT EXISTS submissions_lead_team_status_created ON submissions(status,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_team_stage_created ON submissions(stage,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_team_country_created ON submissions(country,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_team_country_status_created ON submissions(country,status,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_team_country_stage_created ON submissions(country,stage,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_owned_created ON submissions(user_id,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_owned_stage_created ON submissions(user_id,stage,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_owned_country_created ON submissions(user_id,country,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_owned_country_status_created ON submissions(user_id,country,status,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_lead_owned_country_stage_created ON submissions(user_id,country,stage,created_at DESC,id DESC) WHERE kind='lead';
CREATE INDEX IF NOT EXISTS submissions_owner_review ON submissions(user_id,status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS submissions_created ON submissions(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS submissions_verified_wins ON submissions(approved_at DESC,id DESC) WHERE status='approved' AND kind IN ('reply','call','win');
CREATE INDEX IF NOT EXISTS submissions_status_created ON submissions(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS submissions_user_kind_status_created ON submissions(user_id,kind,status,created_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS capacity_insert AFTER INSERT ON submissions BEGIN
INSERT INTO summary_counts(bucket,user_id,kind,count) SELECT b.bucket,NEW.user_id,NEW.kind,1 FROM (SELECT 'all' AS bucket UNION ALL SELECT 'week:' || strftime('%Y-%m-%dT%H:%M:%fZ', NEW.approved_at, '+5 hours', 'start of day', '-' || ((CAST(strftime('%w', NEW.approved_at, '+5 hours') AS INTEGER)+6)%7) || ' days', '-5 hours') AS bucket UNION ALL SELECT 'month:' || strftime('%Y-%m-%dT%H:%M:%fZ', NEW.approved_at, '+5 hours', 'start of month', '-5 hours') AS bucket UNION ALL SELECT 'day:' || date(NEW.approved_at, '+5 hours') AS bucket) b WHERE NEW.status='approved' AND (SELECT ready FROM workspace_meta WHERE id=1)=1 ON CONFLICT(bucket,user_id,kind) DO UPDATE SET count=count+1;
INSERT INTO queue_counts(user_id,kind,status,count) SELECT NEW.user_id,NEW.kind,NEW.status,1 WHERE (SELECT ready FROM workspace_meta WHERE id=1)=1 ON CONFLICT(user_id,kind,status) DO UPDATE SET count=count+1;
END;
CREATE TRIGGER IF NOT EXISTS capacity_delete AFTER DELETE ON submissions BEGIN
UPDATE summary_counts SET count=count-1 WHERE user_id=OLD.user_id AND kind=OLD.kind AND bucket IN ('all','week:' || strftime('%Y-%m-%dT%H:%M:%fZ', OLD.approved_at, '+5 hours', 'start of day', '-' || ((CAST(strftime('%w', OLD.approved_at, '+5 hours') AS INTEGER)+6)%7) || ' days', '-5 hours'),'month:' || strftime('%Y-%m-%dT%H:%M:%fZ', OLD.approved_at, '+5 hours', 'start of month', '-5 hours'),'day:' || date(OLD.approved_at, '+5 hours')) AND OLD.status='approved' AND (SELECT ready FROM workspace_meta WHERE id=1)=1;
UPDATE queue_counts SET count=count-1 WHERE user_id=OLD.user_id AND kind=OLD.kind AND status=OLD.status AND (SELECT ready FROM workspace_meta WHERE id=1)=1;
END;
CREATE TRIGGER IF NOT EXISTS capacity_update AFTER UPDATE OF status,approved_at,user_id,kind ON submissions WHEN OLD.status IS NOT NEW.status OR OLD.approved_at IS NOT NEW.approved_at OR OLD.user_id IS NOT NEW.user_id OR OLD.kind IS NOT NEW.kind BEGIN
UPDATE summary_counts SET count=count-1 WHERE user_id=OLD.user_id AND kind=OLD.kind AND bucket IN ('all','week:' || strftime('%Y-%m-%dT%H:%M:%fZ', OLD.approved_at, '+5 hours', 'start of day', '-' || ((CAST(strftime('%w', OLD.approved_at, '+5 hours') AS INTEGER)+6)%7) || ' days', '-5 hours'),'month:' || strftime('%Y-%m-%dT%H:%M:%fZ', OLD.approved_at, '+5 hours', 'start of month', '-5 hours'),'day:' || date(OLD.approved_at, '+5 hours')) AND OLD.status='approved' AND (SELECT ready FROM workspace_meta WHERE id=1)=1;
UPDATE queue_counts SET count=count-1 WHERE user_id=OLD.user_id AND kind=OLD.kind AND status=OLD.status AND (SELECT ready FROM workspace_meta WHERE id=1)=1;
INSERT INTO summary_counts(bucket,user_id,kind,count) SELECT b.bucket,NEW.user_id,NEW.kind,1 FROM (SELECT 'all' AS bucket UNION ALL SELECT 'week:' || strftime('%Y-%m-%dT%H:%M:%fZ', NEW.approved_at, '+5 hours', 'start of day', '-' || ((CAST(strftime('%w', NEW.approved_at, '+5 hours') AS INTEGER)+6)%7) || ' days', '-5 hours') AS bucket UNION ALL SELECT 'month:' || strftime('%Y-%m-%dT%H:%M:%fZ', NEW.approved_at, '+5 hours', 'start of month', '-5 hours') AS bucket UNION ALL SELECT 'day:' || date(NEW.approved_at, '+5 hours') AS bucket) b WHERE NEW.status='approved' AND (SELECT ready FROM workspace_meta WHERE id=1)=1 ON CONFLICT(bucket,user_id,kind) DO UPDATE SET count=count+1;
INSERT INTO queue_counts(user_id,kind,status,count) SELECT NEW.user_id,NEW.kind,NEW.status,1 WHERE (SELECT ready FROM workspace_meta WHERE id=1)=1 ON CONFLICT(user_id,kind,status) DO UPDATE SET count=count+1;
END;
CREATE TRIGGER IF NOT EXISTS revision_users_insert AFTER INSERT ON users BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_users_update AFTER UPDATE ON users BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_users_delete AFTER DELETE ON users BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_submissions_insert AFTER INSERT ON submissions BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_submissions_update AFTER UPDATE ON submissions BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_submissions_delete AFTER DELETE ON submissions BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_settings_insert AFTER INSERT ON settings BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_settings_update AFTER UPDATE ON settings BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_settings_delete AFTER DELETE ON settings BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_invites_insert AFTER INSERT ON invites BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_invites_update AFTER UPDATE ON invites BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS revision_invites_delete AFTER DELETE ON invites BEGIN UPDATE workspace_meta SET revision=revision+1 WHERE id=1; END;
/* Backfill runs atomically inside this readiness transition, including on a deliberate rebuild. */
CREATE VIRTUAL TABLE IF NOT EXISTS submissions_search USING fts5(title,notes,service,tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS search_insert AFTER INSERT ON submissions WHEN NEW.kind='lead' AND (SELECT ready FROM workspace_meta WHERE id=1)=1 BEGIN
INSERT INTO submissions_search(rowid,title,notes,service) VALUES(NEW.rowid,NEW.title,NEW.notes,NEW.service);
END;
CREATE TRIGGER IF NOT EXISTS search_delete AFTER DELETE ON submissions WHEN OLD.kind='lead' AND (SELECT ready FROM workspace_meta WHERE id=1)=1 BEGIN
DELETE FROM submissions_search WHERE rowid=OLD.rowid;
END;
CREATE TRIGGER IF NOT EXISTS search_update AFTER UPDATE OF title,notes,service,kind ON submissions WHEN (OLD.title IS NOT NEW.title OR OLD.notes IS NOT NEW.notes OR OLD.service IS NOT NEW.service OR OLD.kind IS NOT NEW.kind) AND (SELECT ready FROM workspace_meta WHERE id=1)=1 BEGIN
DELETE FROM submissions_search WHERE rowid=OLD.rowid;
INSERT INTO submissions_search(rowid,title,notes,service) SELECT NEW.rowid,NEW.title,NEW.notes,NEW.service WHERE NEW.kind='lead';
END;
CREATE TRIGGER IF NOT EXISTS capacity_rebuild AFTER UPDATE OF ready ON workspace_meta WHEN OLD.ready=0 AND NEW.ready=1 BEGIN
DELETE FROM submissions_search;
INSERT INTO submissions_search(rowid,title,notes,service) SELECT rowid,title,notes,service FROM submissions WHERE kind='lead';
DELETE FROM summary_counts;
DELETE FROM queue_counts;
INSERT INTO summary_counts(bucket,user_id,kind,count)
SELECT bucket,user_id,kind,COUNT(*) FROM (SELECT 'all' AS bucket,s.user_id,s.kind FROM submissions s WHERE s.status='approved' UNION ALL SELECT 'week:' || strftime('%Y-%m-%dT%H:%M:%fZ', s.approved_at, '+5 hours', 'start of day', '-' || ((CAST(strftime('%w', s.approved_at, '+5 hours') AS INTEGER)+6)%7) || ' days', '-5 hours') AS bucket,s.user_id,s.kind FROM submissions s WHERE s.status='approved' UNION ALL SELECT 'month:' || strftime('%Y-%m-%dT%H:%M:%fZ', s.approved_at, '+5 hours', 'start of month', '-5 hours') AS bucket,s.user_id,s.kind FROM submissions s WHERE s.status='approved' UNION ALL SELECT 'day:' || date(s.approved_at, '+5 hours') AS bucket,s.user_id,s.kind FROM submissions s WHERE s.status='approved') GROUP BY bucket,user_id,kind;
INSERT INTO queue_counts(user_id,kind,status,count) SELECT user_id,kind,status,COUNT(*) FROM submissions GROUP BY user_id,kind,status;
UPDATE workspace_meta SET revision=revision+1 WHERE id=1;
END;
UPDATE workspace_meta SET ready=1 WHERE id=1 AND ready=0;
