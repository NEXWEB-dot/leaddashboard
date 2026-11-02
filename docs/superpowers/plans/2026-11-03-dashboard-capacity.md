# Dashboard capacity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Support ten simultaneous teammates and 1,500 leads/week without repeated full-history scans.
**Architecture:** Add transactionally maintained approval buckets and revisions to D1, compact authenticated dashboard/list/detail APIs with revision-based caching, and capability-gated frontend pagination/conditional polling. Keep legacy Node and old Cloudflare clients functional during the additive rollout.
**Tech Stack:** Existing Node 24, vanilla browser JS, Pages Functions, D1, Web Crypto, Node tests, workerd/Miniflare.
**Spec:** docs/superpowers/specs/2026-11-03-dashboard-capacity-design.md (approved 2026-11-03).

## Global constraints
- Only the original owner is admin; approved-only scoring and evidence redaction remain enforced.
- 50-row interactive pages; 60-second conditional polling; no automatic mutation retries.
- Existing accounts, leads, and audit history survive migration. No paid service is provisioned.
- Keep the existing checkout and dependencies; use a task branch, then integrate and push under the user's existing authorization.
- Execute inline and obtain one independent whole-change review before publication.

## Review focus
- Cached data cannot bypass disabled-user/session checks or expose another member's evidence.
- Concurrent changes and linked revocations must preserve exact counters and monotonic revisions.
- Migration reruns and legacy clients must not duplicate summaries or truncate complete-history contracts.
- Pagination, old-lead selection, and exports must not silently lose history.
- Failed/slow reads must not overwrite newer filters, retry mutations, erase forms, or fabricate freshness.

### Task 1: Additive summary migration
**Files:** cloudflare/migrations/0001-capacity.sql, cloudflare/schema.sql, tests/capacity.test.mjs.
**Interfaces:** summary_counts(user_id,bucket,kind,count), workspace_meta(id,revision); approved buckets `all`, `week:<UTC Monday start>`, `month:<UTC month start>`, `day:<Karachi date>`; approval triggers apply OLD negative/NEW positive deltas. All visible mutations increment revision.
- [ ] Write migration parity/rerun/revocation tests; run and observe failure.
- [ ] Add schema, atomic maintenance, bounded-query indexes and idempotent backfill.
- [ ] Verify populated migration, rerun, source preservation, approval rollback and period correctness.

### Task 2: Compact authenticated data API
**Files:** cloudflare/compact.mjs, cloudflare/app.mjs, tests/capacity.test.mjs.
**Interfaces:** `/api/session` exposes `compact` capability only when migration ready; `/api/dashboard` returns compact state, totals, daily, leaderboards, pendingCount, recent submissions and `version`; `/api/records?view=leads|review|eligible&filter=&country=&mine=&query=&cursor=&limit=` returns `{items,nextCursor}`; `/api/records/:id` returns redacted detail with linked claims; `/api/dashboard` accepts If-None-Match and returns 304 before expensive reads; ETag includes schema revision and Karachi day.
- [ ] Test conditional reads, role redaction, keyset filters, older eligible leads and migration-unready fallback; observe failure.
- [ ] Implement bounded queries and summary-based totals. Preserve legacy `/api/state` contract.
- [ ] Use short revision-keyed shared cache only for sanitized common summaries; auth remains outside cache; cache failures fall back.
- [ ] Verify immediate version change, revocation, privacy, and unchanged read costs.

### Task 3: Frontend compact mode and resilience
**Files:** public/app.js, public/goals.css, tests/client.test.mjs.
**Interfaces:** Read session capability, consume Task 2 contracts; legacy/demo code continues using full state. Compact state never derives complete totals from its bounded recent submissions.
- [ ] Add failing client tests for compact totals, list paging, conditional refresh and error handling.
- [ ] Adapt totals, charts, badges, review counts, table pages, detail retrieval, eligible-lead search and full filtered exports.
- [ ] Add 60-second staggered polling, visibility/idle pause, in-flight guards, read backoff, last-sync indication and stale-response guards.
- [ ] Verify current legacy/demo tests and new compact workflows; retain form content on failures.

### Task 4: Static caching and rollout guide
**Files:** scripts/build-pages.mjs, tests/build.test.mjs, CLOUDFLARE-SETUP.md, README.md.
- [ ] Add failing build tests checking fingerprinted referenced files and correct cache headers.
- [ ] Fingerprint static assets; keep entry HTML revalidated and sensitive API output no-store. Remove canonicalizing `/index.html` rewrites by building explicit route HTML where appropriate, retaining invitation compatibility.
- [ ] Document additive migration, metrics, summary rebuild/parity check, capability readiness, quota headroom and reconnect/deployment verification.

### Task 5: Scale and workerd verification
**Files:** scripts/verify-capacity.mjs, scripts/verify-pages.mjs, package.json, .github/workflows/check.yml.
- [ ] Generate 39,000 leads plus representative outreach for ten members in temporary test storage.
- [ ] Verify migration/counter parity and ten concurrent conditional refresh clients, page filters and exports. Report operations and realistic limitations.
- [ ] Run compiled Functions in real workerd/D1; measure rows_read/rows_written for unchanged/changed dashboard, list, submission and approval paths.
- [ ] Run syntax, full tests, Pages build/compile and runtime tests. Fix observed failures only.

### Task 6: Review and publication
- [ ] Get one fresh read-only whole-change review; fix critical/important findings with regression tests.
- [ ] Commit reviewed implementation, integrate task branch and push to origin/main.
- [ ] Check deployed asset version. If database migration or GitHub connectivity requires the user's account, supply exact remaining steps without claiming production completion.
