# Connect Leadroom to Cloudflare Pages

**Existing workspace?** The capacity upgrade needs a one-time additive database migration. Follow [CAPACITY-AND-UPGRADE.md](CAPACITY-AND-UPGRADE.md) before expecting optimized caching and paginated data loading. Existing accounts and leads are retained.

After this one-time setup, open the Cloudflare website link from any device. Your computer can be off, and you do not need to run `npm start`.

## 1. Connect this repository

In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git**. Choose **NEXWEB-dot/leaddashboard** and the **main** branch. Choose the **Pages** flow, rather than creating a plain Worker.

Use these build settings:

| Setting | Value |
| --- | --- |
| Framework preset | **None** |
| Build command | **`npm run build:pages`** |
| Build output directory | **`dist`** |
| Root directory | Leave blank (repository root) |
| Production branch | **`main`** |
| Build environment variable | **`NODE_VERSION` = `24`** |

Cloudflare installs dependencies and bundles the `functions/` backend automatically. Do not set the build command to `npm start`. Do not upload just the `public` folder: the API is required for team accounts and shared records.

## 2. Create the shared database

1. In Cloudflare, open **Storage & databases → D1** and create a database named **leadroom**.
2. Initialize that **new empty database** with [cloudflare/schema.sql](cloudflare/schema.sql). In the database's **Console**, run the statements from that file. The schema creates tables, indexes, and audit protections; it contains no passwords or sample people. Run the complete file, including the audit triggers.
3. Return to your **Pages project → Settings → Bindings → Add → D1 database**.
4. Enter **`DB`** as the variable/binding name and choose the **leadroom** database.

If you prefer importing the SQL file through the official CLI, after signing into your own Cloudflare account, run this once from the repository directory:

```text
npx wrangler d1 execute leadroom --remote --file=cloudflare/schema.sql
```

Use a separate D1 database for preview deployments. Keep the production database bound only to production. Future updates reuse the same production database so leads and accounts survive deployments.

## 3. Add your private setup code

In **Pages project → Settings → Variables and Secrets**, add these values for **Production**:

| Name | Type | Value |
| --- | --- | --- |
| `SETUP_TOKEN` | **Secret / encrypted** | Your own long random code, at least **24 characters**. Keep it private. |
| `ADMIN_EMAIL` | Text, optional | Your email address. If set, first setup accepts only this email. |
| `NODE_VERSION` | Text | `24` |

Do not paste the setup code into GitHub, source files, screenshots, or team messages. It is needed only to create your admin account. `APP_ORIGIN` is optional: if you set it, use the exact production HTTPS origin without a trailing slash; otherwise the backend uses the current website origin.

**Redeploy after adding the database binding and secrets.** Cloudflare applies them to the new deployment.

## 4. Open the website and create your account

Open the **actual `pages.dev` URL Cloudflare gives your project**, without `/demo`.

1. Enter your name, email, a unique password of at least 12 characters, and your private setup code.
2. Create the workspace. You become its **only admin**. Setup closes after the first account exists.
3. Open **Team members → Invite member**, then privately share each email-bound invitation link.
4. Share the normal website URL for future sign-ins. Your teammates submit claims; you approve them. Goals, scores, and reviews are shared through D1.

`/demo` remains a separate sample-data tour and is never your live team workspace. Your local SQLite database and its accounts are separate from D1; existing real local records are not uploaded or converted automatically.

Add the deployed website URL to your GitHub repository's **About → Website** field or README so visitors can click straight into the dashboard. The repository URL itself still opens GitHub's code view.

## Troubleshooting

| Message / symptom | Fix |
| --- | --- |
| D1 binding `DB` is missing | Add the D1 binding with exactly that name and redeploy. |
| Initialize D1 using `cloudflare/schema.sql` | Run the complete schema against the database selected by the binding. |
| Add a private `SETUP_TOKEN` | Add it as a production secret, at least 24 characters, and redeploy. |
| Incorrect setup code | Use the exact secret you saved in Cloudflare; this is different from your sign-in password. |
| Workspace owner email does not match | Use the email in `ADMIN_EMAIL`, or correct that variable before first setup. |
| JSON/login error after a static deployment | Use the Git-integrated Pages deployment so `functions/` is compiled, with `dist` as the output. |
| Works on Pages but fails on a custom domain | If `APP_ORIGIN` is set, update it to that exact domain and redeploy. |
| You see fictional sample people | Remove `/demo` from the URL and sign in to your real workspace. |

Cloudflare account setup, service quotas, and billing remain under your account. No service has been provisioned, purchased, or connected by preparing this repository.

References: [Cloudflare Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [D1 bindings for Pages](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases), [D1 getting started](https://developers.cloudflare.com/d1/get-started/).
