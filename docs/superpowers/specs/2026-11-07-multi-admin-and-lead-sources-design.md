# Design: Multi-Admin Support & LinkedIn/Facebook Lead Sources

## Intent & Overview
Enable multi-admin management in the workspace and add a dedicated source platform option (LinkedIn, Facebook, Other) with platform-specific link normalization for lead submissions. Additionally, account for the confirmed team size of 4 employees producing ~50 leads/day (200 leads/day total).

## Capacity Confirmation (4 Employees × 50 Leads/Day)
* **Daily volume:** ~200 leads/day (~6,000 leads/month).
* **Cloudflare Free Tier Fit:**
  * Daily D1 row writes: ~10,400 to 18,000 writes/day (out of 100,000 daily allowance, ~10–18%).
  * Daily Worker requests: ~3,000 to 5,000 requests/day (out of 100,000 daily allowance, ~5%).
  * D1 database storage: ~6 to 12 MB/month (out of 500 MB limit; safe for 3+ years).
  * **Result:** 4 employees at 50 leads/day runs completely smoothly on the Cloudflare free tier with zero need for immediate paid upgrades.

## Approaches Considered for Lead Sources
1. **Approach A: Explicit Source Platform Selector (Chosen):**
   * Add a "Source Platform" dropdown (`LinkedIn`, `Facebook`, `Other`) in the "Add a lead" dialog.
   * Tailor placeholders and helper text to the chosen platform.
   * Platform-specific URL normalization:
     * **LinkedIn:** Canonicalizes activity and post URLs, removes tracking parameters.
     * **Facebook:** Cleans desktop/mobile domains (`m.facebook.com`, `web.facebook.com`, `fb.com`), strips tracking queries (`fbclid`, `mibextid`, `rdid`, `ref`), and preserves post IDs.
     * **Other:** Standard safe HTTPS URL validation.
   * Store/derive the platform and display visual badges (`LinkedIn`, `Facebook`, `Other`) in the lead list and detail view.
2. **Approach B: Auto-Detection Only (Rejected):**
   * Keep a single URL input and auto-detect domain.
   * *Trade-off:* Less explicit for teammates; harder to guide proper Facebook post link formats vs profile links.

## Design Details

### 1. Multi-Admin Support
* **Database / Constraints:**
  * Drop single-admin unique index `users_one_admin` from `schema.sql`, `lib/store.mjs`, and provide a migration for existing databases (`DROP INDEX IF EXISTS users_one_admin;`).
  * Update `invites` table constraint to allow `role IN ('admin', 'member')` (previously checked `role = 'member'`).
* **Backend Store (`lib/store.mjs` & `cloudflare/store.mjs`):**
  * `invite()`: Allow creating invites with `role: 'admin'` or `'member'`.
  * `join()`: Assigns the role specified on the invitation.
  * `updateMember()`: Allow changing a user's role between `'admin'` and `'member'`. Guard against demoting or disabling the last remaining active admin to prevent workspace lockout.
  * Remove startup logic that forcibly demotes secondary admins.
  * Permissions check (`admin(user)`): Already checks `user.role === 'admin'`; both admins will now possess full review, member management, invite, and goal-editing capabilities.
* **Frontend UI (`public/app.js`):**
  * In the **Invite member** modal: Add a Role dropdown (`Member` / `Admin`).
  * In the **Manage access** modal: Add a Role dropdown (`Member` / `Admin`) alongside Active status.
  * Update Team view text to reflect multiple admins.

### 2. LinkedIn & Facebook Lead Sources (Approach A)
* **Validation & URL Canonicalization (`lib/rules.mjs`):**
  * `safeURL()` / `facebookURL()` / `platformURL()`:
    * Standardize Facebook URLs: convert `web.facebook.com`, `m.facebook.com`, `mbasic.facebook.com`, `fb.com` to `facebook.com`.
    * Remove tracking parameters (`fbclid`, `mibextid`, `rdid`, `ref`, `__cft__`, `__tn__`, etc.).
    * Disallow non-post/profile-only URLs where appropriate or validate HTTPS.
    * Verify matching platform if selected.
* **Database & Submissions:**
  * Store `platform` in submissions (with fallback to auto-detecting from `url` for existing records so existing records remain 100% valid).
  * Filter/search capability by platform if desired.
* **Frontend UI (`public/app.js`):**
  * In the **Add a lead** modal:
    * Platform selector: `[LinkedIn, Facebook, Other]`.
    * Dynamic placeholder and help text based on selected platform.
  * In the **Lead Pipeline table & detail modal**:
    * Display platform badge/icon (LinkedIn / Facebook / Web) next to the prospect title.
