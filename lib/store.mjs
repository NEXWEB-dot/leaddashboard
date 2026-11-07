import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { POINTS, DEFAULT_GOALS, fail, text, email, safeURL, safeLeadURL, detectPlatform, instagramURL, periodStart, rankMembers } from './rules.mjs';
export { POINTS, DEFAULT_GOALS, fail, text, email, safeURL, safeLeadURL, detectPlatform, instagramURL, periodStart, rankMembers } from './rules.mjs';
const OUTCOMES = ['reply', 'call', 'win'];
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function passwordHash(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 200 || value.trim().length < 12) fail('Password must be 12–200 characters.');
  const password = value;
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(value, stored) {
  if (typeof value !== 'string' || value.length > 200) return false;
  const [salt, key] = stored.split(':');
  return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(key, 'hex'));
}
export function createStore(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_by TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('lead','instagram','dm')),
      title TEXT NOT NULL, url TEXT NOT NULL, unique_key TEXT NOT NULL UNIQUE,
      country TEXT NOT NULL DEFAULT '', service TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      lead_id TEXT REFERENCES submissions(id), proof TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      stage TEXT NOT NULL DEFAULT 'new', follow_up TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT '', reviewer_id TEXT REFERENCES users(id), review_note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS submissions_user ON submissions(user_id, created_at);
    CREATE TABLE IF NOT EXISTS outcomes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('reply','call','win')),
      title TEXT NOT NULL, url TEXT NOT NULL, unique_key TEXT NOT NULL UNIQUE,
      country TEXT NOT NULL DEFAULT '', service TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      lead_id TEXT NOT NULL REFERENCES submissions(id), proof TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      stage TEXT NOT NULL DEFAULT 'new', follow_up TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT '', reviewer_id TEXT REFERENCES users(id), review_note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS outcomes_user ON outcomes(user_id, created_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
      target_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'Audit records are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'Audit records are immutable'); END;
  `);
  const now = () => new Date().toISOString();
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const publicUser = row => row && ({ id: row.id, name: row.name, email: row.email, role: row.role, active: Boolean(row.active), createdAt: row.created_at });
  const audit = (actor, action, target, details = '') => db.prepare('INSERT INTO audit(actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?)').run(actor, action, target, details, now());
  const admin = user => { if (user.role !== 'admin') fail('Admin access required.', 403); };
  const countUsers = () => db.prepare('SELECT count(*) n FROM users').get().n;
  const getSubmission = id => db.prepare("SELECT *,'submissions' AS storage FROM submissions WHERE id=?").get(id) || db.prepare("SELECT *,'outcomes' AS storage FROM outcomes WHERE id=?").get(id);
  db.exec('DROP INDEX IF EXISTS users_one_admin');
  function createUser(input, role = 'member') {
    const id = randomUUID(), name = text(input.name, 'Name', 70, 2), address = email(input.email), password = passwordHash(input.password);
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(address)) fail('This email already has an account.', 409);
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(id, name, address, password, role, now());
    audit(id, 'account.created', id, role);
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }
  function bootstrap(input) {
    return transaction(() => { if (countUsers()) fail('Setup is already complete.', 409); return createUser(input, 'admin'); });
  }
  function login(input) {
    const address = email(input.email);
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(address);
    // Same expensive password calculation even for an unknown account.
    const dummy = `00000000000000000000000000000000:${'00'.repeat(64)}`;
    const valid = passwordMatches(input.password, row?.password || dummy);
    if (!row?.active || !valid) fail('Email or password is incorrect.', 401);
    return publicUser(row);
  }
  function createSession(userId) {
    const raw = token(), csrf = token();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(raw), userId, csrf, new Date(Date.now() + 7 * 86400000).toISOString());
    return { token: raw, csrf };
  }
  function session(raw) {
    if (!raw) return null;
    const row = db.prepare('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.active=1').get(hash(raw), now());
    return row ? { user: publicUser(row), csrf: row.csrf } : null;
  }
  function invite(user, input) {
    admin(user);
    if (input.role && !['admin', 'member'].includes(input.role)) fail('Invalid role.');
    const address = email(input.email), role = input.role === 'admin' ? 'admin' : 'member';
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(address)) fail('This person already has an account.', 409);
    const raw = token(), id = randomUUID(), expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    db.prepare('INSERT INTO invites(id,email,role,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,?)').run(id, address, role, hash(raw), expiresAt, user.id);
    audit(user.id, 'invite.created', id, `${address} (${role})`);
    return { token: raw, expiresAt, email: address, role };
  }
  function join(input) {
    return transaction(() => {
      const inviteRow = db.prepare('SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(hash(text(input.token, 'Invitation', 100)), now());
      if (!inviteRow) fail('This invitation is invalid, used, or expired.', 403);
      if (email(input.email) !== inviteRow.email) fail('Use the email address this invitation was created for.', 403);
      const user = createUser(input, inviteRow.role);
      db.prepare('UPDATE invites SET used_at=? WHERE id=?').run(now(), inviteRow.id);
      return user;
    });
  }
  const submission = row => ({ id: row.id, userId: row.user_id, kind: row.kind, title: row.title, url: row.url, country: row.country, service: row.service, notes: row.notes, leadId: row.lead_id, proof: row.proof, status: row.status, stage: row.stage, followUp: row.follow_up, createdAt: row.created_at, updatedAt: row.updated_at, approvedAt: row.approved_at, reviewerId: row.reviewer_id, reviewNote: row.review_note });
  function submit(user, input) {
    return transaction(() => {
      if (!Object.hasOwn(POINTS, input.kind)) fail('Choose a valid submission type.');
      const cutoff = new Date(Date.now() - 86400000).toISOString();
      const daily = ['submissions', 'outcomes'].reduce((sum, table) => sum + db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id=? AND created_at>?`).get(user.id, cutoff).n, 0);
      if (daily >= 100) fail('Daily submission limit reached. Ask an admin to review your existing submissions.', 429);
      const kind = input.kind, id = randomUUID(), createdAt = now();
      let title = text(input.title, 'Title', 160, 3), url, key, leadId = null, proof = '', country = '', service = '';
      const notes = text(input.notes || '', 'Notes', 2000, 0);
      if (kind === 'lead') {
        url = safeURL(input.url, 'Source post link'); key = `lead:${url}`;
        if (!['Pakistan', 'USA', 'Other'].includes(input.country)) fail('Choose a country.');
        country = input.country;
        if (!['Web development', 'Website redesign', 'Landing page', 'Other'].includes(input.service)) fail('Choose a service.');
        service = input.service;
        if (notes.length < 15) fail('Add at least 15 characters describing the actual requirement.');
      } else if (kind === 'instagram') {
        const instagram = instagramURL(input.url); url = instagram.url; key = instagram.key;
        proof = text(input.proof, 'Post context / evidence', 1500, 15);
      } else {
        leadId = text(input.leadId, 'Lead', 80);
        const lead = db.prepare("SELECT * FROM submissions WHERE id=? AND kind='lead' AND status='approved'").get(leadId);
        if (!lead) fail('Choose an approved lead.');
        if (lead.user_id !== user.id) fail('Only the lead owner can claim its outreach or outcomes.', 403);
        const label = { dm: 'DM', reply: 'Client reply', call: 'Booked call', win: 'Client won' }[kind];
        safeURL(input.url, 'Evidence link');
        title = `${label} · ${lead.title}`; url = new URL(input.url.trim()).toString(); key = `${kind}:${leadId}`;
        proof = text(input.proof, `${label} evidence / context`, 1500, 15);
      }
      const table = OUTCOMES.includes(kind) ? 'outcomes' : 'submissions';
      if (db.prepare(`SELECT 1 FROM ${table} WHERE unique_key=?`).get(key)) fail('This contribution has already been submitted. Each post and lead milestone counts once. If yours was rejected, use Resubmit.', 409);
      db.prepare(`INSERT INTO ${table}(id,user_id,kind,title,url,unique_key,country,service,notes,lead_id,proof,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, user.id, kind, title, url, key, country, service, notes, leadId, proof, createdAt, createdAt);
      audit(user.id, 'submission.created', id, `${kind}: ${title}`);
      return submission(getSubmission(id));
    });
  }
  function review(user, id, input) {
    admin(user);
    return transaction(() => {
      const row = getSubmission(id);
      if (!row) fail('Submission not found.', 404);
      const decision = input.decision;
      if (!['approve', 'reject', 'revoke'].includes(decision)) fail('Choose a review decision.');
      if ((decision === 'revoke' && row.status !== 'approved') || (decision !== 'revoke' && row.status !== 'pending')) fail('This submission has already been reviewed. Refresh to see its status.', 409);
      const reason = text(input.reason || '', 'Review note', 500, decision === 'approve' ? 0 : 5);
      if (decision === 'approve' && row.lead_id) {
        const lead = db.prepare('SELECT status FROM submissions WHERE id=?').get(row.lead_id);
        if (lead?.status !== 'approved') fail('The linked lead must be approved first.');
      }
      const status = decision === 'approve' ? 'approved' : 'rejected';
      db.prepare(`UPDATE ${row.storage} SET status=?,approved_at=?,reviewer_id=?,review_note=?,updated_at=? WHERE id=?`).run(status, status === 'approved' ? now() : '', user.id, reason, now(), id);
      audit(user.id, `submission.${decision}`, id, reason);
      if (row.user_id === user.id) audit(user.id, 'submission.owner_review', id, `Owner reviewed own work: ${decision}${reason ? ` · ${reason}` : ''}`);
      if (row.kind === 'lead' && decision === 'revoke') {
        for (const table of ['submissions', 'outcomes']) {
          const children = db.prepare(`SELECT id FROM ${table} WHERE lead_id=? AND status IN ('approved','pending')`).all(id);
          for (const child of children) {
            db.prepare(`UPDATE ${table} SET status='rejected',approved_at='',reviewer_id=?,review_note=?,updated_at=? WHERE id=?`).run(user.id, 'Linked lead approval was revoked.', now(), child.id);
            audit(user.id, 'submission.cascade_revoke', child.id, `Lead ${id}`);
          }
        }
      }
      if (row.kind === 'dm' && decision === 'approve') db.prepare("UPDATE submissions SET stage='contacted',updated_at=? WHERE id=? AND stage='new'").run(now(), row.lead_id);
      if (row.kind === 'reply' && decision === 'approve') db.prepare("UPDATE submissions SET stage='replied',updated_at=? WHERE id=? AND stage IN ('new','contacted')").run(now(), row.lead_id);
      if (row.kind === 'call' && decision === 'approve') db.prepare("UPDATE submissions SET stage='call_booked',updated_at=? WHERE id=? AND stage IN ('new','contacted','replied')").run(now(), row.lead_id);
      if (row.kind === 'win' && decision === 'approve') db.prepare("UPDATE submissions SET stage='won',updated_at=? WHERE id=?").run(now(), row.lead_id);
      return { ok: true };
    });
  }
  function update(user, id, input) {
    return transaction(() => {
      const row = db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
      if (!row) fail('Submission not found.', 404);
      if (row.user_id !== user.id && user.role !== 'admin') fail('Only the owner or an admin can update this lead.', 403);
      if (row.kind !== 'lead') fail('Only leads have pipeline details.');
      if (!['new', 'contacted', 'replied', 'call_booked', 'won', 'lost'].includes(input.stage)) fail('Choose a valid pipeline stage.');
      const followUp = text(input.followUp || '', 'Follow-up date', 10, 0);
      if (followUp && (!/^\d{4}-\d{2}-\d{2}$/.test(followUp) || Number.isNaN(Date.parse(followUp)) || new Date(followUp).toISOString().slice(0, 10) !== followUp)) fail('Enter a valid follow-up date.');
      const notes = text(input.notes, 'Notes', 2000, 15);
      db.prepare('UPDATE submissions SET stage=?,follow_up=?,notes=?,updated_at=? WHERE id=?').run(input.stage, followUp, notes, now(), id);
      audit(user.id, 'lead.updated', id, JSON.stringify({ stage: input.stage, followUp, notes }));
      return { ok: true };
    });
  }
  function resubmit(user, id, input) {
    return transaction(() => {
      const row = getSubmission(id);
      if (!row || row.user_id !== user.id) fail('Submission not found.', 404);
      if (row.status !== 'rejected') fail('Only rejected submissions can be resubmitted.', 409);
      const evidence = text(input.evidence, 'Updated evidence', 2000, 15);
      db.prepare(`UPDATE ${row.storage} SET status='pending',reviewer_id=NULL,review_note='',proof=?,notes=?,updated_at=? WHERE id=?`).run(row.kind === 'lead' ? row.proof : evidence, row.kind === 'lead' ? evidence : row.notes, now(), id);
      audit(user.id, 'submission.resubmitted', id, evidence);
      return { ok: true };
    });
  }
  function updateMember(user, id, input) {
    admin(user);
    return transaction(() => {
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!target) fail('Member not found.', 404);
      if (input.role && !['admin', 'member'].includes(input.role)) fail('Invalid role.');
      const role = input.role || target.role;
      const active = typeof input.active === 'boolean' ? (input.active ? 1 : 0) : target.active;
      if ((target.role === 'admin' && role !== 'admin') || (target.role === 'admin' && !active)) {
        const otherAdmins = db.prepare("SELECT count(*) n FROM users WHERE role='admin' AND active=1 AND id!=?").get(id).n;
        if (otherAdmins < 1) fail('The workspace must have at least one active admin.', 403);
      }
      db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(role, active, id);
      if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      audit(user.id, 'member.updated', id, JSON.stringify({ role, active: Boolean(active) }));
      return { ok: true };
    });
  }
  function changePassword(user, input) {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!passwordMatches(input.currentPassword, row.password)) fail('Your current password is incorrect.', 403);
    const password = passwordHash(input.password);
    return transaction(() => {
      db.prepare('UPDATE users SET password=? WHERE id=?').run(password, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(user.id, 'password.changed', user.id);
      return { ok: true };
    });
  }
  function state(user) {
    const members = db.prepare('SELECT * FROM users ORDER BY created_at,id').all().map(publicUser);
    const submissions = [...db.prepare('SELECT * FROM submissions').all(), ...db.prepare('SELECT * FROM outcomes').all()].map(submission).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(s => {
      // Keep outreach evidence private to its author and reviewers.
      if (user.role !== 'admin' && s.userId !== user.id && (s.kind === 'dm' || OUTCOMES.includes(s.kind))) return { ...s, url: '', proof: '', notes: '', reviewNote: '' };
      return s;
    });
    const logs = user.role === 'admin' ? db.prepare('SELECT id,actor_id AS actorId,action,target_id AS targetId,details,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 200').all() : [];
    const leaderboards = {};
    for (const period of ['week', 'month', 'all']) for (const metric of ['points', 'leads']) leaderboards[`${period}:${metric}`] = rankMembers(members, submissions, period, metric);
    return { user, members, submissions, audit: logs, leaderboards, goals: getGoals(), scoring: POINTS, timezone: 'Asia/Karachi' };
  }
  function getGoals() {
    const saved = db.prepare("SELECT value FROM settings WHERE key='weekly_goals'").get();
    return saved ? { ...DEFAULT_GOALS, ...JSON.parse(saved.value) } : { ...DEFAULT_GOALS };
  }
  function setGoals(user, input) {
    admin(user);
    const goals = {};
    for (const key of Object.keys(DEFAULT_GOALS)) {
      if (!Number.isSafeInteger(input[key]) || input[key] < 1 || input[key] > 100000) fail('Every goal must be a whole number from 1 to 100,000.');
      goals[key] = input[key];
    }
    return transaction(() => {
      db.prepare("INSERT INTO settings(key,value) VALUES('weekly_goals',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(goals));
      audit(user.id, 'goals.updated', 'weekly_goals', JSON.stringify(goals));
      return goals;
    });
  }
  return { db, countUsers, bootstrap, login, createSession, session, invite, join, submit, review, update, resubmit, updateMember, changePassword, state, setGoals, logout: raw => db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(raw || '')), close: () => db.close() };
}
