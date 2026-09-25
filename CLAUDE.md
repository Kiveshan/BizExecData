# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Server-rendered Node/Express (ES modules) + EJS app. A business connects one accounting source (QuickBooks Online, Xero, Sage Business Cloud, or an Excel/TXT upload), and monthly P&L reports get normalised into PostgreSQL (via Prisma 7) and shown on per-provider dashboards. README.md has the detailed design notes.

## Commands

```bash
npm run dev                 # nodemon server.js (PORT, default 3000)
npm start                   # node server.js
npm run lint                # eslint src/ server.js
npm test                    # Jest via --experimental-vm-modules (ESM, no transform)
npm test -- src/__tests__/modules/xero/extractor.test.js   # single file
npm test -- -t "reconcile"  # single test by name
npx prisma generate         # required before tests/lint/run; client output is src/generated/prisma (gitignored)
npx prisma migrate dev      # local migrations
```

CI runs on PRs (`.github/workflows/ci.yml`): `npm ci`, `prisma generate`, lint, tests, `terraform fmt -check -recursive infra` plus `terraform validate`, and an arm64 Docker build. Run `terraform fmt` after editing anything in `infra/`.

## Architecture

- **Entry:** `server.js` mounts every feature router at `/`, so route paths must be unique across modules. `src/app.js` builds the Express app: `/health` (registered before logging and sessions on purpose), helmet CSP, CORS, the login rate limiter, sessions, passport, and file upload.
- **Feature modules** live in `src/modules/<name>/` (`auth`, `user`, `admin`, `quickbooks`, `xero`, `sage`, `excel`). Each has `routes.js` plus a controller, extractor, or client. The dashboard JSON endpoints are `/api/*` routes inside each module (QuickBooks's are in `user/routes.js`) and are guarded by `requireApiAuth`. That guard matters: the handlers filter by `req.session.userid`, and Prisma drops an `undefined` filter, so without it a request would return every user's rows.
- **Per-provider tables, same column shape.** QuickBooks uses `company_calcs`/`revenue`/`expenses`/`costofsales`; Xero and Sage use the `xero_*`/`sage_*` tables; Excel uses `excel_companydata`. Line rows are `{userid, category, amount, date}`, and each month gets a calc row with `grossprofit, opexpenses, netprofit, sumofsales, sumofcost`. A schema change usually has to be repeated for each provider.
- **Auth differs per provider:**
  - **QuickBooks:** tokens are stored in the DB (`quickbooks_oauth_token`). Every call goes through `makeQuickBooksApiCall` in `quickbooks/client.js`, which refreshes the token and retries. On `invalid_grant` it raises `QB_RECONNECT_REQUIRED`.
  - **Xero:** tokens are held on the session.
  - **Sage:** HTTP Basic, with the password AES-encrypted on the session. `ENCRYPTION_KEY` must be exactly 32 bytes.
- **Provider clients must be created per request.** Never use a module-level singleton for them: that caused a cross-tenant data leak once. Background extraction jobs receive the token and tenant captured from the session that started them.
- **Extraction** starts with `POST /start-*-extraction` and runs in the background. Progress is kept in an in-memory `extractionStatus` map, and the loading page polls `check-*-extraction`. On first connect it pulls 3 years, on refresh 1 year, month by month in series, and only writes rows that changed.
- **DB connection:** `src/config/databaseUrl.js` uses `DATABASE_URL` locally. On ECS it builds the URL from `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`. `prisma.config.ts` imports the same function. `src/config/prismaClient.js` owns the `pg` pool, which is shared with the `connect-pg-simple` session store (`session` table, created by a migration). Under `NODE_ENV=test` sessions use the memory store, so tests need no database.
- **Roles** (seeded by migration): 1 `business_manager`, 2 `business_owner`, 3 `system_administrator`, 4 `Excel`. New registrations get roleid 4. Admin routes use `checkAdmin` in `middleware/auth.js`, which checks roleid 3. `middleware/admin.js`'s `isAdmin` (roleid 10) is unused. A user can log in only when `user_table.status = 'approved'` **and** their `license_management.status = 'Paid'`. No admin is seeded, so locally you have to set those fields in the DB yourself.
- **Views:**
  - Most dashboards are `views/<page>.ejs`, which pulls in the `views/pages/<page>-head.ejs` and `-body.ejs` fragments.
  - Navbars and sidebars are per provider, in `views/partials/`.
  - Sage pages are standalone (`views/sage_*.ejs`).
  - `views/partials/dashboard_filters.ejs` keeps Year/Month/trend filters in sessionStorage and is included by every dashboard body.
  - `public/_legacy_html/` is unused. Charts are drawn client-side with Chart.js and D3.
- **Logging:** use `createModuleLogger("<module>")` from `src/utils/logger.js` (Pino).

## Tests

Tests are in `src/__tests__/**`. The main ones check the four P&L normalisers against recorded provider fixtures (`src/__tests__/fixtures/`). The Excel tests use the committed `uploads/IS1.xlsx` as their fixture, even though `uploads/` is gitignored. Where a report has line items and totals, the tests assert that the line items add up to the total. Route handlers, token refresh, and Prisma upserts are not tested.

## Deployment (AWS ECS Fargate, af-south-1)

- **Pipeline:** a push to `main` runs `.github/workflows/deploy.yml`: tests, then one arm64 image pushed to ECR, then staging (migrations run as a one-off task, then a rolling update, then a `/health` smoke test), then a manual approval, then production with the same image.
- **Deploy script:** `scripts/ecs-deploy.sh <staging|production> <image> [--bootstrap]` does the deploy. Each new task-definition revision is copied from the latest one with only the image swapped, so Terraform-managed env and secret changes take effect on the next deploy.
- **Migrations** run as the RDS master user through the `*-migrate` task definition (`npx prisma migrate deploy`). The app's DB roles can read and write data but cannot change the schema, so a migration must never depend on the app's credentials. `scripts/db-bootstrap.js` creates the database and app role and is idempotent.
- **Infrastructure:** Terraform in `infra/`; see `infra/README.md` for the secrets layout and for debugging live tasks. Integration secrets (`bizexec/<env>/integrations`) are managed by hand, never in Terraform.
- Production changes go one at a time: show the plan and get explicit approval before applying anything.
