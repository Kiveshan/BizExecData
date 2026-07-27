# BizExecData

A server-rendered Node/Express application that lets a business connect one accounting data source — QuickBooks Online, Xero, Sage Business Cloud, or a manual Excel/CSV upload — and turns its monthly profit-and-loss reports into a comparable time series stored in PostgreSQL. Each source has a different authentication model and a structurally different report API, so the core of the system is an extraction layer that normalises four dissimilar shapes into a common `{category, amount, date}` row plus a monthly `{grossprofit, opexpenses, netprofit, sumofsales, sumofcost}` calc, then renders per-provider dashboards from those rows.

## Architecture

```mermaid
flowchart TD
    subgraph BROWSER["Browser"]
        DASH["Per-provider dashboards<br/>EJS · Chart.js · D3"]
        LOAD["Loading page"]
    end

    subgraph APP["Express application — server.js · src/app.js"]
        ROUTES["Route modules<br/>auth · user · admin<br/>quickbooks · xero · sage · excel"]
        API["JSON endpoints<br/>api/*"]
    end

    subgraph AUTH["Credential handling — one model per provider"]
        QBAUTH["QuickBooks<br/>OAuth2 · tokens in DB<br/>refresh at expiry minus 60s"]
        XAUTH["Xero<br/>OAuth2 · tokenSet in session<br/>SDK-managed refresh"]
        SAUTH["Sage<br/>HTTP Basic<br/>AES-256-CBC creds in session"]
    end

    subgraph SOURCES["Data sources"]
        QBO["QuickBooks Online<br/>ProfitAndLoss · Detail"]
        XEROAPI["Xero Accounting<br/>getReportProfitAndLoss"]
        SAGEAPI["Sage Accounting<br/>ProfitAndLoss/Get"]
        XLS["Excel / TXT upload<br/>fixed template"]
    end

    subgraph PIPE["Extraction pipeline"]
        EXTRACT["Per-provider extractor<br/>sequential, month by month"]
        NORM["Normaliser<br/>category · amount · date<br/>plus monthly calcs"]
        PROG["extractionStatus<br/>in-memory progress map"]
    end

    DB[("PostgreSQL<br/>per-provider tables<br/>Prisma + pg adapter")]

    DASH -->|connect / extract| ROUTES
    DASH -->|read| API

    ROUTES --> QBAUTH --> QBO
    ROUTES --> XAUTH --> XEROAPI
    ROUTES --> SAUTH --> SAGEAPI
    ROUTES --> XLS

    QBO --> EXTRACT
    XEROAPI --> EXTRACT
    SAGEAPI --> EXTRACT
    XLS --> EXTRACT

    EXTRACT --> NORM --> DB
    EXTRACT -.-> PROG
    LOAD -.poll.-> PROG
    API --> DB

    classDef browser fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    classDef app fill:#ede9fe,stroke:#7c3aed,color:#3b0764
    classDef auth fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef source fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef pipe fill:#e0e7ff,stroke:#4f46e5,color:#312e81
    classDef store fill:#ffe4e6,stroke:#e11d48,color:#881337

    class DASH,LOAD browser
    class ROUTES,API app
    class QBAUTH,XAUTH,SAUTH auth
    class QBO,XEROAPI,SAGEAPI,XLS source
    class EXTRACT,NORM,PROG pipe
    class DB store

    style BROWSER fill:#f8fafc,stroke:#94a3b8,color:#334155
    style APP fill:#f8fafc,stroke:#94a3b8,color:#334155
    style AUTH fill:#f8fafc,stroke:#94a3b8,color:#334155
    style SOURCES fill:#f8fafc,stroke:#94a3b8,color:#334155
    style PIPE fill:#f8fafc,stroke:#94a3b8,color:#334155
```

### QuickBooks token lifecycle

The most involved auth path. Every provider call routes through `makeQuickBooksApiCall`, which refreshes proactively, rotates the stored token, and distinguishes a dead grant from a transient failure ([client.js](src/modules/quickbooks/client.js)):

```mermaid
sequenceDiagram
    autonumber
    participant EX as Extractor
    participant CL as makeQuickBooksApiCall
    participant DB as quickbooks_oauth_token
    participant QB as Intuit API

    EX->>CL: request P&L report
    CL->>DB: load token row
    alt no stored token
        CL-->>EX: QB_RECONNECT_REQUIRED
    end

    Note over CL: refresh if within 60s of expires_at
    opt refresh needed
        CL->>QB: oauthClient.refresh()
        QB-->>CL: rotated access + refresh token
        CL->>DB: upsert rotated token
    end

    CL->>QB: makeApiCall
    alt success
        QB-->>CL: report JSON + intuit_tid header
        CL-->>EX: response
    else invalid_grant
        CL->>DB: delete token row
        CL-->>EX: QB_RECONNECT_REQUIRED
    else transient error
        CL->>CL: refresh, then retry once
        CL->>QB: makeApiCall
        QB-->>CL: response
        CL-->>EX: response
    end
```

## Tech stack

| Technology | Why it's here |
|---|---|
| Node.js (ES modules) + Express 4 | HTTP server and routing; modules are split by feature under `src/modules/*`. |
| PostgreSQL | Relational store; financial data is naturally tabular and time-indexed. |
| Prisma 7 + `@prisma/adapter-pg` | Typed DB access over an explicit `pg` connection pool, so SSL and pooling are controlled directly. |
| Passport (local strategy) + bcrypt | Email/password auth for Excel/manual users; bcrypt for password hashing. |
| `intuit-oauth` | QuickBooks OAuth2 client — handles the authorize/token/refresh exchange. |
| `xero-node` | Xero OAuth2 + Accounting API SDK, including consent URL and report calls. |
| `node-fetch` | Plain HTTP for the Sage REST API (Basic auth), which has no first-party SDK here. |
| `jsonpath` | Extracts values from the deeply nested, differently-shaped P&L JSON of each provider. |
| `xlsx` (SheetJS) | Parses uploaded income-statement workbooks by cell position. |
| `express-session` | Server-side sessions; also the store for Xero tokens and encrypted Sage credentials. |
| `express-rate-limit` | Limits login attempts (5 per 15 min) on `POST /login`. |
| `helmet` | Security headers and a Content-Security-Policy. |
| Node `crypto` (AES-256-CBC) | Encrypts the Sage password before it is held in the session. |
| Chart.js + D3 | Client-side charts on the dashboards. |
| EJS | Server-rendered views and partials per provider. |
| Pino | Structured, per-module logging. |
| Jest + Supertest | Tests for the app boot path and auth middleware. |

## Key technical decisions

### 1. Three authentication models with different credential lifetimes
The brief expected "OAuth across three providers," but the code reflects what each provider actually offers, and the three are handled deliberately differently:

- **QuickBooks — OAuth2 with DB-persisted tokens and explicit refresh.** Access and refresh tokens are stored per user in the `quickbooks_oauth_token` table with an `expires_at`. Every API call goes through `makeQuickBooksApiCall`, which refreshes the token when it is within 60 seconds of expiry ([client.js](src/modules/quickbooks/client.js)), writes the rotated token back, and retries once on failure. An `invalid_grant` response is treated specially: the stored token is deleted and a `QB_RECONNECT_REQUIRED` error bubbles up so routes can redirect the user back into the consent flow.
- **Xero — OAuth2 with session-held tokens.** The `xero-node` client requests `offline_access` and the token set is stored on the session (`req.session.tokenSet`); refresh is delegated to the SDK rather than tracked against an `expires_at` of our own.
- **Sage — HTTP Basic auth, not OAuth.** Sage's reseller API authenticates with the user's username/password on each request. The password is encrypted with AES-256-CBC and stored on the session ([sage/routes.js](src/modules/sage/routes.js)), then decrypted at extraction time ([sage/controller.js](src/modules/sage/controller.js)) to build the `Authorization` header.

Keeping these separate — rather than forcing a single token abstraction — is what lets each provider use its native auth without pretending Sage is something it isn't.

### 2. Normalising three structurally different report APIs into one shape
There is no single source-agnostic table; instead each provider writes to its own tables (`company_calcs`/`revenue`/`expenses`/`costofsales`, `xero_*`, `sage_*`, `excel_companydata`) that share an identical **column shape**. The interesting work is in the per-provider extractors that converge on that shape from very different inputs:

- **QuickBooks** returns an arbitrarily nested `Rows.Row` tree. A recursive walker (`findFinancialData`) descends `ColData`/`Rows`/`Header`, and `jsonpath` filters select line items by `group` (`Income`, `COGS`, `Expenses`, `OtherIncome`). Monthly totals are pulled from `Summary.ColData[6]` of the `ProfitAndLossDetail` report.
- **Xero** returns report rows tagged by `rowType`; `jsonpath` selects `SummaryRow` cells by label (`Total Income`, `Total Operating Expenses`, `Gross Profit`, etc.) and line rows under titled sections.
- **Sage** returns a tree keyed by `Description`; `jsonpath` selects `Sales`/`Expenses`/`Cost of Sales` children and reads totals from rows where `ReportingLevelType == 10`.

All three funnel into the same `{userid, category, amount, date}` line rows and the same five-field monthly calc, so a dashboard query is identical regardless of source. The tradeoff — parallel per-provider tables instead of one unified table with a `source` column — keeps each provider's quirks isolated at the cost of duplicated table definitions.

### 3. Excel/manual upload as a first-class fallback
For businesses not on a supported cloud platform, an income-statement workbook (template in `uploads/`) can be uploaded directly. The parser ([excel/controller.js](src/modules/excel/controller.js)) is built around the template's conventions rather than a fixed row list:

- The report date is read from cell **F3** (handling both native dates and Excel serial numbers).
- Category is inferred **dynamically**: the parser walks rows top-to-bottom tracking the most recently seen header (`REVENUE`, `COST OF GOODS SOLD`, `OTHER INCOME`, `EXPENSES`, `TOTAL`) and assigns following line items to it — no hardcoded subcategory list.
- Column **F (formula-computed) is preferred over column E (manual entry)**, so cached totals are captured correctly.
- Label variants are normalised (`COGS` → `Cost of goods sold`, etc.), and recognised summary rows are reassigned to a `TOTAL` category so dashboard queries stay consistent.
- Uploads are guarded against **future dates** and **duplicate months**; a separate amend flow upserts the current month and deletes subcategories that disappeared from the re-uploaded file.

A rough `.txt` path also exists, defaulting all entries to `EXPENSES` — usable but the least structured of the inputs.

### 4. Incremental, diff-based extraction instead of caching or rate-limiting
There is no caching layer and no general API rate limiter for the provider calls. The efficiency decisions are in the extraction loop itself:

- A `first_time_insertion` flag drives the range: **3 years back on first connect, 1 year on refresh**.
- Writes are **diff-based** — a row is only updated when the incoming amount differs from what's stored, and only inserted when absent. Re-running extraction is therefore close to a no-op when nothing changed.
- Calls are issued **sequentially, month by month** (`await` in series), which naturally throttles request volume. Sage additionally inserts a deliberate `setTimeout(1000)` between months to stay friendly to its API.
- Progress is tracked in an **in-memory map** (`extractionStatus`) rather than the DB, exposed via `check-*-extraction` endpoints that the loading page polls, and cleaned up an hour after completion.

## System design highlights

- **Recursive P&L tree-walker.** `findFinancialData` in the QuickBooks extractor handles arbitrarily nested report sections with a single recursive function, applying whichever upsert (revenue/COGS/expenses) it's handed — the same routine serves income, cost, expense, and other-income passes.
- **Background extraction with a polled progress map.** A `POST /start-*-extraction` kicks off processing without blocking the response; the client polls a `check-*-extraction` endpoint that reports `{progress, complete, total}` from the in-memory `extractionStatus` map and self-expires after an hour.
- **Forced-reconnect on dead refresh tokens.** QuickBooks distinguishes a recoverable API error from an `invalid_grant`: the latter clears the stored token and surfaces `QB_RECONNECT_REQUIRED`, which routes turn into a redirect back to `/quickbooks/auth?error=reconnect_required` rather than a 500.
- **OAuth state CSRF protection (QuickBooks).** The authorize step generates `crypto.randomBytes(24)`, stores it on the session, and the callback rejects mismatches with a 403 before exchanging the code.
- **`intuit_tid` capture for supportability.** Every QuickBooks call logs Intuit's transaction ID from the response headers — on both the success and error paths, checking three possible header locations — which is what Intuit asks for when raising a support case against a failed API call.
- **Dynamic-category Excel parsing.** Inferring category from the last-seen header (rather than a static map of expected rows) means the parser tolerates layout changes within the template without code edits.

## Setup and running locally

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- Developer/sandbox app credentials for QuickBooks and Xero, and a Sage reseller API key, if you want to exercise those flows. The Excel upload path works without any provider credentials.

### Steps
```bash
git clone https://github.com/Kiveshan/BizExecData.git
cd BizExecData
npm install

cp .env.example .env      # then fill in your own values (see below)

# generate the client and apply migrations
npx prisma generate
npx prisma migrate dev

npm run dev      # nodemon on PORT (default 3000)
# or
npm start
```

Open `http://localhost:3000`.

### Environment variables
Create a `.env` file. **Use your own values — these are placeholders only.**

```env
# Server
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug

# Database (Prisma + pg)
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/bizexecdata?schema=public
DB_SSL=false

# Session & encryption
SESSION_SECRET=replace-with-a-long-random-string
ENCRYPTION_KEY=replace-with-a-32-byte-key-exactly   # AES-256 requires exactly 32 bytes

# QuickBooks OAuth (Intuit developer app)
CLIENT_ID=your-quickbooks-client-id
CLIENT_SECRET=your-quickbooks-client-secret
REDIRECT_URI=http://localhost:3000/callback
QB_ENVIRONMENT=sandbox          # or "production"

# Xero OAuth (Xero developer app)
XERO_CLIENT_ID=your-xero-client-id
XERO_CLIENT_SECRET=your-xero-client-secret
XERO_REDIRECT_URI=http://localhost:3000/auth/xero/callback

# Sage Business Cloud (reseller API)
SAGE_API_KEY=your-sage-api-key
# SAGE_BASE_API_URL is optional; defaults to the SA reseller endpoint in code.
```

Notes:
- `IV_LENGTH` is fixed at 16 in code and is not an env var.
- `ENCRYPTION_KEY` has no fallback — it must be a 32-byte value in the environment or AES encryption/decryption will fail.
- A legacy `src/config/database.js` reads `RDS_*` variables but the live data path uses `DATABASE_URL` via `src/config/prismaClient.js`.
- `SAGE_API_KEY` is required for the Sage flows; it is read from the environment (no longer hardcoded).

### Tests and linting
```bash
npm test          # Jest (run via experimental VM modules)
npm run test:watch
npm run lint
npm run lint:fix
```

## Project structure

```
BizExecData/
├── server.js                  # Entry point: mounts route modules, static assets, error handlers, listen()
├── prisma.config.ts           # Prisma config
├── prisma/
│   ├── schema.prisma          # All models: user_table, roles, per-provider calc/line tables, oauth token
│   └── migrations/            # SQL migration history
├── src/
│   ├── app.js                 # Express app: helmet, CORS, sessions, passport, rate limiter, file upload
│   ├── config/                # env, prismaClient (pg pool + adapter), passport, security, legacy database.js
│   ├── middleware/            # auth guards, admin guard, session factory, error handler
│   ├── modules/               # Feature modules, each with routes + controller/extractor/client
│   │   ├── auth/              #   local login/register
│   │   ├── user/              #   user-facing pages/data
│   │   ├── admin/             #   approval + license management
│   │   ├── quickbooks/        #   OAuth client, token refresh, recursive P&L extractor
│   │   ├── xero/              #   OAuth via xero-node, summary/line extractors
│   │   ├── sage/              #   Basic-auth client, encrypted-credential extraction
│   │   └── excel/             #   workbook/txt parsing, upload + amend flows
│   └── utils/                 # crypto (AES), file/date helpers, logger, validation
├── views/                     # EJS templates
│   ├── layouts/               #   page layout
│   ├── pages/                 #   per-provider head/body fragments
│   └── partials/              #   navbars, sidebars, footer (per provider)
├── public/                    # static assets, styles, legacy HTML
├── uploads/                   # Excel income-statement template(s)
└── .github/workflows/         # Elastic Beanstalk deploy (prod, on push to main)
```

## Limitations and things I'd change

- **Provider clients are module-level singletons.** The `xero` and `intuit-oauth` clients hold mutable token/tenant state on a shared instance, so concurrent extraction for multiple users could interleave. A per-request or per-user client instance would be the correct fix.
- **OAuth `state` is verified for QuickBooks but not for Xero.** The Xero callback should validate a stored `state` the same way the QuickBooks callback does.
- **Test coverage is thin** — currently the app boot path and auth middleware. The extractors and normalisers are the highest-value targets for unit tests against recorded report fixtures.
- **Provider data lives in parallel tables.** A single table with a `source` discriminator would remove the duplicated `xero_*`/`sage_*`/base schema and simplify cross-source comparison, at the cost of mixing provider quirks in one place.
- **Sage uses Basic auth with credentials in the session.** This is a constraint of the API surface used here; an OAuth-based Sage integration would avoid handling the user's password at all.

## License

[MIT](LICENSE).
