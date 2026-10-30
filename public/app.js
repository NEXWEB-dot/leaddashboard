const $ = (s, el = document) => el.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  leads: '<path d="M8 3h8l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3Z"/><path d="M15 3v5h5M8 12h8M8 16h5"/>',
  trophy: '<path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v6m-4 3h8m-6-3h4v3h-4z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  dm: '<path d="m21 3-7 18-4-8-8-4L21 3Zm0 0L10 13"/>',
  points: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  logout: '<path d="M9 4H4v16h5m5-4 4-4-4-4m-6 4h13"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m0 6 3-3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.leads}</svg>`;
const brand = extra => `<div class="brand ${extra || ''}"><span class="brand-mark">L</span><div>Leadroom<small>BY NEXWEB</small></div></div>`;
const app = $('#app'), modal = $('#modal');
const demo = location.pathname === '/demo';
let state, csrf, needsSetup = false, setupLocation = 'local', page = 'overview', period = 'week', metric = 'points', query = '', filter = 'all', country = 'all', mine = false, toastTimer, refreshTimer;
const labels = { overview: 'Overview', goals: 'Goals & wins', leads: 'Lead pipeline', leaderboard: 'Leaderboard', review: 'Review queue', team: 'Team members', activity: 'Activity log', rules: 'Scoring & trust' };
const kindLabel = { lead: 'Lead', instagram: 'Instagram post', dm: 'DM', reply: 'Client reply', call: 'Booked call', win: 'Client won' };
const kindIcon = kind => ({ lead: 'leads', reply: 'dm', call: 'clock', win: 'trophy' }[kind] || kind);
const defaultGoals = { leads: 10, posts: 3, dms: 10, replies: 2, calls: 1, wins: 1, points: 100, teamPoints: 400 };
const goalLabels = { leads: 'Approved leads', posts: 'Instagram posts', dms: 'Verified DMs', replies: 'Client replies', calls: 'Booked calls', wins: 'Clients won', points: 'Weekly points', teamPoints: 'Shared team points' };
const outcomeKinds = ['reply', 'call', 'win'];
const initials = name => name.split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
const person = id => state.members.find(m => m.id === id) || { name: 'Former member', id, active: false };
const avatar = (member, large = false) => `<span class="avatar tone${Math.max(0, state.members.findIndex(m => m.id === member.id)) % 5}${large ? ' large' : ''}" aria-hidden="true">${esc(initials(member.name))}</span>`;
const date = value => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'Asia/Karachi' }).format(new Date(value)) : '—';
const dateTime = value => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' }).format(new Date(value)) : '—';
function today() { return new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10); }
function relative(value) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(value)) / 60000));
  return mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : date(value);
}
function start(selectedPeriod = period) {
  if (selectedPeriod === 'all') return '';
  const d = new Date(Date.now() + 5 * 3600000);
  if (selectedPeriod === 'month') d.setUTCDate(1); else d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5 * 3600000).toISOString();
}
function approved() { const cutoff = start(); return state.submissions.filter(s => s.status === 'approved' && s.approvedAt >= cutoff); }
function rankings(selectedPeriod = period, selectedMetric = metric) {
  if (state.leaderboards?.[`${selectedPeriod}:${selectedMetric}`]) return state.leaderboards[`${selectedPeriod}:${selectedMetric}`];
  const rows = state.submissions.filter(s => s.status === 'approved' && s.approvedAt >= start(selectedPeriod));
  const result = state.members.filter(m => m.active).map(m => {
    const own = rows.filter(s => s.userId === m.id), leads = own.filter(s => s.kind === 'lead').length, posts = own.filter(s => s.kind === 'instagram').length, dms = own.filter(s => s.kind === 'dm').length;
    const replies = own.filter(s => s.kind === 'reply').length, calls = own.filter(s => s.kind === 'call').length, wins = own.filter(s => s.kind === 'win').length;
    return { ...m, leads, posts, dms, replies, calls, wins, points: own.reduce((sum, s) => sum + (state.scoring[s.kind] || 0), 0) };
  });
  const secondary = selectedMetric === 'points' ? 'leads' : 'points';
  result.sort((a, b) => b[selectedMetric] - a[selectedMetric] || b[secondary] - a[secondary] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let rank = 0;
  return result.map((m, i) => { if (!i || m[selectedMetric] !== result[i - 1][selectedMetric] || m[secondary] !== result[i - 1][secondary]) rank = i + 1; return { ...m, rank }; });
}
function showToast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500); }
async function api(path, data) {
  const response = await fetch(`/api/${path}`, { method: data ? 'POST' : 'GET', credentials: 'same-origin', headers: { ...(data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401 && state) { state = null; clearInterval(refreshTimer); renderAuth(); } throw new Error(result.error || 'Request failed.'); }
  return result;
}
async function refresh(renderPage = true) {
  if (!demo) state = await api('state');
  if (renderPage) render();
}
function seedDemo() {
  const createdAt = new Date(Date.now() - 35 * 86400000).toISOString();
  const members = ['Ayesha Khan', 'Hamza Ali', 'Shayan Faisal', 'Sara Ahmed'].map((name, i) => ({ id: `demo-${i}`, name, email: `member${i + 1}@example.com`, role: i === 2 ? 'admin' : 'member', active: true, createdAt }));
  let counter = 0, submissions = [];
  function add(userId, kind, title, age, extra = {}) {
    const created = new Date(Date.now() - age * 3600000).toISOString();
    const id = `sample-${++counter}`;
    submissions.push({ id, userId, kind, title, url: 'https://www.linkedin.com', country: counter % 2 ? 'Pakistan' : 'USA', service: ['Web development', 'Website redesign', 'Landing page'][counter % 3], notes: 'Sample requirement: looking for a responsive website and a clear customer inquiry flow.', proof: 'Sample evidence for the preview. Real submissions require actual links and admin review.', leadId: null, status: 'approved', stage: ['new', 'contacted', 'replied'][counter % 3], followUp: counter % 4 === 0 ? today() : '', createdAt: created, updatedAt: created, approvedAt: created, reviewerId: members[2].id, reviewNote: '', ...extra });
    return id;
  }
  const titles = ['Studio North · Website redesign', 'Bloom Dental · Landing page', 'Atlas Fitness · New website', 'Saffron Kitchen · Online menu', 'The Local Co. · Portfolio', 'BrightPath · Booking website', 'Cedar Studio · Brand website', 'Urban Nest · Property landing page'];
  for (let i = 0; i < 4; i++) {
    const u = members[i].id;
    for (let j = 0; j < [8, 6, 5, 4][i]; j++) {
      const leadId = add(u, 'lead', titles[(j + i) % titles.length], 2 + j * 8 + i);
      if (j < [5, 4, 3, 2][i]) add(u, 'dm', `DM · ${titles[(j + i) % titles.length]}`, 1 + j * 8 + i, { leadId, url: 'https://example.com/sample-evidence' });
      if (j < 2) add(u, 'reply', `Client reply · ${titles[(j + i) % titles.length]}`, 1 + j * 6 + i, { leadId, url: 'https://example.com/sample-reply' });
      if (j === 0 && i < 3) add(u, 'call', `Booked call · ${titles[(j + i) % titles.length]}`, 2 + i, { leadId, url: 'https://example.com/sample-booking' });
      if (j === 0 && i === 0) add(u, 'win', `Client won · ${titles[j]}`, 1, { leadId, url: 'https://example.com/sample-win' });
    }
    for (let j = 0; j < [4, 3, 2, 1][i]; j++) add(u, 'instagram', ['A better first impression', 'Websites that work harder', 'From scroll to inquiry', 'A fresh look for your brand'][j], 4 + j * 13 + i, { url: `https://www.instagram.com/p/DEMO${i}${j}/` });
  }
  add(members[1].id, 'lead', 'Oak & Ember · Restaurant website', 0.4, { status: 'pending', approvedAt: '', stage: 'new', reviewerId: null });
  add(members[3].id, 'instagram', 'Make your next click count', 0.8, { status: 'pending', approvedAt: '', url: 'https://www.instagram.com/p/DEMONEW/', reviewerId: null });
  add(members[2].id, 'lead', 'Lumen Studio · Portfolio refresh', 1.3, { status: 'pending', approvedAt: '', stage: 'new', reviewerId: null });
  return { user: members[2], members, submissions: submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), audit: [{ id: 1, actorId: members[2].id, action: 'submission.approve', targetId: submissions[0].id, details: 'Sample audit record. Live records are append-only.', createdAt: new Date().toISOString() }], goals: { ...defaultGoals }, scoring: { lead: 0, instagram: 10, dm: 1, reply: 5, call: 20, win: 50 } };
}
function periodSelect() { return `<label class="visually-hidden" for="period">Ranking period</label><select id="period" class="period-select" data-filter="period">${[['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([v, l]) => `<option value="${v}" ${period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`; }
function empty(title, description, action = '') { return `<div class="empty">${icon('leads')}<strong>${esc(title)}</strong>${esc(description)}${action}</div>`; }
function shell(content) {
  const pending = state.submissions.filter(s => s.status === 'pending').length;
  const navItems = [['overview', 'overview'], ['goals', 'points'], ['leads', 'leads'], ['leaderboard', 'trophy'], ['review', 'shield'], ['team', 'team'], ...(state.user.role === 'admin' ? [['activity', 'activity']] : []), ['rules', 'key']];
  return `<div class="layout"><aside class="sidebar">${brand()}<div class="workspace"><span class="workspace-badge">NX</span><div><strong>NEXWEB workspace</strong><small>${state.members.filter(m => m.active).length} members · Team workspace</small></div></div><p class="eyebrow nav-caption">Workspace</p><nav class="nav" aria-label="Main navigation">${navItems.map(([id, ic]) => `<button data-page="${id}" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${labels[id]}</span>${id === 'review' && pending ? `<span class="count">${pending}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="rules-mini"><strong>${icon('shield')}Good work. Fair points.</strong><p>Real posts. Verified outreach.<br>Every contribution counts.</p><button class="text-btn" data-page="rules">See the scoring rules ${icon('arrow')}</button></div><div class="profile">${avatar(state.user)}<div><strong>${esc(state.user.name)}</strong><small>${state.user.role === 'admin' ? 'Workspace admin' : 'Team member'}</small></div><button class="icon-btn" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></div></aside><main class="main"><header class="topbar">${brand('mobile-brand')}<div class="breadcrumb">Workspace <span>/</span> <strong>${labels[page]}</strong></div><div class="topbar-right"><span class="live" id="sync-status">${demo ? 'Sample workspace' : 'Synced across your team'}</span><button class="icon-btn" data-action="password" aria-label="Change password" title="Change password">${icon('key')}</button><button class="icon-btn" data-page="team" aria-label="View your team">${avatar(state.user)}</button></div></header><div class="content">${demo ? '<div class="demo-banner"><span><strong>Preview workspace.</strong> Sample people and data. Changes reset when you refresh.</span><a href="/">Open your workspace ↗</a></div>' : ''}${content}<footer class="footer"><span>© ${new Date().getFullYear()} NEXWEB · Built for the next win.</span><span>${icon('shield')} Approved contributions only · Asia/Karachi</span></footer></div></main></div>`;
}
function heading(title, description, actions = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`; }
const addButton = () => `<button class="btn primary" data-action="add">${icon('plus')}<span>Add activity</span></button>`;
function leaderboardTable(full = false) {
  const ranks = rankings().slice(0, full ? 10000 : 5);
  return `<div class="table-scroll"><table class="leaderboard-table"><caption class="visually-hidden">Team ranking by ${metric} for ${period === 'all' ? 'all time' : `this ${period}`}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Member</th><th scope="col">Leads</th>${full ? '<th scope="col">Posts</th><th scope="col">DMs</th><th scope="col">Replies</th><th scope="col">Calls</th><th scope="col">Wins</th>' : ''}<th scope="col">Points</th></tr></thead><tbody>${ranks.map(m => `<tr class="${m.rank === 1 && (m.points || m.leads) ? 'rank-first' : ''}"><td><span class="rank r${m.rank}">${m.rank}</span></td><td><div class="member-cell">${avatar(m)}<div><strong>${esc(m.name)}${m.id === state.user.id ? '<span class="you-tag">you</span>' : ''}</strong><small>${m.role === 'admin' ? 'Admin' : 'Team member'}</small></div></div></td><td>${m.leads}</td>${full ? `<td>${m.posts}</td><td>${m.dms}</td><td>${m.replies}</td><td>${m.calls}</td><td>${m.wins}</td>` : ''}<td class="points">${m.points.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`;
}
function activityList() {
  return `<div class="activity-list">${state.submissions.slice(0, 5).map(s => `<div class="activity-item"><span class="activity-icon ${s.kind}">${icon(kindIcon(s.kind))}</span><div class="activity-text"><strong>${esc(person(s.userId).name.split(' ')[0])}</strong> ${s.kind === 'lead' ? 'added a lead' : s.kind === 'instagram' ? 'submitted a post' : s.kind === 'dm' ? 'logged a DM' : s.kind === 'reply' ? 'got a client reply' : s.kind === 'call' ? 'booked a call' : 'won a client'}<p>${esc(s.title)}</p><time datetime="${s.createdAt}">${relative(s.createdAt)}</time></div><span class="activity-score ${s.status !== 'approved' ? 'pending' : ''}">${s.status === 'approved' ? s.kind === 'lead' ? 'Verified' : `+${state.scoring[s.kind]} pts` : s.status === 'pending' ? 'In review' : 'Rejected'}</span></div>`).join('') || '<p class="muted-text">Your team’s first contribution will appear here.</p>'}</div>`;
}
function chart() {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 5 * 3600000 - (6 - i) * 86400000), key = d.toISOString().slice(0, 10);
    const rows = state.submissions.filter(s => s.status === 'approved' && new Date(new Date(s.approvedAt).getTime() + 5 * 3600000).toISOString().slice(0, 10) === key);
    return { label: d.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }), count: rows.length, key };
  });
  const max = Math.max(1, ...days.map(d => d.count));
  return `<section class="panel chart-panel"><div class="panel-heading"><div><h2>A little progress, every day</h2><p>Approved contributions · Last 7 days</p></div>${icon('activity')}</div><div class="chart"><div class="chart-bars" role="img" aria-label="${days.map(d => `${d.label}: ${d.count} approved contributions`).join(', ')}">${days.map(d => `<div class="chart-day" title="${d.key}: ${d.count} approved"><div class="bar bar${Math.round(d.count / max * 10)}"></div></div>`).join('')}</div><div class="chart-labels" aria-hidden="true">${days.map(d => `<span>${d.label}</span>`).join('')}</div></div></section>`;
}
function overview() {
  const rows = approved(), leads = rows.filter(s => s.kind === 'lead').length, posts = rows.filter(s => s.kind === 'instagram').length, dms = rows.filter(s => s.kind === 'dm').length;
  const champion = rankings()[0];
  const hasChampion = champion && (metric === 'points' ? champion.points : champion.leads) > 0;
  const stats = [['Approved leads', leads, 'leads', 'Your shared opportunity pipeline'], ['Instagram posts', posts, 'instagram', '10 points per approved post'], ['Verified DMs', dms, 'dm', '1 point per verified DM'], ['Team points', rows.reduce((sum, s) => sum + (state.scoring[s.kind] || 0), 0), 'points', 'Activity + verified client outcomes']];
  return heading('Team dashboard', 'Track your leads, posts, and the people moving your team forward.', `${periodSelect()}${addButton()}`) + `<div class="stats material-stats">${stats.map(([label, value, ic, note], i) => `<section class="stat material-stat color-${['orange', 'green', 'red', 'cyan'][i]}"><div class="stat-symbol">${icon(ic)}</div><div class="stat-head">${label}</div><div class="stat-value">${value.toLocaleString()}</div><div class="stat-foot">${icon(i === 3 ? 'trophy' : 'clock')}<span>${note}</span></div></section>`).join('')}</div><div class="material-charts">${materialChart('lead', 'Daily Leads', 'Original opportunities, approved by your admin.', 'green')}${materialChart('instagram', 'Instagram Posts', 'Every approved post earns your team 10 points.', 'orange')}${materialChart('dm', 'Verified Outreach', 'Real conversations. One point per verified DM.', 'red')}</div><div class="lower-grid material-lower"><section class="panel leaderboard-panel"><div class="panel-heading material-heading purple-heading"><div><h2>Team Leaderboard</h2><p>Ranked by ${metric === 'points' ? 'verified points' : 'approved leads'} · ${period === 'all' ? 'All time' : `This ${period}`}</p></div><button class="text-btn" data-page="leaderboard">View all ${icon('arrow')}</button></div>${leaderboardTable()}<div class="panel-footer">${icon('shield')}Only approved work counts. Every point has a paper trail.</div></section><section class="panel activity-panel"><div class="panel-heading material-heading orange-heading"><div><h2>Team Activity</h2><p>Your workspace’s latest contributions</p></div>${icon('activity')}</div>${activityList()}</section></div><section class="material-pacesetter panel"><span class="pacesetter-icon">${icon('trophy')}</span><div><strong>${hasChampion ? `${esc(champion.name)} is setting the pace` : 'Your team’s next pacesetter could be you'}</strong><p>${hasChampion ? `#${champion.rank} · ${champion.leads} leads · ${champion.replies} replies · ${champion.calls} calls · ${champion.wins} wins` : 'Submit your first lead or Instagram post to get started.'}</p></div><span class="pacesetter-points">${hasChampion ? metric === 'points' ? `${champion.points} pts` : `${champion.leads} leads` : 'Let’s go ↗'}</span></section>${goalPreview()}`;
}
function materialChart(kind, title, description, color) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 5 * 3600000 - (6 - i) * 86400000), key = d.toISOString().slice(0, 10);
    const count = state.submissions.filter(s => s.kind === kind && s.status === 'approved' && new Date(new Date(s.approvedAt).getTime() + 5 * 3600000).toISOString().slice(0, 10) === key).length;
    return { label: d.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }), count };
  });
  const max = Math.max(2, ...days.map(d => d.count)), total = days.reduce((sum, d) => sum + d.count, 0);
  const x = i => 34 + i * 56, y = n => 122 - n / max * 95;
  const grid = [0, .25, .5, .75, 1].map(f => `<line x1="28" y1="${y(max * f)}" x2="391" y2="${y(max * f)}" class="plot-grid"/><text x="20" y="${y(max * f) + 3}" text-anchor="end">${Math.round(max * f)}</text>`).join('');
  const plot = kind === 'instagram' ? days.map((d, i) => `<rect x="${x(i) - 11}" y="${y(d.count)}" width="22" height="${Math.max(1, 122 - y(d.count))}" class="plot-bar"/>`).join('') : `<polyline points="${days.map((d, i) => `${x(i)},${y(d.count)}`).join(' ')}" class="plot-line"/>${days.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.count)}" r="2.8" class="plot-point"/>`).join('')}`;
  return `<section class="panel material-chart"><div class="chart-surface color-${color}"><svg viewBox="0 0 410 155" role="img" aria-label="${esc(title)} in the last seven days: ${days.map(d => `${d.label} ${d.count}`).join(', ')}">${grid}${plot}${days.map((d, i) => `<text x="${x(i)}" y="145" text-anchor="middle">${d.label}</text>`).join('')}</svg></div><div class="chart-description"><h2>${title}</h2><p><strong>${total} approved</strong> in the last 7 days</p><p class="chart-caption">${description}</p></div><div class="chart-meta">${icon('clock')} Last 7 days · Karachi time</div></section>`;
}
function progress(label, value, target, compact = false) {
  const done = value >= target, pct = Math.min(100, Math.floor(value / target * 100));
  return `<div class="goal-progress ${done ? 'complete' : ''} ${compact ? 'compact' : ''}"><div class="goal-progress-label"><span>${done ? icon('check') : ''}${esc(label)}</span><strong>${value.toLocaleString()} <small>/ ${target.toLocaleString()}</small></strong></div><progress max="${target}" value="${Math.min(value, target)}" aria-label="${esc(label)}: ${value} of ${target}">${pct}%</progress><small class="progress-caption">${done ? 'Goal reached. Nice work!' : `${pct}% complete · ${(target - value).toLocaleString()} to go`}</small></div>`;
}
function achievements(member) {
  const own = state.submissions.filter(s => s.userId === member.id && s.status === 'approved');
  const count = kind => own.filter(s => s.kind === kind).length;
  return [
    { name: 'First lead', icon: 'leads', earned: count('lead') >= 1, detail: '1 approved lead' },
    { name: 'Lead scout', icon: 'search', earned: count('lead') >= 10, detail: '10 approved leads' },
    { name: 'Brand builder', icon: 'instagram', earned: count('instagram') >= 3, detail: '3 approved posts' },
    { name: 'Outreach pro', icon: 'dm', earned: count('dm') >= 10, detail: '10 verified DMs' },
    { name: 'Conversation starter', icon: 'team', earned: count('reply') >= 3, detail: '3 verified replies' },
    { name: 'Meeting maker', icon: 'clock', earned: count('call') >= 1, detail: '1 verified booked call' },
    { name: 'Client closer', icon: 'trophy', earned: count('win') >= 1, detail: '1 verified client win' },
  ];
}
function weeklyData() {
  const ranks = rankings('week', 'points'), personal = ranks.find(m => m.id === state.user.id) || { leads: 0, posts: 0, dms: 0, replies: 0, calls: 0, wins: 0, points: 0 };
  return { ranks, personal, teamPoints: ranks.reduce((sum, m) => sum + m.points, 0), goals: state.goals || defaultGoals };
}
function goalPreview() {
  const w = weeklyData();
  return `<section class="panel weekly-preview"><div class="panel-heading"><div><h2>This week, one step further</h2><p>Your goals reset every Monday. Your achievements stay with you.</p></div><button class="text-btn" data-page="goals">Goals & wins ${icon('arrow')}</button></div><div class="weekly-preview-grid">${progress('Your points', w.personal.points, w.goals.points, true)}${progress('Your approved leads', w.personal.leads, w.goals.leads, true)}${progress('Shared team points', w.teamPoints, w.goals.teamPoints, true)}</div></section>`;
}
function goals() {
  const w = weeklyData(), ownBadges = achievements(state.user), weeklyWins = state.submissions.filter(s => outcomeKinds.includes(s.kind) && s.status === 'approved' && s.approvedAt >= start('week')).sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  const weekStart = start('week'), weekEnd = new Date(new Date(weekStart).getTime() + 7 * 86400000 - 1).toISOString();
  return heading('Turn good work into your next win.', `This week: ${date(weekStart)} – ${date(weekEnd)} · Goals reset Monday, Karachi time.`, `${state.user.role === 'admin' ? '<button class="btn" data-action="edit-goals">Edit goals</button>' : ''}<button class="btn primary" data-action="outcome">${icon('plus')}Log a win</button>`) +
    `<section class="panel shared-goal ${w.teamPoints >= w.goals.teamPoints ? 'goal-celebration' : ''}"><div class="shared-goal-icon">${icon('team')}</div><div class="shared-goal-copy"><span class="eyebrow">One team. One target.</span><h2>${w.teamPoints >= w.goals.teamPoints ? 'You did it, together!' : 'Every contribution moves us forward.'}</h2><p>${w.teamPoints >= w.goals.teamPoints ? 'Your team reached its weekly points target. Keep celebrating the quality work behind the number.' : 'Help your teammates find the next opportunity. Approved contributions from every active member count.'}</p>${progress('Shared weekly target', w.teamPoints, w.goals.teamPoints)}</div></section>` +
    `<div class="goals-layout"><section class="panel"><div class="panel-heading"><div><h2>Your weekly goals</h2><p>Small, clear targets. Approved work only.</p></div>${avatar(state.user)}</div><div class="personal-goals">${['leads', 'posts', 'dms', 'replies', 'calls', 'wins', 'points'].map(key => progress(goalLabels[key], w.personal[key], w.goals[key])).join('')}</div></section><section class="panel"><div class="panel-heading"><div><h2>Your achievements</h2><p>Lifetime milestones · ${ownBadges.filter(b => b.earned).length} of ${ownBadges.length} earned</p></div>${icon('trophy')}</div><div class="achievement-grid">${ownBadges.map(b => `<div class="achievement ${b.earned ? 'earned' : 'locked'}"><span>${icon(b.icon)}</span><strong>${b.name}</strong><small>${b.earned ? 'Earned · ' : ''}${b.detail}</small></div>`).join('')}</div><div class="panel-footer">${icon('shield')}Achievements are earned from approved work and update if approval is revoked.</div></section></div>` +
    `<section class="panel wins-panel"><div class="panel-heading"><div><h2>The wins worth celebrating</h2><p>Verified client progress from this week</p></div><button class="text-btn" data-action="outcome">Log an outcome ${icon('arrow')}</button></div>${weeklyWins.length ? `<div class="wins-feed">${weeklyWins.slice(0, 12).map(s => `<article class="win-item">${avatar(person(s.userId))}<div><strong>${esc(person(s.userId).name)}</strong><p>${esc(s.title)}</p><small>${dateTime(s.approvedAt)} · Approved by ${esc(person(s.reviewerId).name)}</small></div><span class="win-points">+${state.scoring[s.kind]} pts</span></article>`).join('')}</div>` : empty('The next client win is waiting.', 'Log a genuine reply, a confirmed call, or a won project. Your admin verifies the evidence.')}</section>` +
    `<section class="panel team-goals-panel"><div class="panel-heading"><div><h2>Everyone’s progress</h2><p>Weekly points target · Help each other reach the finish line</p></div>${icon('team')}</div><div class="team-goal-grid">${w.ranks.map(m => `<div class="team-goal-card"><div class="member-cell">${avatar(m)}<div><strong>${esc(m.name)}</strong><small>${m.replies} replies · ${m.calls} calls · ${m.wins} clients won</small></div></div>${progress('Weekly points', m.points, w.goals.points, true)}<div class="mini-achievements">${achievements(m).filter(b => b.earned).map(b => `<span class="badge" title="${esc(b.detail)}">${b.name}</span>`).join('') || '<span class="muted-text">Their first badge is ahead.</span>'}</div></div>`).join('')}</div></section><div class="callout spaced">Reply <strong>+5</strong> · Booked call <strong>+20</strong> · Client won <strong>+50</strong>. Each milestone counts once per approved lead and needs evidence and your admin’s approval. Editing a pipeline stage alone never awards points.</div>`;
}
function logOutcome() {
  const leads = state.submissions.filter(s => s.kind === 'lead' && s.status === 'approved' && s.userId === state.user.id);
  openModal('A real step toward a new client.', 'Celebrate a genuine outcome. Your admin checks the evidence before points count.', leads.length ? `<form data-form="submission" data-kind="outcome">${select('outcomeKind', 'What happened?', [['reply', 'Client replied · 5 points'], ['call', 'Call booked · 20 points'], ['win', 'Client won · 50 points']])}${select('leadId', 'Which approved lead?', leads.map(l => [l.id, l.title]))}${field('url', 'Private evidence link', 'url', '', 'required maxlength="1500" placeholder="https://… (accessible to the workspace owner)"')}${field('proof', 'Outcome details & evidence', 'textarea', '', 'minlength="15" placeholder="Reply: include their response. Call: confirmed date and booking. Win: accepted scope or agreement. Redact private details."')}<div class="callout">Each outcome counts once per lead. Automated replies, unconfirmed calls, and unaccepted proposals should not be claimed. Evidence is private to you and the workspace owner.</div>${buttons('Submit outcome for review')}</form>` : '<div class="callout">Add a lead you own and get it approved first. Then you can log its client outcomes.</div><div class="modal-buttons"><button class="btn primary" data-add="lead">Add a lead</button></div>');
}
function editGoals() {
  const values = state.goals || defaultGoals;
  openModal('Set a week worth working toward.', 'Personal targets apply to each active teammate. The shared target is for the whole team.', `<form data-form="goals"><div class="form-row">${Object.keys(defaultGoals).map(key => field(key, goalLabels[key], 'number', values[key], 'required min="1" max="100000" step="1"')).join('')}</div><div class="callout">Changes apply immediately to this week’s progress. Previous contributions and earned points stay intact.</div>${buttons('Save weekly goals')}</form>`);
}
function leaderboard() {
  return heading('A little friendly competition.', 'Celebrate the work that moves your team forward.', periodSelect()) + `<section class="panel"><div class="toolbar"><div class="tabs" role="group" aria-label="Rank by"><button data-metric="points" class="${metric === 'points' ? 'active' : ''}">By points</button><button data-metric="leads" class="${metric === 'leads' ? 'active' : ''}">By leads</button></div><span class="filters-note">${state.members.filter(m => m.active).length} active members · Approved work only</span></div>${leaderboardTable(true)}<div class="panel-footer">${icon('shield')}Ties share a rank. ${metric === 'points' ? 'Lead count' : 'Points'} breaks the first tie; identical totals share their position.</div></section><div class="callout spaced">Instagram post = <strong>10 points</strong> · Verified DM = <strong>1 point</strong> · Client reply = <strong>5 points</strong> · Booked call = <strong>20 points</strong> · Client won = <strong>50 points</strong> · Leads are tracked separately. Switch to “By leads” to reward lead sourcing. Weeks start Monday, in Karachi time.</div>`;
}
function filteredLeads() {
  return state.submissions.filter(s => s.kind === 'lead' && (filter === 'all' || s.status === filter || s.stage === filter) && (country === 'all' || s.country === country) && (!mine || s.userId === state.user.id) && `${s.title} ${s.notes} ${s.service} ${person(s.userId).name}`.toLowerCase().includes(query.toLowerCase()));
}
function leadRows() {
  const rows = filteredLeads();
  return rows.length ? `<div class="table-scroll"><table><caption class="visually-hidden">Team lead pipeline</caption><thead><tr><th scope="col">Prospect / opportunity</th><th scope="col">Owner</th><th scope="col">Country</th><th scope="col">Review</th><th scope="col">Pipeline</th><th scope="col">Follow-up</th><th scope="col">Details</th></tr></thead><tbody>${rows.map(s => `<tr><td><a class="lead-title" href="#" data-detail="${s.id}">${esc(s.title)}<small>${esc(s.service)}</small></a></td><td><div class="member-cell">${avatar(person(s.userId))}<strong>${esc(person(s.userId).name.split(' ')[0])}</strong></div></td><td class="nowrap">${esc(s.country)}</td><td><span class="badge ${s.status}">${s.status}</span></td><td><span class="badge ${s.stage}">${s.stage.replaceAll('_', ' ')}</span></td><td class="nowrap">${s.followUp ? `<span class="${s.followUp <= today() && !['won', 'lost'].includes(s.stage) ? 'offline' : ''}">${date(`${s.followUp}T00:00:00+05:00`)}</span>` : '—'}</td><td><div class="row-actions"><button class="btn small" data-detail="${s.id}">View</button><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open source for ${esc(s.title)}">${icon('external')}</a></div></td></tr>`).join('')}</tbody></table></div>` : empty('Your next opportunity goes here.', 'Add a lead with its source link and what they need.', `<br><button class="btn primary" data-add="lead">${icon('plus')}Add a lead</button>`);
}
function leads() {
  return heading('Your next win starts here.', 'One shared pipeline. Every opportunity accounted for.', `<button class="btn" data-action="export">${icon('download')}<span class="optional">Export</span></button><button class="btn primary" data-add="lead">${icon('plus')}Add lead</button>`) + `<section class="panel"><div class="toolbar"><label class="search"><span class="visually-hidden">Search leads</span>${icon('search')}<input type="search" placeholder="Search prospects, services, or teammates…" id="lead-search" value="${esc(query)}"></label><label><span class="visually-hidden">Filter by review or stage</span><select data-filter="status">${[['all', 'All statuses'], ['pending', 'In review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['new', 'New'], ['contacted', 'Contacted'], ['replied', 'Replied'], ['call_booked', 'Call booked'], ['won', 'Won'], ['lost', 'Lost']].map(([v, l]) => `<option value="${v}" ${filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label><span class="visually-hidden">Filter by country</span><select data-filter="country">${[['all', 'All countries'], ['USA', 'USA'], ['Pakistan', 'Pakistan'], ['Other', 'Other']].map(([v, l]) => `<option value="${v}" ${country === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><button class="btn small" data-action="mine" aria-pressed="${mine}">${mine ? 'My leads ✓' : 'My leads'}</button></div><div id="lead-results">${leadRows()}</div><div class="panel-footer">${icon('shield')}Duplicate source links are blocked across the team. Only approved leads count toward lead rankings.</div></section>`;
}
function review() {
  const admin = state.user.role === 'admin';
  const rows = state.submissions.filter(s => (filter === 'all' ? s.status === 'pending' : s.status === filter) && (admin || s.userId === state.user.id));
  return heading(admin ? 'Great work deserves a fair review.' : 'Your contributions, in review.', 'Only the workspace owner approves work. Owner reviews of their own contributions are recorded.', `<button class="btn primary" data-action="add">${icon('plus')}Add activity</button>`) + `<div class="toolbar panel no-margin"><div class="tabs" role="group" aria-label="Review status">${[['all', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([v, l]) => `<button data-review-filter="${v}" class="${filter === v ? 'active' : ''}">${l}</button>`).join('')}</div><span class="filters-note">${rows.length} ${rows.length === 1 ? 'submission' : 'submissions'}</span></div><div class="review-grid spaced">${rows.map(s => `<article class="panel review-card"><div class="review-top"><span class="badge ${s.status}">${icon(kindIcon(s.kind))}${kindLabel[s.kind]}</span><span class="review-meta">${s.kind === 'lead' ? 'Lead ranking' : `${state.scoring[s.kind]} ${s.status === 'approved' ? 'points' : 'pts on approval'}`}</span></div><h3>${esc(s.title)}</h3><div class="member-cell">${avatar(person(s.userId))}<div><strong>${esc(person(s.userId).name)}</strong><small>${dateTime(s.createdAt)}</small></div></div><div class="proof-box"><small>${s.kind === 'lead' ? 'Requirement' : 'Evidence & context'}</small>${esc(s.kind === 'lead' ? s.notes : s.proof)}</div>${s.reviewNote ? `<p>Review note: ${esc(s.reviewNote)}</p>` : ''}${s.url ? `<a class="detail-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${s.kind === 'dm' || outcomeKinds.includes(s.kind) ? 'Open private evidence' : 'Open original post'}</a>` : ''}${s.leadId ? `<button class="text-btn" data-detail="${s.leadId}">View linked lead ${icon('arrow')}</button>` : ''}<div class="review-actions">${admin ? s.status === 'pending' ? `<button class="btn primary small" data-approve="${s.id}">${icon('check')}Approve</button><button class="btn danger small" data-reject="${s.id}">Reject</button>` : s.status === 'approved' ? `<button class="btn danger small" data-revoke="${s.id}">Revoke approval</button>` : '' : s.status === 'pending' ? '<span class="muted-text">Awaiting the workspace owner’s review.</span>' : ''}${s.status === 'rejected' && s.userId === state.user.id ? `<button class="btn small" data-resubmit="${s.id}">Update evidence & resubmit</button>` : ''}</div></article>`).join('') || `<div class="panel">${empty('All clear for now.', filter === 'all' ? 'New submissions will appear here for review.' : 'There are no matching submissions.')}</div>`}</div>`;
}
function team() {
  const ranks = rankings();
  return heading('Better together.', 'The people behind your next big win.', `${periodSelect()}${state.user.role === 'admin' ? `<button class="btn primary" data-action="invite">${icon('plus')}Invite member</button>` : ''}`) + `<div class="team-grid">${state.members.map(m => { const r = ranks.find(r => r.id === m.id) || { points: 0, leads: 0, rank: '—' }; return `<article class="panel team-card"><div class="team-card-top">${avatar(m, true)}<span class="badge ${m.active ? 'muted' : 'rejected'}">${m.active ? m.role : 'Disabled'}</span></div><h3>${esc(m.name)}${m.id === state.user.id ? '<span class="you-tag">you</span>' : ''}</h3><div class="email">${esc(m.email)}</div><div class="team-numbers"><div><strong>${r.points}</strong><small>Points</small></div><div><strong>${r.leads}</strong><small>Leads</small></div><div><strong>${typeof r.rank === 'number' ? `#${r.rank}` : '—'}</strong><small>Rank</small></div></div>${state.user.role === 'admin' && m.id !== state.user.id ? `<button class="btn small" data-member="${m.id}">Manage access</button>` : '<span class="date-note">A team moving forward.</span>'}</article>`; }).join('')}</div><div class="callout spaced">You are the only admin. Every invitation grants member access. You approve contributions and manage your team. Invitations are email-bound, expire in 7 days, and can be used once.</div>`;
}
function activity() {
  return heading('A clear record of the work.', 'An append-only record of submissions, reviews, and access changes.') + `<section class="panel"><div class="panel-heading"><div><h2>Workspace audit trail</h2><p>Latest 200 events · Full history remains in the database</p></div>${icon('shield')}</div><div class="audit-list">${state.audit.map(a => `<div class="audit-row"><div><strong>${esc(person(a.actorId).name)}</strong> · ${esc(a.action.replaceAll('.', ' → '))}<p>${esc(a.details || a.targetId)}</p></div><time datetime="${a.createdAt}">${dateTime(a.createdAt)}</time></div>`).join('') || empty('A clean slate.', 'Workspace actions will appear here.')}</div></section>`;
}
function rules() {
  const guides = [['shield', 'One owner. Clear responsibility.', 'Only the workspace owner can approve or reject work, manage members, and set goals. The owner can review their own contributions; these reviews are marked in the audit trail.'], ['leads', 'One source, one lead', 'Source links are normalized and deduplicated across the whole team. Tracking parameters do not create a new lead.'], ['instagram', 'One original post, one reward', 'Submit the actual Instagram post or reel permalink. Profiles and repeated shortcodes are blocked. Reviewers should verify ownership, originality, and relevance.'], ['dm', 'A conversation, not a counter', 'Only the lead owner can claim one DM per approved lead. Evidence is required. Repeated follow-ups never add points.'], ['activity', 'A visible paper trail', 'Approvals, rejections, resubmissions, and access changes are recorded. Revoking approval removes the score automatically.'], ['key', 'Your own account, your own work', 'Invite-only accounts, protected sessions, submission limits, and server-calculated scores help prevent impersonation and point editing.']];
  return heading('Fair points. Real progress.', 'Simple rules your whole team can trust.') + `<div class="rules-grid"><article class="panel rule-card"><div class="rule-number">10</div><h3>Per Instagram post</h3><p>A unique post or reel, with a real permalink. Counted after the owner’s approval.</p></article><article class="panel rule-card"><div class="rule-number">1</div><h3>Per verified DM</h3><p>One outreach reward per approved lead, with evidence checked by an admin.</p></article><article class="panel rule-card"><div class="rule-number">↗</div><h3>Lead sourcing counts too</h3><p>Leads have their own ranking. They do not award points. Switch the leaderboard to “By leads”.</p></article></div><div class="rules-grid outcome-rules"><article class="panel rule-card"><div class="rule-number">5</div><h3>Per genuine client reply</h3><p>One verified response milestone per approved lead. Automated replies do not qualify.</p></article><article class="panel rule-card"><div class="rule-number">20</div><h3>Per confirmed booked call</h3><p>One confirmed meeting milestone per approved lead, backed by booking evidence.</p></article><article class="panel rule-card"><div class="rule-number">50</div><h3>Per client won</h3><p>A real accepted project or agreement, approved by the owner. One win reward per lead.</p></article></div><section class="panel"><div class="panel-heading"><div><h2>How we keep it fair</h2><p>Built-in controls, backed by a human review.</p></div>${icon('shield')}</div><div class="guide-list">${guides.map(([ic, title, desc]) => `<div class="guide-item">${icon(ic)}<div><strong>${title}</strong><p>${desc}</p></div></div>`).join('')}</div></section><div class="callout spaced">Evidence is reviewed by people. Leadroom does not automatically verify Instagram ownership or that a DM was sent. Check the live source and audit a random sample. Only the owner can review work. Owner reviews of their own work are explicitly logged.</div>`;
}
function render() {
  if (!state) return renderAuth();
  const views = { overview, goals, leads, leaderboard, review, team, activity, rules };
  app.innerHTML = shell((views[page] || overview)());
  document.title = `${labels[page]} · Leadroom`;
}
function field(name, label, type = 'text', value = '', options = '') {
  const control = type === 'textarea' ? `<textarea name="${name}" required maxlength="2000" ${options}>${esc(value)}</textarea>` : `<input type="${type}" name="${name}" value="${esc(value)}" ${options}>`;
  return `<label class="field"><span class="field-label">${label}</span>${control}</label>`;
}
function select(name, label, choices, value = '') { return `<label class="field"><span class="field-label">${label}</span><select name="${name}" required>${choices.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`; }
function openModal(title, description, contents) {
  modal.innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button class="icon-btn" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${contents}</div>`;
  if (!modal.open) modal.showModal();
}
const buttons = (submit = 'Submit for review') => `<div class="form-error" role="alert"></div><div class="modal-buttons"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn primary" type="submit">${submit}${icon('arrow')}</button></div>`;
function add(kind = 'lead') {
  let contents;
  if (kind === 'lead') contents = field('title', 'Prospect / company and opportunity', 'text', '', 'required minlength="3" maxlength="160" placeholder="e.g. Studio North · Website redesign"') + field('url', 'Original source post link', 'url', '', 'required maxlength="1500" placeholder="https://www.linkedin.com/posts/…"') + `<div class="form-row">${select('country', 'Country', [['Pakistan', 'Pakistan'], ['USA', 'USA'], ['Other', 'Other']])}${select('service', 'What do they need?', ['Web development', 'Website redesign', 'Landing page', 'Other'].map(s => [s, s]))}</div>` + field('notes', 'Requirement & useful context', 'textarea', '', 'minlength="15" placeholder="What are they asking for? Mention budget, timing, and the best way to contact them if known."') + '<p class="form-note">Add the original hiring post. Don’t submit a search page or an unrelated profile. Approved leads count toward the lead leaderboard.</p>';
  else if (kind === 'instagram') contents = field('title', 'Post title / campaign', 'text', '', 'required minlength="3" maxlength="160" placeholder="e.g. Our latest website transformation"') + field('url', 'Instagram post or reel permalink', 'url', '', 'required maxlength="1500" placeholder="https://www.instagram.com/p/…"') + field('proof', 'Ownership & campaign context', 'textarea', '', 'minlength="15" placeholder="Which account did you post from? Explain how this post promotes the team’s work."') + '<div class="callout"><strong>10 points</strong> after review. A post or reel can be credited only once across the team.</div>';
  else {
    const leads = state.submissions.filter(s => s.kind === 'lead' && s.status === 'approved' && s.userId === state.user.id && !state.submissions.some(d => d.kind === 'dm' && d.leadId === s.id));
    contents = leads.length ? select('leadId', 'Which lead did you contact?', leads.map(l => [l.id, l.title])) + field('url', 'Private evidence link', 'url', '', 'required maxlength="1500" placeholder="https://… (reviewer-accessible screenshot or record)"') + field('proof', 'DM context', 'textarea', '', 'minlength="15" placeholder="When and where did you send it? Include the recipient and a short summary. Redact personal information."') + '<div class="callout"><strong>1 point</strong> after review. One DM reward per lead. Evidence is visible only to you and the owner. Share it privately with the reviewer.</div>' : '<div class="callout">You need an approved lead you own, with no existing DM claim. Add a lead first, or update and resubmit a rejected DM in the review queue.</div>';
  }
  const noDM = kind === 'dm' && !state.submissions.some(s => s.kind === 'lead' && s.status === 'approved' && s.userId === state.user.id && !state.submissions.some(d => d.kind === 'dm' && d.leadId === s.id));
  openModal('Make your next move.', 'A small action today. A stronger pipeline tomorrow.', `<button class="btn outcome-shortcut" data-action="outcome">${icon('trophy')}Log a reply, call, or client win</button><div class="tabs" role="group" aria-label="Activity type">${[['lead', 'Add lead'], ['instagram', 'Instagram post'], ['dm', 'Log a DM']].map(([v, l]) => `<button data-add="${v}" class="${kind === v ? 'active' : ''}">${l}</button>`).join('')}</div><form data-form="submission" data-kind="${kind}">${contents}${noDM ? '' : buttons()}</form>`);
}
function detail(id) {
  const s = state.submissions.find(s => s.id === id);
  if (!s) return showToast('This item is no longer available.');
  const canEdit = s.userId === state.user.id || state.user.role === 'admin';
  const linkedDM = state.submissions.find(d => d.kind === 'dm' && d.leadId === s.id);
  openModal(esc(s.title), `${kindLabel[s.kind]} · Added by ${esc(person(s.userId).name)} · ${date(s.createdAt)}`, `<span class="badge ${s.status}">${s.status}</span><a class="detail-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open source ${icon('external')}</a><p class="detail-label">Requirement</p><p class="detail-content">${esc(s.notes || s.proof)}</p>${s.reviewNote ? `<div class="callout">Review note: ${esc(s.reviewNote)}</div>` : ''}${linkedDM ? `<p class="muted-text">DM claim: ${esc(linkedDM.status)} · ${esc(person(linkedDM.userId).name)}</p>` : ''}${s.kind === 'lead' && canEdit ? `<form data-form="update" data-id="${id}"><div class="form-row">${select('stage', 'Pipeline stage', ['new', 'contacted', 'replied', 'call_booked', 'won', 'lost'].map(s => [s, s[0].toUpperCase() + s.slice(1).replaceAll('_', ' ')]), s.stage)}${field('followUp', 'Next follow-up', 'date', s.followUp)}</div>${field('notes', 'Notes & requirement', 'textarea', s.notes, 'minlength="15"')}${buttons('Save lead')}</form>` : ''}${s.status === 'rejected' && s.userId === state.user.id ? `<button class="btn spaced" data-resubmit="${id}">Update evidence & resubmit</button>` : ''}`);
}
function reject(id, revoke = false) {
  openModal(revoke ? 'Revoke this approval?' : 'Leave a useful review.', revoke ? 'Its points will be removed immediately. Linked DM claims are also revoked when a lead loses approval.' : 'Explain what needs to change before it can count.', `<form data-form="review" data-id="${id}" data-decision="${revoke ? 'revoke' : 'reject'}">${field('reason', 'Reason', 'textarea', '', 'minlength="5" maxlength="500"')}${buttons(revoke ? 'Revoke approval' : 'Reject submission')}</form>`);
}
function invite() { openModal('Add a little more team.', 'An email-bound invitation. Valid for 7 days. You share the link.', `<form data-form="invite">${field('email', 'Email address', 'email', '', 'required maxlength="254" autocomplete="email" placeholder="teammate@example.com"')}<div class="callout">Your teammate will join as a member. Only you can review submissions, invite people, manage access, and set goals.</div>${buttons('Create invite link')}</form>`); }
function resubmit(id) { const s = state.submissions.find(s => s.id === id); openModal('Make it review-ready.', 'The original source link stays reserved. Add better evidence for another review.', `<form data-form="resubmit" data-id="${id}">${field('evidence', s.kind === 'lead' ? 'Updated requirement & context' : 'Updated evidence & context', 'textarea', s.kind === 'lead' ? s.notes : s.proof, 'minlength="15"')}${buttons('Resubmit for review')}</form>`); }
function manageMember(id) { const m = person(id); openModal('Manage workspace access.', esc(m.name), `<form data-form="member" data-id="${id}">${select('active', 'Account access', [['true', 'Active'], ['false', 'Disabled']], String(m.active))}<div class="callout">Disabling an account signs it out and hides it from current rankings. Its contributions and audit history are preserved.</div>${buttons('Save access')}</form>`); }
function password() { if (demo) return showToast('Account changes are available in your live workspace.'); openModal('Keep your account yours.', 'Changing your password signs you out on every device.', `<form data-form="password">${field('currentPassword', 'Current password', 'password', '', 'required autocomplete="current-password"')}${field('password', 'New password', 'password', '', 'required minlength="12" maxlength="200" autocomplete="new-password"')}<p class="form-note">Use a unique passphrase of at least 12 characters.</p>${buttons('Change password')}</form>`); }
function exportCSV() {
  const rows = filteredLeads();
  const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
  const columns = ['Prospect', 'Owner', 'Country', 'Service', 'Review', 'Stage', 'Follow-up', 'Source', 'Notes'];
  const data = [columns, ...rows.map(s => [s.title, person(s.userId).name, s.country, s.service, s.status, s.stage, s.followUp, s.url, s.notes])].map(row => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + data], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `leadroom-${today()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast(`Exported ${rows.length} leads with current filters.`);
}
function renderAuth() {
  const joining = location.pathname === '/join', setup = needsSetup && !joining;
  const title = joining ? 'You’re invited.' : setup ? 'Your team starts here.' : 'Welcome back.';
  app.innerHTML = `<div class="auth-layout"><aside class="auth-art">${brand()}<div><div class="eyebrow">Your next win starts here</div><h1>More leads.<br>Better teamwork.<br><em>Real progress.</em></h1><p>One shared pipeline for the people building your next big thing. Track the effort. Celebrate the wins.</p></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit"></div><div class="orbit"></div></div><footer>A NEXWEB workspace · Made for teams that do the work.</footer></aside><main class="auth-main"><div class="auth-form">${brand('auth-mobile-brand')}<span class="eyebrow">Leadroom workspace</span><h2>${title}</h2><p>${joining ? 'Create your account with the email your admin invited.' : setup ? setupLocation === 'cloudflare' ? 'Create your admin account using the private SETUP_TOKEN you saved in Cloudflare.' : 'Create the first admin account. You’ll find the private setup code in your server terminal.' : 'Sign in to pick up where your team left off.'}</p><form data-form="${joining ? 'join' : setup ? 'setup' : 'login'}">${joining || setup ? field('name', 'Your name', 'text', '', 'required minlength="2" maxlength="70" autocomplete="name"') : ''}${field('email', 'Email address', 'email', '', 'required autocomplete="email" maxlength="254" placeholder="you@example.com"')}${field('password', 'Password', 'password', '', `required ${setup || joining ? 'minlength="12" autocomplete="new-password"' : 'autocomplete="current-password"'} maxlength="200"`)}${setup ? field('setupToken', 'Private setup code', 'password', '', 'required autocomplete="off"') : ''}${setup || joining ? '<p class="form-note">Use a unique password with at least 12 characters.</p>' : ''}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">${joining ? 'Join your team' : setup ? 'Create workspace' : 'Sign in'}${icon('arrow')}</button></form><p class="auth-foot">${joining ? '<a href="/">Already a member? Sign in</a>' : 'Want to take a look first? <a href="/demo">Explore the preview ↗</a>'}</p><p class="form-note">Invite-only access. Ask your admin for an invitation${setup ? ' after they complete setup' : ''}.</p></div></main></div>`;
  document.title = `${joining ? 'Join your team' : 'Welcome'} · Leadroom`;
}

function demoMutation(type, input, id) {
  const createdAt = new Date().toISOString();
  if (type === 'submission') {
    const existing = state.submissions.find(s => (input.kind === 'lead' || input.kind === 'instagram') && s.kind === input.kind && s.url.replace(/\?.*$/, '').replace(/\/$/, '') === input.url?.replace(/\?.*$/, '').replace(/\/$/, '') || (input.kind === 'dm' || outcomeKinds.includes(input.kind)) && s.kind === input.kind && s.leadId === input.leadId);
    if (existing) throw new Error('This item already exists in the sample workspace.');
    const lead = state.submissions.find(s => s.id === input.leadId);
    if ((input.kind === 'dm' || outcomeKinds.includes(input.kind)) && (!lead || lead.status !== 'approved' || lead.userId !== state.user.id)) throw new Error('Choose an approved lead you own.');
    state.submissions.unshift({ id: crypto.randomUUID(), userId: state.user.id, ...input, title: input.kind === 'dm' || outcomeKinds.includes(input.kind) ? `${kindLabel[input.kind]} · ${lead?.title}` : input.title, country: input.country || '', service: input.service || '', notes: input.notes || '', proof: input.proof || '', status: 'pending', stage: 'new', followUp: '', createdAt, updatedAt: createdAt, approvedAt: '', reviewerId: null, reviewNote: '' });
  } else if (type === 'review') {
    const s = state.submissions.find(s => s.id === id);
    if (state.user.role !== 'admin') throw new Error('Only the workspace owner can review submissions.');
    s.status = input.decision === 'approve' ? 'approved' : 'rejected'; s.approvedAt = s.status === 'approved' ? createdAt : ''; s.reviewerId = state.user.id; s.reviewNote = input.reason || '';
    if (s.kind === 'lead' && input.decision === 'revoke') for (const d of state.submissions.filter(d => d.leadId === id)) { d.status = 'rejected'; d.approvedAt = ''; d.reviewNote = 'Linked lead approval was revoked.'; }
    if (s.kind === 'dm' && s.status === 'approved') { const l = state.submissions.find(l => l.id === s.leadId); if (l?.stage === 'new') l.stage = 'contacted'; }
  } else if (type === 'update') Object.assign(state.submissions.find(s => s.id === id), input);
  else if (type === 'resubmit') { const s = state.submissions.find(s => s.id === id); s.status = 'pending'; s.reviewNote = ''; s[s.kind === 'lead' ? 'notes' : 'proof'] = input.evidence; }
  else if (type === 'member') { if (id === state.user.id || input.role && input.role !== 'member') throw new Error('The workspace has one admin.'); Object.assign(person(id), { role: 'member', active: input.active }); }
  state.audit.unshift({ id: state.audit.length + 1, actorId: state.user.id, action: `demo.${type}`, targetId: id || 'sample', details: 'Sample action in the preview workspace.', createdAt });
}
async function approve(id) {
  try { if (demo) demoMutation('review', { decision: 'approve' }, id); else await api(`submissions/${id}/review`, { decision: 'approve' }); await refresh(); showToast('Approved. Rankings are up to date.'); } catch (e) { showToast(e.message); }
}
async function onSubmit(event) {
  const form = event.target.closest('form[data-form]'); if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form)), type = form.dataset.form, error = $('.form-error', form), button = $('button[type="submit"]', form);
  if (error) error.textContent = '';
  if (button) button.disabled = true;
  try {
    if (['login', 'setup', 'join'].includes(type)) {
      if (type === 'join') data.token = location.hash.slice(1);
      const result = await api(type, data); csrf = result.csrf; needsSetup = false; history.replaceState(null, '', '/'); await refresh(); startPolling(); return;
    }
    if (type === 'invite') {
      if (demo) { openModal('Invites are ready in your workspace.', 'The preview uses sample people. No invitation was created.', '<div class="callout">Open your workspace, create an admin account, then invite your teammates. Your real invite links will be bound to their email addresses.</div><div class="modal-buttons"><button class="btn primary" data-action="close">Got it</button></div>'); return; }
      const invite = await api('invites', data);
      const inviteURL = `${location.origin}/join#${invite.token}`;
      openModal('Make room for your teammate.', `Invitation for ${esc(invite.email)} · Expires ${date(invite.expiresAt)}`, `<div class="callout">Share this link privately with ${esc(invite.email)}. It can be used once. No email has been sent automatically.</div><input class="invite-url" readonly aria-label="Private invitation link" value="${esc(inviteURL)}"><button class="btn primary full" data-action="copy-invite">${icon('copy')}Copy private invite link</button>`); return;
    }
    if (type === 'goals') {
      if (state.user.role !== 'admin') throw new Error('Only the workspace owner can set goals.');
      const values = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Number(value)]));
      if (demo) { if (Object.values(values).some(v => !Number.isInteger(v) || v < 1 || v > 100000)) throw new Error('Use positive whole numbers.'); state.goals = values; } else await api('goals', values);
      modal.close(); await refresh(); showToast('Weekly goals updated. Let’s make progress together.'); return;
    }
    if (type === 'password') { await api('password', data); modal.close(); state = null; clearInterval(refreshTimer); renderAuth(); showToast('Password changed. Sign in again.'); return; }
    const id = form.dataset.id;
    if (type === 'submission') { data.kind = form.dataset.kind === 'outcome' ? data.outcomeKind : form.dataset.kind; if (data.kind === 'dm' || outcomeKinds.includes(data.kind)) data.title = kindLabel[data.kind]; delete data.outcomeKind; }
    if (type === 'review') data.decision = form.dataset.decision;
    if (type === 'member') data.active = data.active === 'true';
    if (demo) demoMutation(type, data, id);
    else {
      const endpoint = type === 'submission' ? 'submissions' : type === 'member' ? `members/${id}` : `submissions/${id}/${type}`;
      await api(endpoint, data);
    }
    modal.close(); await refresh(); showToast(type === 'submission' || type === 'resubmit' ? 'Submitted for review. It will count after approval.' : type === 'review' ? 'Review saved. Rankings are up to date.' : 'Saved. Your team is up to date.');
  } catch (e) { if (error?.isConnected) error.textContent = e.message; else showToast(e.message); }
  finally { if (button?.isConnected) button.disabled = false; }
}
document.addEventListener('submit', onSubmit);
document.addEventListener('click', async event => {
  const el = event.target.closest('button,a'); if (!el) return;
  if (el.dataset.page) { event.preventDefault(); page = el.dataset.page; filter = 'all'; query = ''; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (el.dataset.add) { event.preventDefault(); add(el.dataset.add); }
  else if (el.dataset.detail) { event.preventDefault(); detail(el.dataset.detail); }
  else if (el.dataset.metric) { metric = el.dataset.metric; render(); }
  else if (el.dataset.reviewFilter) { filter = el.dataset.reviewFilter; render(); }
  else if (el.dataset.approve) await approve(el.dataset.approve);
  else if (el.dataset.reject) reject(el.dataset.reject);
  else if (el.dataset.revoke) reject(el.dataset.revoke, true);
  else if (el.dataset.resubmit) resubmit(el.dataset.resubmit);
  else if (el.dataset.member) manageMember(el.dataset.member);
  else if (el.dataset.action) {
    const action = el.dataset.action;
    if (action === 'close') modal.close();
    else if (action === 'add') add();
    else if (action === 'outcome') logOutcome();
    else if (action === 'edit-goals' && state.user.role === 'admin') editGoals();
    else if (action === 'invite') invite();
    else if (action === 'password') password();
    else if (action === 'mine') { mine = !mine; render(); }
    else if (action === 'export') exportCSV();
    else if (action === 'logout') { if (demo) { location.href = '/'; return; } try { await api('logout', {}); state = null; clearInterval(refreshTimer); renderAuth(); } catch (e) { showToast(e.message); } }
    else if (action === 'copy-invite') { const input = $('.invite-url', modal); try { await navigator.clipboard.writeText(input.value); showToast('Private invitation link copied.'); } catch { input.select(); showToast('Select and copy the invitation link.'); } }
  }
});
document.addEventListener('change', event => {
  const field = event.target.dataset.filter;
  if (field === 'period') { period = event.target.value; render(); }
  else if (field === 'status') { filter = event.target.value; $('#lead-results').innerHTML = leadRows(); }
  else if (field === 'country') { country = event.target.value; $('#lead-results').innerHTML = leadRows(); }
});
document.addEventListener('input', event => { if (event.target.id === 'lead-search') { query = event.target.value; $('#lead-results').innerHTML = leadRows(); } });
modal.addEventListener('click', e => { if (e.target === modal) { const r = modal.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) modal.close(); } });
function startPolling() {
  clearInterval(refreshTimer);
  if (demo) return;
  refreshTimer = setInterval(async () => {
    if (!state || document.hidden || modal.open || document.activeElement?.matches('input,select,textarea')) return;
    try { await refresh(); } catch { const status = $('#sync-status'); if (status) { status.textContent = 'Connection interrupted'; status.classList.add('offline'); } }
  }, 20000);
}
async function init() {
  try {
    if (demo) { state = seedDemo(); render(); return; }
    const session = await api('session'); csrf = session.csrf; needsSetup = session.needsSetup; setupLocation = session.setupLocation || 'local';
    if (session.user) { await refresh(); startPolling(); } else renderAuth();
  } catch (error) { app.innerHTML = `<main class="error-page"><h1>The workspace isn’t ready yet.</h1><p>${esc(error.message || 'Check your connection, then try again.')}</p><button class="btn primary" id="retry">Try again</button></main>`; $('#retry').onclick = init; }
}
init();
