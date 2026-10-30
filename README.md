# Leadroom by NEXWEB

A mobile-responsive shared dashboard for a lead-sourcing and outreach team, with a Material-inspired purple sidebar, elevated stat cards, and colored charts following the supplied design reference. A real Node server and SQLite database keep everyone in the same workspace; team records are not stored in browser local storage.

## Scoring

| Contribution | Reward | Required before it counts |
| --- | --- | --- |
| Instagram post or reel | **10 points** | Unique permalink, ownership/campaign context, workspace owner approval |
| DM to a lead | **1 point** | Approved lead owned by the sender, reviewer-accessible evidence, workspace owner approval |
| Verified client reply | **5 bonus points** | Approved lead owned by the claimant, genuine response evidence, owner approval |
| Confirmed booked call | **20 bonus points** | Approved lead owned by the claimant, confirmed booking evidence, owner approval |
| Client won | **50 bonus points** | Approved lead owned by the claimant, accepted project/agreement evidence, owner approval |
| Lead submission | **1 approved lead in the lead ranking** | Original source link, requirement, country, service, workspace owner approval |

Lead submissions do **not** award points. The leaderboard switches between **By points** and **By leads**, with visible numeric ranks 1, 2, 3, and onward. Pending or rejected work never earns a score. Approvals count in the period when approved. Week/month boundaries use **Asia/Karachi**, with weeks starting Monday. The alternate metric breaks the first tie; identical totals share a competition rank (for example 1, 1, 3).

## Run locally

Requires **Node.js 24 or newer**. There are no third-party runtime packages or installation step.

```powershell
git clone https://github.com/NEXWEB-dot/leaddashboard.git
cd leaddashboard
npm start
```

1. Open **http://127.0.0.1:3000**.
2. On first run, use the **private one-time setup code printed in your terminal** to create the first admin. Choose your own name, email, and a unique password of at least 12 characters. Do not share the setup code. Setup is disabled permanently after an account exists.
3. You are the **only admin**. Open **Team members → Invite member** to invite teammates as members. Admin invitations and member promotions are blocked by the server.
4. Copy the invitation link and share it privately with the invited person. It is bound to their email, valid for 7 days, and usable once. The app does not automatically send email.
5. Add leads, Instagram posts, DMs, and client outcomes. Only you can approve, reject, or revoke claims. You may review your own contributions; the audit trail explicitly marks owner self-reviews.

For a visual tour, open **http://127.0.0.1:3000/demo**. This uses explicitly labeled sample people and data, with in-memory browser interactions that reset on refresh. It neither reads nor changes real workspace data. Its sample URLs are illustrative, not verified leads.

The default server binds only to your computer. To give teammates access from other devices, deploy **one shared server** at an HTTPS address. Running a separate local copy on every team member’s computer would create separate databases.

## Included

- Team overview with real statistics, top contributor, activity feed, and 7-day contribution chart.
- Shared lead pipeline with source, country, requirement, owner, review status, pipeline stage, notes, and follow-up date.
- Pipeline stages: New → Contacted → Replied → Call booked → Won / Lost. Overdue follow-up dates are highlighted.
- Search; review/stage, country, and owner filters; CSV export of the current filtered leads.
- Leaderboard by points or approved leads, for this week, this month, or all time.
- Review queue, rejection reasons, updated evidence and resubmission, and revocation of approved work.
- Email-bound, single-use member invitations; individual accounts; one permanent owner/admin; member account disabling.
- Private DM and client-outcome evidence, visible only to the author and workspace owner.
- Append-only audit trail. The UI shows the latest 200 events; the database preserves the complete history.
- Shared state refresh every 20 seconds while the page is visible and no form is being edited. Form submissions refresh immediately.
- Responsive layouts, labeled forms, keyboard-friendly dialogs, reduced-motion support, and no third-party fonts or tracking scripts.

## Preventing cheating

**Enforced by the server:**

- Scores and ownership are derived from authenticated accounts and approved records. Submitted `points`, `status`, or `userId` values cannot override them.
- The same source URL is accepted once across the team. Query strings and tracking hashes are removed. LinkedIn country subdomains and activity URL aliases are normalized.
- The same Instagram shortcode counts once even when submitted as a post and as a reel. Profiles are not accepted as post evidence.
- Only the lead owner can submit a DM claim. One DM claim is permitted per lead across the workspace. Rejected work is corrected through resubmission, not duplicate claims.
- Only the sole workspace owner can review work, invite people, change member access, or set goals. Owner self-reviews are allowed and explicitly marked in the audit trail. A database constraint also prevents a second admin account.
- Revoking approval immediately removes its score. Revoking a lead also rejects its associated pending/approved DM claim.
- Submission volume is limited to 100 new claims per user in a rolling 24-hour period; login and request limits also apply.
- Every review, submission, resubmission, pipeline update, invitation, and account access change creates an audit event. Database triggers prevent audit updates/deletes through the application.

**Still requires human judgment:**

- A source URL does not prove the prospect is real, currently hiring, or distinct from a prospect posted elsewhere. Review the actual post and check for the same prospect under another URL.
- An Instagram link does not prove ownership, originality, or publication time. Verify the account and publication date. Reposting low-quality content should not earn points merely because the URL is unique.
- A screenshot or evidence link does not prove a DM was sent. Check recipient, timing, content, and evidence access; conduct occasional direct spot-checks. Do not use public evidence links containing private conversations.
- The sole owner is responsible for review quality, including their own submissions. Periodically inspect the audit trail and agree on quality criteria. The person controlling the server/database can alter application data outside the app; this is not a tamper-proof external audit service.

## Motivation features

Open **Goals & wins** for:

- Weekly personal progress bars for approved leads, Instagram posts, verified DMs, client replies, calls, wins, and points.
- A shared team points target and a celebration when it is reached.
- Everyone’s weekly progress and lifetime achievement badges, so the team can recognize useful work beyond first place.
- A feed of approved client replies, booked calls, and client wins from the current week.
- **Edit goals**, visible only to you as the owner. Default personal targets are 10 leads, 3 posts, 10 DMs, 2 replies, 1 call, 1 win, and 100 points; the default shared target is 400 points. Changes take effect immediately for the current week; points are not edited by target changes.

Weekly progress resets each Monday at 00:00 in Asia/Karachi. Previous work remains in the database and in month/all-time rankings. Lifetime badges do not reset with the week, but they update if the underlying approvals are revoked.

Choose **Log a win** on Goals & wins, or the outcome shortcut in Add activity. Select an approved lead you own, the outcome, a private evidence URL, and enough context for the owner to verify it. Each reply/call/win milestone can count **once per lead**, not once per message or meeting. Pending claims do not award points. Pipeline stage edits alone never earn bonuses. Revoking the lead rejects all its pending/approved linked DM and outcome claims and removes the associated points and achievements.

Badges: First lead (1 lead), Lead scout (10 leads), Brand builder (3 posts), Outreach pro (10 DMs), Conversation starter (3 replies), Meeting maker (1 booked call), and Client closer (1 client win). Badges do not add further points.

New outcome records are stored separately from the original submissions table, preserving existing leads and their identifiers. On upgrading an older database, the original admin retains ownership, extra admins become members and have their sessions revoked, and unused admin invitations become member-only invitations. These policy changes are recorded in the audit trail.

## Hosting for your team

This is a server-backed app. **GitHub stores its source; GitHub Pages cannot run its Node server or shared database.** No public hosted deployment is configured automatically.

Use a Node 24 host with HTTPS and a **persistent local disk**. Set:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
APP_ORIGIN=https://your-exact-dashboard-domain.example
DATA_DIR=/path/to/persistent/data
```

`APP_ORIGIN` must match the browser’s HTTPS origin exactly, without a trailing slash. Configure these values in the host’s private environment settings, not source code. A long private `SETUP_TOKEN` may be set before the first run; otherwise the server generates one and prints it in the private server log. Production startup refuses a missing or non-HTTPS origin. Sessions use Secure, HttpOnly, SameSite=Strict cookies. Terminate HTTPS at your reverse proxy, and expose the internal Node port only to that proxy.

Deploy a **single application instance** with its persistent SQLite disk. Ephemeral/serverless filesystems, multiple replicas, and network-mounted SQLite storage are not supported by this version. Mount the data directory so deployments and restarts retain the database. Never commit it to GitHub. Do not expose the database or `.env` as static files. The static server only serves an explicit file allowlist.

### Docker

```text
docker build -t nexweb-leadroom .
docker volume create leadroom-data
docker run -d --name leadroom --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file .env.production -v leadroom-data:/app/data nexweb-leadroom
```

Put the required environment values above into a **private** `.env.production` file; it is excluded from Git and Docker build context. Keep `DATA_DIR=/app/data` when using the Docker volume. Place the server behind an HTTPS reverse proxy. No service subscription or paid hosting resource is created by this repository.

### Backups and recovery

Back up the persistent data directory using a provider snapshot or SQLite-aware backup. For a plain file copy, stop the server cleanly first, then copy the complete `data` directory and restart. SQLite uses WAL files while running, so copying only the live `leads.sqlite` file is unsafe. Store backups privately and test a restore. There is no email-based password recovery yet; existing members can change their password from the key icon. A server operator can use the offline recovery tool below if an account owner loses access.

```powershell
# Stop the app first. Enter the new password privately at the prompt.
node --env-file-if-exists=.env scripts/reset-password.mjs member@example.com
```

The operator must verify the account owner's identity before recovery. Recovery revokes all of that account's sessions and appends an audit event. It does not print or save the new password in a source file.

## Checks

```text
npm run check
npm test
```

The tests cover URL aliases and unsafe links, invite binding/expiry/reuse, score tampering, owner self-review auditing, single-admin enforcement and legacy migration, client outcome rewards, private evidence, persistent weekly goals, and member permission attacks, review/revocation, duplicate claims, private evidence, immutable audit events, ranking ties, Karachi date boundaries, persistent storage, CSRF/origin checks, protected routes, password changes, and production cookie settings. GitHub Actions runs these checks on pushes and pull requests.

## Good next features

1. **Campaigns and workload:** per-campaign targets, balanced lead assignments, and individual target overrides.
2. **Quality trends:** compare reply and conversion rates over time with weekly summaries.
3. **Follow-up reminders:** opt-in email or messaging reminders before the next contact is due.
4. **Prospect identity matching:** flag repeated company domains, email addresses, and contact profiles across different source posts.
5. **Stronger evidence:** private screenshot uploads, reviewer checklists, and random audit sampling.
6. **Larger teams:** managed PostgreSQL, full-text search, pagination, two-factor sign-in, and email-based recovery.

Start with quality criteria and prospect duplicate matching before adding more volume-based rewards.
