import { POINTS, DEFAULT_GOALS, fail, text, email, safeURL, instagramURL, rankMembers } from '../lib/rules.mjs';
import { token, hash, passwordHash, passwordMatches, dummyPassword } from './auth.mjs';

const now = () => new Date().toISOString();
const publicUser = row => row && ({ id: row.id, name: row.name, email: row.email, role: row.role, active: Boolean(row.active), createdAt: row.created_at });
const publicSubmission = r => ({ id: r.id, userId: r.user_id, kind: r.kind, title: r.title, url: r.url, country: r.country, service: r.service, notes: r.notes, leadId: r.lead_id, proof: r.proof, status: r.status, stage: r.stage, followUp: r.follow_up, createdAt: r.created_at, updatedAt: r.updated_at, approvedAt: r.approved_at, reviewerId: r.reviewer_id, reviewNote: r.review_note });
const privateKinds = ['dm', 'reply', 'call', 'win'];

export function createCloudStore(binding) {
  const db = binding.withSession ? binding.withSession('first-primary') : binding;
  const q = (sql, ...params) => db.prepare(sql).bind(...params);
  const first = (sql, ...params) => q(sql, ...params).first();
  const all = async (sql, ...params) => (await q(sql, ...params).all()).results;
  const admin = user => { if (user.role !== 'admin') fail('Only the workspace owner can do this.', 403); };
  const actorCheck = (user, isAdmin = false) => ['EXISTS(SELECT 1 FROM users WHERE id=? AND active=1' + (isAdmin ? " AND role='admin'" : '') + ')', user.id];
  const rowCheck = row => ['EXISTS(SELECT 1 FROM submissions WHERE id=? AND status=? AND updated_at=?)', row.id, row.status, row.updated_at];
  const audit = (actor, action, target, details = '') => q('INSERT INTO audit(actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?)', actor, action, target, details, now());
  async function commit(statements, checks = []) {
    const id = crypto.randomUUID();
    const conditions = checks.map(c => `(${c[0]})`).join(' AND ') || '1';
    const guard = q(`INSERT INTO mutation_checks(id,ok) SELECT ?, CASE WHEN ${conditions} THEN 1 ELSE 0 END`, id, ...checks.flatMap(c => c.slice(1)));
    try { return await db.batch([guard, ...statements, q('DELETE FROM mutation_checks WHERE id=?', id)]); }
    catch (e) {
      if (/UNIQUE constraint|CHECK constraint|mutation_checks|FOREIGN KEY|linked lead|D1_ERROR.*constraint/i.test(e.message)) fail('This item already exists or changed while you were editing. Refresh and try again.', 409);
      throw e;
    }
  }
  async function userData(input, role) {
    return { id: crypto.randomUUID(), name: text(input.name, 'Name', 70, 2), email: email(input.email), password: await passwordHash(input.password), role, created_at: now(), active: 1 };
  }
  const insertUser = u => q('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)', u.id, u.name, u.email, u.password, u.role, u.created_at);
  const countUsers = async () => (await first('SELECT count(*) n FROM users')).n;
  async function bootstrap(input) {
    if (await countUsers()) fail('Setup is already complete.', 409);
    const user = await userData(input, 'admin');
    await commit([insertUser(user), audit(user.id, 'account.created', user.id, 'admin')], [['NOT EXISTS(SELECT 1 FROM users)']]);
    return publicUser(user);
  }
  async function login(input) {
    const row = await first('SELECT * FROM users WHERE email=?', email(input.email));
    const valid = await passwordMatches(input.password, row?.password || dummyPassword);
    if (!row?.active || !valid) fail('Email or password is incorrect.', 401);
    return publicUser(row);
  }
  async function createSession(userId) {
    const raw = token(), csrf = token(), time = now();
    await db.batch([q('DELETE FROM sessions WHERE expires_at < ?', time), q('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES(?,?,?,?)', await hash(raw), userId, csrf, new Date(Date.now() + 7 * 86400000).toISOString())]);
    return { token: raw, csrf };
  }
  async function session(raw) {
    if (!raw || raw.length > 128) return null;
    const row = await first('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.active=1', await hash(raw), now());
    return row ? { user: publicUser(row), csrf: row.csrf } : null;
  }
  async function invite(user, input) {
    admin(user);
    if (input.role && input.role !== 'member') fail('Invitations grant member access only.', 403);
    const address = email(input.email);
    if (await first('SELECT 1 FROM users WHERE email=?', address)) fail('This person already has an account.', 409);
    const raw = token(), id = crypto.randomUUID(), expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await commit([q("INSERT INTO invites(id,email,role,token_hash,expires_at,created_by) VALUES(?,?,'member',?,?,?)", id, address, await hash(raw), expiresAt, user.id), audit(user.id, 'invite.created', id, address)], [actorCheck(user, true)]);
    return { token: raw, expiresAt, email: address, role: 'member' };
  }
  async function join(input) {
    const tokenHash = await hash(text(input.token, 'Invitation', 100));
    const invitation = await first('SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?', tokenHash, now());
    if (!invitation) fail('This invitation is invalid, used, or expired.', 403);
    if (email(input.email) !== invitation.email) fail('Use the email this invitation was created for.', 403);
    const user = await userData(input, 'member');
    await commit([insertUser(user), q('UPDATE invites SET used_at=? WHERE id=?', now(), invitation.id), audit(user.id, 'account.created', user.id, 'member')], [['EXISTS(SELECT 1 FROM invites WHERE id=? AND token_hash=? AND used_at IS NULL AND expires_at>?)', invitation.id, tokenHash, now()]]);
    return publicUser(user);
  }
  async function submit(user, input) {
    if (!Object.hasOwn(POINTS, input.kind)) fail('Choose a valid submission type.');
    const id = crypto.randomUUID(), kind = input.kind, time = now(), cutoff = new Date(Date.now() - 86400000).toISOString();
    if ((await first('SELECT count(*) n FROM submissions WHERE user_id=? AND created_at>?', user.id, cutoff)).n >= 100) fail('Daily submission limit reached.', 429);
    let title = text(input.title, 'Title', 160, 3), url, key, leadId = null, proof = '', country = '', service = '';
    const notes = text(input.notes || '', 'Notes', 2000, 0), checks = [actorCheck(user), ['(SELECT count(*) FROM submissions WHERE user_id=? AND created_at>?)<100', user.id, cutoff]];
    if (kind === 'lead') {
      url = safeURL(input.url, 'Source post link'); key = `lead:${url}`;
      if (!['Pakistan', 'USA', 'Other'].includes(input.country)) fail('Choose a country.');
      if (!['Web development', 'Website redesign', 'Landing page', 'Other'].includes(input.service)) fail('Choose a service.');
      country = input.country; service = input.service;
      if (notes.length < 15) fail('Describe the actual requirement in at least 15 characters.');
    } else if (kind === 'instagram') {
      const post = instagramURL(input.url); url = post.url; key = post.key;
      proof = text(input.proof, 'Ownership and campaign context', 1500, 15);
    } else {
      leadId = text(input.leadId, 'Lead', 80);
      const lead = await first("SELECT * FROM submissions WHERE id=? AND kind='lead' AND status='approved'", leadId);
      if (!lead) fail('Choose an approved lead.');
      if (lead.user_id !== user.id) fail('Only the lead owner can claim its outreach or outcomes.', 403);
      safeURL(input.url, 'Evidence link'); url = new URL(input.url.trim()).toString(); key = `${kind}:${leadId}`;
      title = `${{ dm: 'DM', reply: 'Client reply', call: 'Booked call', win: 'Client won' }[kind]} · ${lead.title}`;
      proof = text(input.proof, 'Evidence and context', 1500, 15);
      checks.push(['EXISTS(SELECT 1 FROM submissions WHERE id=? AND user_id=? AND status=\'approved\' AND kind=\'lead\')', leadId, user.id]);
    }
    if (await first('SELECT 1 FROM submissions WHERE unique_key=?', key)) fail('This contribution has already been submitted. Use Resubmit for rejected work.', 409);
    await commit([q('INSERT INTO submissions(id,user_id,kind,title,url,unique_key,country,service,notes,lead_id,proof,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, user.id, kind, title, url, key, country, service, notes, leadId, proof, time, time), audit(user.id, 'submission.created', id, `${kind}: ${title}`)], checks);
    return publicSubmission(await first('SELECT * FROM submissions WHERE id=?', id));
  }
  async function review(user, id, input) {
    admin(user);
    const row = await first('SELECT * FROM submissions WHERE id=?', id);
    if (!row) fail('Submission not found.', 404);
    const decision = input.decision;
    if (!['approve', 'reject', 'revoke'].includes(decision)) fail('Choose a valid decision.');
    if (row.status !== (decision === 'revoke' ? 'approved' : 'pending')) fail('This submission has already been reviewed.', 409);
    const reason = text(input.reason || '', 'Review note', 500, decision === 'approve' ? 0 : 5), time = now(), status = decision === 'approve' ? 'approved' : 'rejected';
    const checks = [actorCheck(user, true), rowCheck(row)];
    if (decision === 'approve' && row.lead_id) checks.push(['EXISTS(SELECT 1 FROM submissions WHERE id=? AND status=\'approved\')', row.lead_id]);
    const statements = [q('UPDATE submissions SET status=?,approved_at=?,reviewer_id=?,review_note=?,updated_at=? WHERE id=?', status, status === 'approved' ? time : '', user.id, reason, time, id), audit(user.id, `submission.${decision}`, id, reason)];
    if (row.user_id === user.id) statements.push(audit(user.id, 'submission.owner_review', id, `Owner reviewed own work: ${decision}`));
    if (row.kind === 'lead' && decision === 'revoke') {
      // INSERT ... SELECT and UPDATE share the same transaction and snapshot.
      statements.push(q("INSERT INTO audit(actor_id,action,target_id,details,created_at) SELECT ?,'submission.cascade_revoke',id,?,? FROM submissions WHERE lead_id=? AND status IN ('pending','approved')", user.id, `Lead ${id}`, time, id));
      statements.push(q("UPDATE submissions SET status='rejected',approved_at='',reviewer_id=?,review_note='Linked lead approval was revoked.',updated_at=? WHERE lead_id=? AND status IN ('pending','approved')", user.id, time, id));
    }
    if (decision === 'approve' && row.lead_id) {
      const stage = { dm: ['contacted', ['new']], reply: ['replied', ['new', 'contacted']], call: ['call_booked', ['new', 'contacted', 'replied']], win: ['won', []] }[row.kind];
      if (stage) statements.push(q(`UPDATE submissions SET stage=?,updated_at=? WHERE id=?${stage[1].length ? ` AND stage IN (${stage[1].map(() => '?').join(',')})` : ''}`, stage[0], time, row.lead_id, ...stage[1]));
    }
    await commit(statements, checks); return { ok: true };
  }
  async function update(user, id, input) {
    const row = await first('SELECT * FROM submissions WHERE id=?', id);
    if (!row) fail('Submission not found.', 404);
    if (row.kind !== 'lead') fail('Only leads have pipeline details.');
    if (row.user_id !== user.id && user.role !== 'admin') fail('Only the lead owner or workspace admin can edit it.', 403);
    if (!['new', 'contacted', 'replied', 'call_booked', 'won', 'lost'].includes(input.stage)) fail('Choose a valid stage.');
    const followUp = text(input.followUp || '', 'Follow-up date', 10, 0), notes = text(input.notes, 'Notes', 2000, 15);
    if (followUp && (!/^\d{4}-\d{2}-\d{2}$/.test(followUp) || Number.isNaN(Date.parse(followUp)) || new Date(followUp).toISOString().slice(0, 10) !== followUp)) fail('Enter a valid follow-up date.');
    await commit([q('UPDATE submissions SET stage=?,follow_up=?,notes=?,updated_at=? WHERE id=?', input.stage, followUp, notes, now(), id), audit(user.id, 'lead.updated', id, JSON.stringify({ stage: input.stage, followUp, notes }))], [actorCheck(user), rowCheck(row)]);
    return { ok: true };
  }
  async function resubmit(user, id, input) {
    const row = await first('SELECT * FROM submissions WHERE id=?', id);
    if (!row || row.user_id !== user.id) fail('Submission not found.', 404);
    if (row.status !== 'rejected') fail('Only rejected work can be resubmitted.', 409);
    const evidence = text(input.evidence, 'Updated evidence', 2000, 15);
    await commit([q("UPDATE submissions SET status='pending',approved_at='',reviewer_id=NULL,review_note='',proof=?,notes=?,updated_at=? WHERE id=?", row.kind === 'lead' ? row.proof : evidence, row.kind === 'lead' ? evidence : row.notes, now(), id), audit(user.id, 'submission.resubmitted', id, evidence)], [actorCheck(user), rowCheck(row)]);
    return { ok: true };
  }
  async function updateMember(user, id, input) {
    admin(user);
    if (id === user.id) fail('The sole admin cannot be disabled or demoted.', 403);
    if (input.role && input.role !== 'member') fail('Members cannot be promoted.', 403);
    if (typeof input.active !== 'boolean') fail('Invalid access settings.');
    if (!await first('SELECT 1 FROM users WHERE id=?', id)) fail('Member not found.', 404);
    await commit([q("UPDATE users SET role='member',active=? WHERE id=?", input.active ? 1 : 0, id), ...(!input.active ? [q('DELETE FROM sessions WHERE user_id=?', id)] : []), audit(user.id, 'member.updated', id, JSON.stringify({ role: 'member', active: input.active }))], [actorCheck(user, true)]);
    return { ok: true };
  }
  async function changePassword(user, input) {
    const row = await first('SELECT * FROM users WHERE id=?', user.id);
    if (!await passwordMatches(input.currentPassword, row.password)) fail('Your current password is incorrect.', 403);
    const password = await passwordHash(input.password);
    await commit([q('UPDATE users SET password=? WHERE id=?', password, user.id), q('DELETE FROM sessions WHERE user_id=?', user.id), audit(user.id, 'password.changed', user.id)], [actorCheck(user), ['EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)', user.id, row.password]]);
    return { ok: true };
  }
  async function state(user) {
    const [memberRows, submissionRows, logs, goals] = await Promise.all([all('SELECT * FROM users ORDER BY created_at,id'), all('SELECT * FROM submissions ORDER BY created_at DESC,id'), user.role === 'admin' ? all('SELECT id,actor_id AS actorId,action,target_id AS targetId,details,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 200') : [], first("SELECT value FROM settings WHERE key='weekly_goals'")]);
    const members = memberRows.map(publicUser), submissions = submissionRows.map(publicSubmission).map(s => user.role !== 'admin' && s.userId !== user.id && privateKinds.includes(s.kind) ? { ...s, url: '', proof: '', notes: '', reviewNote: '' } : s), leaderboards = {};
    for (const period of ['week', 'month', 'all']) for (const metric of ['points', 'leads']) leaderboards[`${period}:${metric}`] = rankMembers(members, submissions, period, metric);
    return { user, members, submissions, audit: logs, leaderboards, goals: { ...DEFAULT_GOALS, ...(goals ? JSON.parse(goals.value) : {}) }, scoring: POINTS, timezone: 'Asia/Karachi' };
  }
  async function setGoals(user, input) {
    admin(user); const goals = {};
    for (const key of Object.keys(DEFAULT_GOALS)) {
      if (!Number.isSafeInteger(input[key]) || input[key] < 1 || input[key] > 100000) fail('Every goal must be a whole number from 1 to 100,000.');
      goals[key] = input[key];
    }
    await commit([q("INSERT INTO settings(key,value) VALUES('weekly_goals',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(goals)), audit(user.id, 'goals.updated', 'weekly_goals', JSON.stringify(goals))], [actorCheck(user, true)]);
    return goals;
  }
  const logout = async raw => q('DELETE FROM sessions WHERE hash=?', await hash(raw || '')).run();
  return { countUsers, bootstrap, login, createSession, session, invite, join, submit, review, update, resubmit, updateMember, changePassword, state, setGoals, logout };
}
