export const POINTS = Object.freeze({ lead: 0, instagram: 10, dm: 1, reply: 5, call: 20, win: 50 });
export const DEFAULT_GOALS = Object.freeze({ leads: 10, posts: 3, dms: 10, replies: 2, calls: 1, wins: 1, points: 100, teamPoints: 400 });
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function text(value, label, max = 500, min = 1) {
  if (typeof value !== 'string') fail(`${label} is required.`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) fail(`${label} must be ${min}–${max} characters.`);
  return clean;
}
export function email(value) {
  const result = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Enter a valid email address.');
  return result;
}
export function safeURL(value, label = 'Link') {
  let u;
  try { u = new URL(text(value, label, 1500)); } catch { fail(`${label} must be a full HTTPS link.`); }
  if (u.protocol !== 'https:' || u.username || u.password) fail(`${label} must be a full HTTPS link.`);
  let hostname = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  if (hostname.endsWith('.linkedin.com')) hostname = 'linkedin.com';
  if (!hostname.includes('.') || hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.includes(':')) fail('Use a public HTTPS link.');
  u.hostname = hostname;
  u.hash = '';
  u.search = '';
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  const activity = `${u.pathname}`.match(/(?:activity[-:]|urn:li:activity:)(\d+)/);
  if (hostname === 'linkedin.com' && activity) return `https://www.linkedin.com/feed/update/urn:li:activity:${activity[1]}`;
  return u.toString().replace(/\/$/, '');
}
export function instagramURL(value) {
  const url = safeURL(value, 'Instagram post link');
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)$/);
  if (parsed.hostname !== 'instagram.com' || !match) fail('Use an Instagram post or reel permalink, not a profile link.');
  return { url, key: `instagram:${match[1]}` };
}
export function periodStart(period, now = new Date()) {
  if (period === 'all') return '';
  const local = new Date(now.getTime() + 5 * 3600000);
  if (period === 'month') local.setUTCDate(1);
  else local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - 5 * 3600000).toISOString();
}
export function rankMembers(members, submissions, period = 'all', metric = 'points', now = new Date()) {
  const start = periodStart(period, now);
  const list = members.filter(m => m.active).map(m => {
    const rows = submissions.filter(s => s.userId === m.id && s.status === 'approved' && s.approvedAt >= start);
    const leads = rows.filter(s => s.kind === 'lead').length;
    const posts = rows.filter(s => s.kind === 'instagram').length;
    const dms = rows.filter(s => s.kind === 'dm').length;
    const replies = rows.filter(s => s.kind === 'reply').length, calls = rows.filter(s => s.kind === 'call').length, wins = rows.filter(s => s.kind === 'win').length;
    return { ...m, leads, posts, dms, replies, calls, wins, points: rows.reduce((sum, s) => sum + (POINTS[s.kind] || 0), 0) };
  });
  const secondary = metric === 'points' ? 'leads' : 'points';
  list.sort((a, b) => b[metric] - a[metric] || b[secondary] - a[secondary] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let rank = 0;
  return list.map((m, i) => {
    if (!i || m[metric] !== list[i - 1][metric] || m[secondary] !== list[i - 1][secondary]) rank = i + 1;
    return { ...m, rank };
  });
}
