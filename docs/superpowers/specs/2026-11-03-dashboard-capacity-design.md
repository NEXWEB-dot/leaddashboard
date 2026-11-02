# Leadroom capacity and caching design

Date: 2026-11-03

## Intent and agreed constraints

Support the owner's approximately 10 simultaneous teammates and 1,000–1,500 new leads each week. Preserve the existing Cloudflare Pages/D1 deployment, accounts, invitations, sole-admin permissions, evidence privacy, and approval-based scoring. The owner requested the previously recommended caching and data-loading improvements. No paid service, hosting change, or extra account is assumed.

The implementation choices below are proposed engineering decisions. This document is a reviewable design, not a claim that these changes are implemented or that the free tier guarantees availability.

## Findings in the current implementation

- `public/app.js` refreshes the full state every 20 seconds while the tab is visible and no form/modal is active.
- `cloudflare/store.mjs:state` reads every user and submission and recalculates six leaderboards. Most screens derive totals from that complete submission array.
- Every API request updates a D1 rate-limit counter. Current API responses deliberately use `Cache-Control: no-store`.
- Approved contributions, pending work, review evidence, and audit history are mixed in the same state response. Caching that response across members would violate privacy.
- The standalone Node version shares the frontend but has its own SQLite implementation. It must remain usable.
- The last confirmed production deployment had an interrupted GitHub connection. Code publication and successful Cloudflare deployment are distinct checks.

## Approaches

1. **Cache the existing full dashboard response.** Small change, but every cache miss still scans the growing history, transfers all records, and recalculates scores. Per-member responses also contain private data. This does not meet the long-term requirement.
2. **Keep Pages/D1 and combine bounded queries, approval summaries, conditional refreshes, and scoped caches.** Recommended. Changes the application instead of adding a service. Includes an additive database migration and focused frontend adaptations.
3. **Move hosting/database or add a realtime service.** Adds account setup, cost, and migration work without first correcting the existing excessive reads. Not selected for this request.

The recommended scope is approach 2. The owner has authorized optimization of the existing application; approval of this document settles the concrete implementation scope before product code changes.

## Proposed behavior

### Approved interface extension

During implementation the owner requested an enterprise-quality, less intimidating interface inspired by ClickUp and explicitly selected **My work and next steps** as the member home focus. Keep the existing application and permission model. Use a calmer neutral surface with purple accents, clearer navigation, personal approved totals, a prominent Add lead action, simple status labels, a concise first-use guide, and separate admin review entry points. Preserve complete team views and responsive mobile access. This is an extension of the authorized frontend work, not a new product or backend service.

### 1. Bounded data loading

- Replace the Cloudflare full-history state response with compact dashboard data and a capability marker. Return member summaries, rankings, counts, chart buckets, goals, and a small recent-activity list.
- Load lead and review tables in pages of 50. Apply country, status/stage, owner, and search filters on the server. Use a deterministic cursor based on creation time and ID rather than an offset for changing queues. Reset the cursor when filters change.
- Show the current result range/next/previous controls. Never imply that totals or exports represent only the loaded page.
- Fetch submission details separately by ID. Recheck permissions and redact private outreach/outcome evidence for other members at that boundary.
- The outreach/outcome form needs a bounded searchable selector for the member's own approved leads; older approved leads must remain selectable.
- Export all matching leads deliberately in sequential bounded batches, with existing CSV formula escaping. Exports are user-triggered, not part of polling.
- Debounce search and cancel/ignore obsolete responses. Indexed filters are the normal path; measure text-search scan costs rather than assuming a substring search uses an index.
- Preserve the existing full-state path for the standalone Node backend unless it is upgraded to the same capability in this change. The frontend uses the capability marker, so the local backend does not call unsupported endpoints.

### 2. Correct summaries maintained on approval

- Add derived counters for each member and contribution kind, covering lifetime, Karachi week, Karachi month, and daily chart buckets. Add compact review/lead counts where needed.
- Update these counters transactionally when a submission enters or leaves approved status. Pending/rejected work never contributes to approved totals.
- Revoking an approved lead also removes approved linked DM/outcome contributions in the same transaction, exactly as today. Repeated/concurrent reviews must not double-count or make counters negative.
- Prefer database triggers or one central transactional mechanism over independently updating totals in several route handlers. Backfill counters once from existing records during migration.
- Keep contributions and audit records as the source of truth. A verification/rebuild procedure compares/reconstructs derived counters without deleting source records.
- Existing tie ranking, disabled-member handling, owner self-review audit, weekly goals, lifetime badges, and approval-date rules remain unchanged. Preserve the distinction between team-wide approved activity totals and active-member leaderboard totals.

### 3. Conditional refresh and request reduction

- Replace 20-second full refreshes with a 60-second conditional refresh while actively viewing the app. Pause hidden and idle tabs, avoid overlapping requests, and stagger polling across clients.
- Store a monotonically increasing workspace revision, advanced atomically with mutations affecting visible state. Include Karachi day/period boundaries in the effective version so midnight and weekly/monthly changes do not leave old totals on screen.
- An authenticated unchanged-version request returns `304` without reading submissions or recomputing summaries. A changed version fetches only the currently needed compact data/page.
- A user's own successful submission, approval, revocation, goal edit, or member change refreshes immediately. Other active members normally see updates within 60 seconds. Explain this timing in the UI.
- Respect `Retry-After` on throttling and use bounded exponential backoff on failures. Show last successful sync and an honest stale/offline message while preserving the visible data.
- Preserve the content of an unsent form after an error. Do not automatically retry non-idempotent submissions or reviews; this can cause duplicate actions.

### 4. Safe caching

- Use browser/CDN caching for fingerprinted static CSS/JS/icon assets. Keep the HTML entry point revalidated so deployment updates are discovered.
- Cache only sanitized common dashboard summaries for short periods, approximately 30–60 seconds. Key by workspace origin, revision, and date/period. A cache miss uses bounded summary queries, not a contribution-history scan.
- Authenticate every API request before using any cache. Continue to check session revocation and whether the member is active.
- Private details, invitations, session/CSRF data, audit data, and evidence remain uncached in a shared cache. API responses remain private/no-store at the browser/shared HTTP boundary.
- Approval/revocation/member and goal changes advance the cache version in the same transaction. New requests cannot use a prior revision's scores. The actor's own post-mutation refresh bypasses stale browser state.
- Cloudflare Cache API entries are per-location and may be evicted. Database correctness never depends on cache persistence or global invalidation delivery. Cache errors fall back to the indexed database path.
- Application caching reduces database work; requests that invoke Functions still consume the request allowance.

### 5. Rate limits, indexes, and monitoring

- Preserve login, invitation, submission, review, origin, and CSRF protections. Slower conditional polling already cuts routine rate-counter writes by about two thirds. Do not remove protection solely to save writes.
- Add composite indexes matching pagination/filter/detail/approval lookups, and validate query plans. Avoid redundant indexes because each adds write/storage cost.
- Document where to inspect Workers requests, D1 rows read/written, storage, and errors. Use measured usage with headroom to decide when to upgrade; do not equate one request or submission with one database row operation.
- No automatic paid-plan purchase or claim of unlimited capacity. If the free quota is exhausted, the UI must report the service failure rather than display fabricated success.

## Database rollout and backward compatibility

1. Provide a reviewed, additive, rerunnable migration SQL file for the existing D1 database. It adds summary/version structures, indexes, transactional maintenance, and a one-time existing-record backfill. It does not reset accounts, leads, passwords, or audit records.
2. Keep the fresh-install schema in sync with that migration.
3. Apply and verify the migration on a populated test database first, including an intentional rerun. Verify source record counts and original totals before/after.
4. Preserve the old backend response contract until the optimized schema is ready. Report a clear migration requirement instead of serving truncated data as a complete history. Define the feature/capability switch explicitly during implementation.
5. Supply the owner with the exact one-time D1 console/import step. Remote database access is not assumed; no Cloudflare credentials have been supplied. Verify migration completion before enabling the new path in production.
6. Push tested changes to the existing GitHub repository. Confirm GitHub connectivity and the actual deployed version separately. Existing accounts and unused invitation links continue to work.

## Verification and acceptance

- All current authorization, duplicate prevention, privacy, scoring, invitation, persistence, and concurrency tests still pass.
- Add regression tests before implementing the new behavior: stable paginated navigation, server filtering, old-lead selection, complete filtered exports, and stale-response protection.
- Verify summary updates and rebuild parity for approve/reject/revoke/resubmit, linked revocation, disabled members, and Karachi day/week/month boundaries. Check concurrent reviews and rollback behavior.
- Verify cache keys, authentication before cache access, cross-member evidence privacy, disabled/logout session handling, cache failure fallback, changed/unchanged revisions, and immediate post-approval freshness.
- Test both fresh setup and migration of a populated existing workspace without data loss. Keep the Node demo/local flows working.
- Generate at least 26 weeks of 1,500 leads/week: 39,000 leads plus representative Instagram/DM/reply/call/win activity for ten members. This is generated test data, never real customer data.
- Run the real Cloudflare workerd/D1 integration checks. Measure query rows read/written for hot unchanged refreshes, changed compact refreshes, lead-page navigation, search, submission, and approval. Do not treat SQLite-only timings as Cloudflare CPU evidence.
- Exercise ten concurrent users plus a burst above that level. Report measured results, workload, cache assumptions, and limitations. A successful synthetic test is evidence for that workload, not an uptime guarantee.

## Planning budget, not a guarantee

Ten active members, one tab each, polling once per minute for eight hours create about 4,800 background requests/day, before manual actions and additional tabs. That is roughly 67% fewer background requests than the current 20-second interval. Unchanged refreshes should read only a constant number of authentication/version/rate-limit rows and no contribution-history rows.

At 1,500 new leads/week, storage and activity write growth still need monitoring. The Cloudflare free tier currently includes 100,000 Workers/Functions requests/day, five million D1 rows read/day, 100,000 D1 rows written/day, and a 500 MB limit for an individual free D1 database. All index/trigger/audit work must be included in measured write usage.

References: https://developers.cloudflare.com/pages/functions/pricing/ ; https://developers.cloudflare.com/d1/platform/pricing/ ; https://developers.cloudflare.com/d1/platform/limits/ ; https://developers.cloudflare.com/workers/runtime-apis/cache/
