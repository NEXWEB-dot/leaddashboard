# Multi-Admin Support & Lead Sources (LinkedIn/Facebook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multi-admin capabilities across the workspace (inviting admins, promoting members, preventing lockout) and add dedicated LinkedIn / Facebook / Other platform selection with robust URL normalization and UI badges for leads.

**Architecture:** 
1. Normalization engine in `lib/rules.mjs` extended with Facebook URL canonicalization (stripping tracking query parameters, standardizing mobile/web subdomains) alongside existing LinkedIn logic.
2. Database schemas (`cloudflare/schema.sql`, `lib/store.mjs`, and migration `0002-multi-admin.sql`) updated to drop the single-admin unique constraint `users_one_admin` and relax `invites.role` check.
3. Backend stores (`lib/store.mjs`, `cloudflare/store.mjs`) updated to allow admin invites, member role changes, and platform tagging, with a safety invariant ensuring at least one active admin remains.
4. Client interface (`public/app.js`) updated with platform selectors, dynamic placeholders, lead source badges, and admin invitation/role management.

**Tech Stack:** Node.js 24 (ES Modules), SQLite / Cloudflare D1, vanilla JS (no external runtime dependencies), Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-11-07-multi-admin-and-lead-sources-design.md`](../specs/2026-11-07-multi-admin-and-lead-sources-design.md)

## Global Constraints

- No third-party runtime dependencies (Node.js standard library and Cloudflare Pages Functions built-ins only).
- Retain exact backward compatibility for existing records (leads without an explicit platform derive it from URL).
- Audit trail integrity: all member promotions, demotions, and admin invitations must be recorded in the append-only `audit` log.
- Workspace safety: the last active workspace admin must never be demoted or disabled.

## Review Focus

1. **Facebook Tracking Bloat:** URLs containing messy tracking queries (`fbclid`, `mibextid`, `rdid`, `__cft__`, `ref`) must be stripped cleanly while preserving necessary IDs for `permalink.php?story_fbid=...&id=...`.
2. **Facebook Mobile Subdomains:** Links from `m.facebook.com`, `web.facebook.com`, and `fb.com` must canonicalize to `facebook.com` so identical leads posted from mobile vs desktop are detected as duplicates.
3. **Admin Lockout Prevention:** Demoting or disabling an admin when only 1 active admin exists must be rejected with 403.
4. **Self-Review Auditing:** When any admin reviews their own lead or activity, the audit trail must record it as an admin action.
5. **Existing Lead Compatibility:** Existing leads in the database without a `platform` column must render without errors, displaying the correct platform derived from their source URL.

---

### Task 1: Facebook and LinkedIn URL Canonicalization

**Files:**
- Modify: `lib/rules.mjs:15-36`
- Modify: `tests/rules.test.mjs`

**Interfaces:**
- Produces: `safeURL(value, label, platform)` or `normalizeLeadURL(value, platform)` returning `{ url, platform }`.
- Export: `facebookURL(value)` or unified platform normalizer.

- [ ] **Step 1: Write failing tests for Facebook and LinkedIn URL canonicalization**
Add test in `tests/rules.test.mjs`:
```javascript
test('normalizes Facebook and LinkedIn URLs and strips tracking parameters', () => {
  assert.equal(
    safeLeadURL('https://m.facebook.com/groups/123/posts/456/?mibextid=6aamW6&fbclid=IwAR123', 'facebook'),
    'https://facebook.com/groups/123/posts/456'
  );
  assert.equal(
    safeLeadURL('https://web.facebook.com/permalink.php?story_fbid=123&id=456&substory_index=0&fbclid=xyz', 'facebook'),
    'https://facebook.com/permalink.php?story_fbid=123&id=456'
  );
  assert.equal(
    safeLeadURL('https://www.linkedin.com/posts/acme_hiring-activity-123456789-abcd?utm_source=share', 'linkedin'),
    'https://www.linkedin.com/feed/update/urn:li:activity:123456789'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/rules.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement Facebook URL normalization and platform handling in `lib/rules.mjs`**
Enhance URL cleaning to:
- Convert `m.facebook.com`, `web.facebook.com`, `mbasic.facebook.com`, `fb.com`, `touch.facebook.com` to `facebook.com`.
- Strip tracking query parameters (`fbclid`, `mibextid`, `rdid`, `ref`, `ref_src`, `__cft__`, `__tn__`, `utm_*`).
- Retain query parameters only if required by permalink format (`story_fbid`, `id`).
- Export helper to detect and validate lead platform (`linkedin`, `facebook`, `other`).

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/rules.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/rules.mjs tests/rules.test.mjs
git commit -m "feat: add facebook and linkedin lead url canonicalization"
```

---

### Task 2: Multi-Admin Support in Backend & Database

**Files:**
- Modify: `cloudflare/schema.sql`
- Create: `cloudflare/migrations/0002-multi-admin.sql`
- Modify: `lib/store.mjs`
- Modify: `cloudflare/store.mjs`
- Modify: `tests/store.test.mjs`
- Modify: `tests/cloudflare.test.mjs`

**Interfaces:**
- Consumes: User and invite models.
- Produces:
  - `invite(user, { email, role })`: creates invite for 'admin' or 'member'.
  - `updateMember(user, id, { role, active })`: updates role with lockout protection.

- [ ] **Step 1: Write failing tests for multi-admin invitations and promotion**
Add tests in `tests/store.test.mjs`:
```javascript
test('allows inviting a second admin and promoting members to admin', () => {
  const store = createStore(':memory:');
  const admin1 = store.bootstrap({ name: 'Admin One', email: 'admin1@example.com', password: 'password12345' });
  const invite = store.invite(admin1, { email: 'admin2@example.com', role: 'admin' });
  assert.equal(invite.role, 'admin');
  const admin2 = store.join({ token: invite.token, name: 'Admin Two', email: 'admin2@example.com', password: 'password12345' });
  assert.equal(admin2.role, 'admin');
  // Verify admin2 can also invite members
  const memberInvite = store.invite(admin2, { email: 'member@example.com', role: 'member' });
  assert.equal(memberInvite.role, 'member');
  // Verify cannot demote last active admin
  assert.throws(() => store.updateMember(admin1, admin1.id, { role: 'member' }), /at least one active admin/);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/store.test.mjs`
Expected: FAIL ("This workspace has one admin")

- [ ] **Step 3: Implement multi-admin support in schemas and stores**
1. In `cloudflare/schema.sql` and `lib/store.mjs`:
   - Remove `CREATE UNIQUE INDEX IF NOT EXISTS users_one_admin ON users(role) WHERE role='admin'`.
   - Update `invites.role CHECK(role IN ('admin','member'))`.
2. In `lib/store.mjs`:
   - Remove the multi-admin demotion loop on database open.
   - In `invite()`: Allow `role: input.role === 'admin' ? 'admin' : 'member'`.
   - In `updateMember()`: Allow changing role between `admin` and `member`. Check `SELECT count(*) FROM users WHERE role='admin' AND active=1 AND id != ?` to ensure at least one active admin remains.
3. In `cloudflare/store.mjs`:
   - In `invite()`: Accept `role: input.role === 'admin' ? 'admin' : 'member'`.
   - In `updateMember()`: Allow updating `role`, with identical lockout check.
4. Create `cloudflare/migrations/0002-multi-admin.sql`:
   ```sql
   DROP INDEX IF EXISTS users_one_admin;
   ```

- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test tests/store.test.mjs tests/cloudflare.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add cloudflare/schema.sql cloudflare/migrations/0002-multi-admin.sql lib/store.mjs cloudflare/store.mjs tests/store.test.mjs tests/cloudflare.test.mjs
git commit -m "feat: add multi-admin support with lockout protection"
```

---

### Task 3: Platform Field Support in Lead Submissions

**Files:**
- Modify: `lib/store.mjs`
- Modify: `cloudflare/store.mjs`
- Modify: `cloudflare/compact.mjs`
- Modify: `tests/store.test.mjs`

**Interfaces:**
- Consumes: `safeLeadURL(url, platform)` from Task 1.
- Produces: Submission records with `platform` field (`linkedin`, `facebook`, `other`).

- [ ] **Step 1: Write failing test for lead submission with platform**
Add test in `tests/store.test.mjs`:
```javascript
test('records lead platform and validates URL matches chosen platform', () => {
  const store = createStore(':memory:');
  const user = store.bootstrap({ name: 'Admin', email: 'admin@example.com', password: 'password12345' });
  const lead = store.submit(user, {
    kind: 'lead',
    title: 'Acme Corp',
    platform: 'facebook',
    url: 'https://m.facebook.com/groups/123/posts/456/?mibextid=abc',
    country: 'USA',
    service: 'Web development',
    notes: 'Looking for a new website.'
  });
  assert.equal(lead.platform, 'facebook');
  assert.equal(lead.url, 'https://facebook.com/groups/123/posts/456');
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/store.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement platform field handling in `lib/store.mjs`, `cloudflare/store.mjs`, and `cloudflare/compact.mjs`**
- In `submit()`: Read `input.platform || detectPlatform(input.url)`. Validate that chosen platform matches URL if LinkedIn or Facebook selected.
- In `publicSubmission()` and `cleanRow()`: Include `platform: r.platform || detectPlatform(r.url)`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/store.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/store.mjs cloudflare/store.mjs cloudflare/compact.mjs tests/store.test.mjs
git commit -m "feat: add lead platform handling in store and responses"
```

---

### Task 4: Client UI for Multi-Admin & Lead Platform Selector

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/client.test.mjs`

**Interfaces:**
- In `add('lead')`: Platform selection dropdown and dynamic placeholder.
- In `leadRows()` / `detail()`: Display platform badge.
- In `invite()`: Role selection dropdown.
- In `manageMember()`: Role selection dropdown.

- [ ] **Step 1: Write test for client UI elements in `tests/client.test.mjs`**
Verify the add-lead modal includes the platform selector and the invite modal includes the role selector.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/client.test.mjs`
Expected: FAIL

- [ ] **Step 3: Update `public/app.js`**
1. In `add(kind)`:
   - For `kind === 'lead'`: Add platform select `[['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['other', 'Other']]`.
   - Update input placeholder dynamically or provide clear guidance.
2. In `leadRows()` and `detail()`:
   - Render a platform tag/badge next to the lead title (e.g. `<span class="badge platform-${s.platform}">${s.platform}</span>`).
3. In `invite()` modal:
   - Add role select: `select('role', 'Role', [['member', 'Team member'], ['admin', 'Workspace admin']])`.
4. In `manageMember()` modal:
   - Add role select: `select('role', 'Role', [['member', 'Team member'], ['admin', 'Workspace admin']], m.role)`.
5. In `team()` view:
   - Update informational copy to reflect multi-admin capabilities.
6. In `public/styles.css`:
   - Add styling for `.badge.platform-linkedin`, `.badge.platform-facebook`, `.badge.platform-other`.

- [ ] **Step 4: Run client tests and complete test suite**
Run: `npm.cmd test --prefix leaddashboard`
Expected: All tests pass.

- [ ] **Step 5: Commit**
```bash
git add public/app.js public/styles.css tests/client.test.mjs
git commit -m "feat: add platform selector and multi-admin UI controls"
```

---

### Task 5: Full Verification & Build Validation

**Files:**
- None (verification only)

- [ ] **Step 1: Run complete check script**
Run: `npm.cmd run check --prefix leaddashboard`
Expected: Clean check with no syntax errors.

- [ ] **Step 2: Run Pages build**
Run: `npm.cmd run build:pages --prefix leaddashboard`
Expected: `dist` compiled successfully.

- [ ] **Step 3: Run complete test suite**
Run: `npm.cmd test --prefix leaddashboard`
Expected: All passing.
