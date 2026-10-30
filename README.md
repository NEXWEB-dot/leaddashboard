# Leadroom by NEXWEB

A mobile-responsive shared dashboard for a lead-sourcing and outreach team, with a Material-inspired purple sidebar, elevated stat cards, and colored charts following the supplied design reference. A real Node server and SQLite database keep everyone in the same workspace; team records are not stored in browser local storage.

## Scoring

| Contribution | Reward | Required before it counts |
| --- | --- | --- |
| Instagram post or reel | **10 points** | Unique permalink, ownership/campaign context, independent admin approval |
| DM to a lead | **1 point** | Approved lead owned by the sender, reviewer-accessible evidence, independent admin approval |
| Lead submission | **1 approved lead in the lead ranking** | Original source link, requirement, country, service, independent admin approval |

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
3. Open **Team members → Invite member**. Invite a second trusted person as **Admin** so they can review your work. Admins cannot approve their own submissions.
4. Copy the invitation link and share it privately with the invited person. It is bound to their email, valid for 7 days, and usable once. The app does not automatically send email.
5. Add leads, Instagram posts, and DMs. An independent admin reviews the evidence and approves or rejects the claim.

For a visual tour, open **http://127.0.0.1:3000/demo**. This uses explicitly labeled sample people and data, with in-memory browser interactions that reset on refresh. It neither reads nor changes real workspace data. Its sample URLs are illustrative, not verified leads.

The default server binds only to your computer. To give teammates access from other devices, deploy **one shared server** at an HTTPS address. Running a separate local copy on every team member’s computer would create separate databases.

## Included

- Team overview with real statistics, top contributor, activity feed, and 7-day contribution chart.
- Shared lead pipeline with source, country, requirement, owner, review status, pipeline stage, notes, and follow-up date.
- Pipeline stages: New → Contacted → Replied → Won / Lost. Overdue follow-up dates are highlighted.
- Search; review/stage, country, and owner filters; CSV export of the current filtered leads.
- Leaderboard by points or approved leads, for this week, this month, or all time.
- Review queue, rejection reasons, updated evidence and resubmission, and revocation of approved work.
- Email-bound, single-use invitations; individual member accounts; admin roles and account disabling.
- Private DM evidence, visible only to the author and admins.
- Append-only audit trail. The UI shows the latest 200 events; the database preserves the complete history.
- Shared state refresh every 20 seconds while the page is visible and no form is being edited. Form submissions refresh immediately.
- Responsive layouts, labeled forms, keyboard-friendly dialogs, reduced-motion support, and no third-party fonts or tracking scripts.

## Preventing cheating

**Enforced by the server:**

- Scores and ownership are derived from authenticated accounts and approved records. Submitted `points`, `status`, or `userId` values cannot override them.
- The same source URL is accepted once across the team. Query strings and tracking hashes are removed. LinkedIn country subdomains and activity URL aliases are normalized.
- The same Instagram shortcode counts once even when submitted as a post and as a reel. Profiles are not accepted as post evidence.
- Only the lead owner can submit a DM claim. One DM claim is permitted per lead across the workspace. Rejected work is corrected through resubmission, not duplicate claims.
- Only admins may review work, and self-review is blocked even for admins.
- Revoking approval immediately removes its score. Revoking a lead also rejects its associated pending/approved DM claim.
- Submission volume is limited to 100 new claims per user in a rolling 24-hour period; login and request limits also apply.
- Every review, submission, resubmission, pipeline update, invitation, and account access change creates an audit event. Database triggers prevent audit updates/deletes through the application.

**Still requires human judgment:**

- A source URL does not prove the prospect is real, currently hiring, or distinct from a prospect posted elsewhere. Review the actual post and check for the same prospect under another URL.
- An Instagram link does not prove ownership, originality, or publication time. Verify the account and publication date. Reposting low-quality content should not earn points merely because the URL is unique.
- A screenshot or evidence link does not prove a DM was sent. Check recipient, timing, content, and evidence access; conduct occasional direct spot-checks. Do not use public evidence links containing private conversations.
- Trusted reviewers can collude. Limit admin access, periodically inspect the audit trail, and agree on quality criteria. The person controlling the server/database can alter application data outside the app; this is not a tamper-proof external audit service.

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

The tests cover URL aliases and unsafe links, invite binding/expiry/reuse, score tampering, self-review and member permission attacks, review/revocation, duplicate claims, private evidence, immutable audit events, ranking ties, Karachi date boundaries, persistent storage, CSRF/origin checks, protected routes, password changes, and production cookie settings. GitHub Actions runs these checks on pushes and pull requests.

## Good next features

1. **Reply and conversion quality:** report replies, booked calls, and won projects; consider bonuses only with verified outcomes.
2. **Team targets:** weekly goals and progress by person, plus configurable campaigns.
3. **Follow-up reminders:** opt-in email or messaging reminders before the next contact is due.
4. **Prospect identity matching:** flag repeated company domains, email addresses, and contact profiles across different source posts.
5. **Stronger evidence:** private screenshot uploads, reviewer checklists, and random audit sampling.
6. **Larger teams:** managed PostgreSQL, full-text search, pagination, two-factor sign-in, and email-based recovery.

Start with quality criteria and prospect duplicate matching before adding more volume-based rewards.
