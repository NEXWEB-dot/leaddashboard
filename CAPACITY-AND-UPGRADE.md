# Capacity upgrade: existing Cloudflare workspace

This upgrade adds a simpler **My work** home, guided activity forms, paginated lists, indexed search, saved approval totals, conditional refreshes, and revision-keyed private-safe summary caching. It keeps the same accounts, source records, approval rules, and sole admin.

## One-time database upgrade

Use your existing **leadroom** D1 database. Do not create a replacement database or rerun an unrelated reset script.

1. In Cloudflare open **Storage & databases → D1 → leadroom → Console**.
2. Open [cloudflare/migrations/0001-capacity.sql](cloudflare/migrations/0001-capacity.sql) in GitHub, choose **Raw**, and copy the complete SQL.
3. Paste the complete script into the D1 console and execute it. Its comments use `/* ... */` so pasting into a single-line console cannot comment out the whole script.
4. Confirm readiness with:

```sql
SELECT ready, revision FROM workspace_meta WHERE id = 1;
```

`ready` must be `1`. Optionally check parity:

```sql
SELECT kind, COUNT(*) AS approved_records
FROM submissions WHERE status = 'approved' GROUP BY kind;
SELECT kind, SUM(count) AS saved_total
FROM summary_counts WHERE bucket = 'all' GROUP BY kind;
```

For every kind, these totals must agree. A missing summary row means zero.

5. Deploy the updated `main` branch through the **existing** Pages project, then refresh the browser. If code was deployed first, apply the SQL and refresh afterward.

The script is additive and rerunnable. It adds counters, indexes, search structures, and revision triggers. It does not delete accounts, leads, invitations, or audit history. The search/counter backfill happens atomically during the readiness transition, so live edits before that transition are included. A failed import leaves optimized mode unavailable until the remaining SQL succeeds. Re-run the complete migration if needed.

Until the migration is ready, the app deliberately keeps the legacy complete-data path. **The new caching/pagination path is enabled only after the migration and a browser refresh.** Do not treat deployment alone as completion of this database upgrade.

For the CLI, from this repository after signing into your Cloudflare account:

```text
npx wrangler d1 execute leadroom --remote --file=cloudflare/migrations/0001-capacity.sql
```

Fresh installations already include the upgrade in `cloudflare/schema.sql`.

## What the team will notice

- Home focuses on **My work and next steps**, with personal approved totals, a clear Add lead button, simple contribution forms, recent status, and weekly progress.
- Team leaderboard, goals, and admin review tools remain available. Members see **My activity** for their own submissions; the owner sees **Reviews**.
- Lead/review lists load 50 records at a time. Search can find older records; the approved-lead selector searches and pages through the member's own eligible leads, including leads with identical titles. It also links to the selected original source.
- CSV export deliberately reads every matching page, not only the visible 50 rows. Duplicate export clicks are ignored while one is running; throttled read pages wait for the next rate window and resume without discarding completed pages.
- Active dashboards check for changes about once a minute. Your own successful changes refresh immediately. Idle/hidden tabs pause; returning to the tab resumes checks. Errors show stale/offline status and back off without retrying submissions automatically.
- A slow or failed request preserves the visible work. An unsent form remains in its dialog after a submission error. Expired sign-in sessions still require signing in again.

## Why this uses fewer resources

- Unchanged dashboard requests authenticate and compare the revision, then return `304` without reading contribution history.
- Approved totals are maintained transactionally in small time buckets. Approving, revoking, and cascading linked revocations update the saved totals in the same database transaction.
- Common caches contain sanitized totals and member summaries only. Evidence, invitation tokens, session/CSRF values, private details, and audit responses are not shared in those caches. Every API response still authenticates the current session; HTTP responses remain `no-store`.
- Cache keys include a database-specific namespace, workspace origin, revision, and Karachi day. Cache eviction/outage falls back to bounded database queries.
- Fingerprinted JS/CSS/icons can stay in the browser/CDN cache for a year; HTML entry points revalidate. A new deployment changes asset names.
- Login/submission/rate-limit protections remain. Ordinary requests still update the rate-limit counter; fewer polls reduce those writes rather than silently dropping protection.

## Verified synthetic workload

Run `npm run check:pages` followed by `npm run test:capacity` to reproduce. The test uses a local Cloudflare workerd runtime and D1, with a test-only database wrapper recording real D1 row metadata. It never accesses production data or credentials.

The 2026-11-03 run used **10 members, 26 weeks × 1,500 leads = 39,000 leads, and 63,700 total contributions**. It also verified a 30-request concurrent burst, exact all-time counter parity after approval/revocation, and a complete export of all 39,000 unique leads.

| Operation | Database rows read | Database rows written |
| --- | ---: | ---: |
| Cold admin dashboard | 451 | 3 |
| Dashboard with shared summary cache | 89 | 3 |
| Unchanged conditional refresh, ten concurrent members | At most 6 | At most 1 |
| First 50-lead page | 56 | 1 |
| Specific indexed lead search | 20 | 1 |
| Empty/rare country, stage, and ownership filter combinations | 5 | 1 |
| Submit a new test lead | 67 | 30 |
| Approve that test lead | 29 | 22 |
| Submit test Instagram post | 68 | 19 |
| Approve test Instagram post | 30 | 18 |

Counts include authentication, revision and request-rate-limit work. First writes/index changes and opportunistic cleanup affect exact counts. Database row counts are more transferable than local elapsed times; this is **not a production latency, CPU-budget, uptime, or unlimited-capacity guarantee**. Broad searches, many matching teammate names, exports, migration, and counter rebuilding can read more rows than the specific indexed-search example.

Ten active members with one tab each checking once per minute for eight hours produce approximately **4,800 background requests/day**, around 67% fewer than the old 20-second interval. The synthetic unchanged path would read at most about 28,800 rows for those checks, plus manual work. Even cold refreshes use bounded current-period summary rows rather than historical contribution rows. Additional tabs, users, actions, and other applications in the account also consume quota.

## Monitor the free tier

In D1 open **Metrics → Row Metrics** to check rows read/written; also inspect database storage. In Workers & Pages inspect request and error metrics. Watch several normal workdays after rollout rather than relying only on a synthetic test.

Current free limits: 100,000 Workers/Functions requests/day, 5 million D1 rows read/day, 100,000 D1 rows written/day, and 500 MB for an individual free database. Trigger, search-index, normal-index, and audit writes all count. Limits are shared with the account's other usage. Plan for headroom; investigate sustained usage around 70% of an allowance before it becomes a workday outage.

The free tier can refuse requests/database operations once limits are reached. Caching cannot remove that service limit. No paid plan or extra service has been purchased by this upgrade.

## Repair derived totals if ever needed

Source submissions and audit records are authoritative. First run the two parity queries above. For a deliberate derived-data rebuild, execute these two statements, in order:

```sql
UPDATE workspace_meta SET ready = 0 WHERE id = 1;
UPDATE workspace_meta SET ready = 1 WHERE id = 1;
```

The second statement atomically rebuilds derived counters and the search index from current submissions and advances the revision. Other mutations remain stored; optimized reads are temporarily unavailable while `ready` is zero. Use this deliberately, not as a recurring background job.

## Deployment checks

- Keep the existing Pages project, `DB` binding, `SETUP_TOKEN`, and `ADMIN_EMAIL`.
- Build command remains `npm run build:pages`; output remains `dist`; Node remains 24.
- Reconnect GitHub if Cloudflare shows its disconnected-account warning.
- Confirm that the production deployment references the new Git commit. Retrying a historical deployment may rebuild that older commit.
- Open the normal website URL, sign in, and check **Leads** for Previous/Next controls. The `/demo/` URL remains sample data and does not exercise your production D1 workspace.

References: [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), [D1 pricing and metrics](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [supported full-text search](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
