# Family Portfolio Dashboard

A private, read-only web dashboard showing one owner's US stock and options
portfolio to a small group of family members. It reads from moomoo and displays
factual data — holdings, cost, P&L, allocation, transactions — plus a shared
watchlist where each person records why they are tracking something.

It cannot place, modify or cancel an order. Only read scopes are requested, and
a connection that comes back carrying a write scope is refused and discarded.

---

## Requirements

| | |
|---|---|
| Node.js | 20.9 or newer (developed on 22) |
| Database | PostgreSQL 14 or newer (managed or self-hosted) |
| Network | Outbound HTTPS to `webapi.moomoo.com` (and `api.deepseek.com` if AI is enabled) |

No CDN, Google Font, or analytics script is fetched at runtime, so the app loads
from mainland China without depending on a blocked host.

---

## 1. Environment configuration

Copy the template and fill it in:

```bash
cp .env.example .env.local
```

Need a database to develop against? This starts a throwaway Postgres on port
55432, matching the `DATABASE_URL` in the template:

```bash
npm run db:dev:up      # docker; npm run db:dev:down to remove it
```

### Required

| Variable | What it does |
|---|---|
| `APP_URL` | The site's own base URL. **Must exactly match** the moomoo redirect URI, e.g. `https://portfolio.example.com` |
| `SESSION_SECRET` | Random 32 bytes. `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | Random 32 bytes, **different** from the above. Encrypts the broker refresh token at rest |
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://user:pass@host:5432/portfolio?sslmode=require` |
| `AUTH_MODE` | `password` to require sign-in. See [Access mode](#5-access-mode) |

### Recommended

| Variable | What it does |
|---|---|
| `TOTAL_DEPOSITS` | Cash paid into the broker account, less withdrawals, e.g. `22100`. Without it the whole-journey return is inferred from the broker's realized P&L — which excludes positions closed outright, and so overstates losses. moomoo's fills API only serves ~90 days, so the missing trades cannot be recovered; stating the figure is the only exact fix |

If `TOKEN_ENCRYPTION_KEY` changes, the stored broker token can no longer be
decrypted and the account must be reconnected. Back it up.

### Accounts

One password per person. Used only by the seed script; they are hashed with
Argon2id and the plaintext is never stored.

```
SEED_OWNER_PASSWORD=
SEED_FATHER_PASSWORD=
SEED_MOTHER_PASSWORD=
SEED_MILE_PASSWORD=
SEED_ZIZHE_PASSWORD=
```

Leaving one blank makes the seed generate a random password and print it once.

### Broker

| Variable | What it does |
|---|---|
| `MOOMOO_CLIENT_ID` | From `npm run moomoo:register` (see step 4) |
| `MOOMOO_MARKET` | `US` |
| `DATA_PROVIDER` | `mock` for synthetic data. Connecting a real account switches this automatically |

### Optional

| Variable | Default | What it does |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | Enables the AI view and writing help on the watchlist. Without it those buttons are hidden |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Any OpenAI-compatible API host |
| `DEEPSEEK_MODEL` | `deepseek-flash` | DeepSeek-V4.1-Flash. `deepseek-chat` is legacy and being retired |
| `PORTFOLIO_BASE_CURRENCY` | `USD` | Display currency |
| `QUOTE_CACHE_SECONDS` | `15` | Server-side quote cache; one upstream call serves every viewer |
| `POSITION_CACHE_SECONDS` | `60` | How often holdings re-sync from the broker |

---

## 2. Install and start

```bash
npm ci
npm run db:seed     # creates the accounts, loads synthetic holdings
npm run dev         # http://localhost:3000
```

For production:

```bash
npm ci
npm run build
npm run db:seed
npm start
```

`db:seed` never overwrites an existing account, and it leaves real holdings
alone once a broker is connected. To apply changed `SEED_*` values to accounts
that already exist:

```bash
npm run db:reset-passwords
```

---

## 3. Verification

Run these before trusting a deployment:

```bash
npm run typecheck   # no type errors
npm test            # 139 unit and integration tests
npm run lint        # no lint errors
npm run test:e2e    # 34 browser tests, desktop and mobile
```

`test:e2e` builds the app and seeds a throwaway database at `data/e2e.db`; it
never touches the real one. It covers sign-in, that unauthenticated API calls
return 401 and leak no holdings, that viewers get 403 on owner-only routes, and
that no trading endpoint exists.

Then check by hand:

1. Sign in as `owner` — the overview loads with holdings
2. Portfolio value matches the moomoo app, within a few dollars of timing drift
3. An option spread appears as **one** row, not two legs
4. The language toggle switches the whole interface
5. On a phone, nothing scrolls sideways

---

## 4. Connecting moomoo

One-time client registration — moomoo supports dynamic registration, so there is
no developer portal step:

```bash
APP_URL=https://your-deployed-url npm run moomoo:register
```

Put the printed `MOOMOO_CLIENT_ID` in `.env.local` and restart. Then open
**Settings → Connect moomoo** and sign in.

On moomoo's consent screen tick **only**:

- ✅ Market Data
- ✅ Accounts & Orders
- ❌ Watchlists — *this grants write access*
- ❌ Trade Execution

Granting either write permission causes the app to refuse the connection and
store nothing. Redirect URIs must match `APP_URL` exactly, so register again
after the deployed URL is final.

---

## 5. Access mode

`AUTH_MODE` controls who can see the portfolio.

| Value | Behaviour |
|---|---|
| unset | **Open.** No sign-in, everyone is treated as owner |
| `password` | Sign-in required; viewers cannot reach Settings |

Open mode is fine on a laptop. **Set `AUTH_MODE=password` before the app is
reachable on the internet** — a private link is not access control, and
subdomains surface in certificate-transparency logs.

Roles: `owner` can connect the broker, sync, revoke sessions and see family
activity. `father`, `mother`, `mile` and `zizhe` are viewers — read-only, with
no Settings tab. Usernames are case-insensitive.

Sessions are HttpOnly cookies lasting 30 days; only a digest of each token is
stored. Five failed sign-ins trigger a cooldown.

---

## 6. Deployment

### What any host must provide

This is **not** a static site. Every page is server-rendered and calls moomoo,
so a static-file host or an export will not work. The host needs:

1. A long-running **Node.js 20.9+** process
2. A reachable **PostgreSQL 14+** database
3. **Environment secrets**
4. **HTTPS on a fixed hostname** — moomoo's redirect URI must match exactly
5. Reachability from wherever the family is

The container itself is disposable — all state is in Postgres, so a redeploy
loses nothing and no persistent volume is needed.

### Persistence matters

Positions and quotes re-sync from the broker and accounts can be re-seeded, but
**daily `portfolio_snapshots` cannot be rebuilt** — they accumulate one row per
trading day and are the entire performance history. Transaction history is
similarly one-way: moomoo only serves a 90-day window, so fills that age out
survive only in this database.

Keep the database backed up. On a managed provider, turn on automated backups.

### Moving an existing SQLite database across

Earlier versions stored everything in `data/portfolio.db`. To carry that data
into Postgres, stop the app, point `DATABASE_URL` at the new database, and run:

```bash
npm run db:migrate-from-sqlite            # defaults to ./data/portfolio.db
npm run db:migrate-from-sqlite -- path/to/portfolio.db
```

It writes with `ON CONFLICT DO NOTHING`, so existing rows always win and the
script is safe to run twice. The encrypted broker token copies across intact,
so the moomoo connection survives and does not need re-authorizing.

Sessions and login attempts are deliberately not copied — both are throwaway,
and sessions reference account ids, so carrying them into a database that had
already seeded its own accounts would fail the foreign key. Everyone signs in
once after the move.

### Deploying to coze.cn

Coze 编程 (`code.coze.cn`) hosts Node.js web applications. It runs on 火山引擎
(Volcengine) underneath, but that is not a separate step you perform — you
deploy to Coze and Coze allocates the Volcengine resources. Volcengine Ark, the
AI model API, is an unrelated product and is not used by this app.

Everything Coze needs is already committed:

| File | Purpose |
|---|---|
| `.coze` | Project manifest: runtime, build and run commands |
| `.cozeproj/scripts/deploy_build.sh` | `npm ci`, build, assemble the standalone bundle |
| `.cozeproj/scripts/deploy_run.sh` | Seed the database, start the server |
| `scripts/coze-preview-*.sh` | The same for Coze's preview environment |

**Step 1 — create the project.** In the Coze console create a web application
project and connect this repository. Coze issues a project id; paste it into the
`sub_id` field at the top of `.coze` and commit.

**Step 2 — create the database.** Enable Coze's built-in PostgreSQL and copy its
connection string. Nothing else is needed: the app creates its own schema on
first boot and seeds its accounts, so an empty database is the correct starting
point.

**Step 3 — set the environment variables.** Use Coze's encrypted environment
variable panel, never a file in the repository.

| Variable | Value |
|---|---|
| `DATABASE_URL` | The connection string from step 2 |
| `DATABASE_SSL` | Only if the connection fails on TLS — try `no-verify` |
| `AUTH_MODE` | `password` |
| `APP_URL` | The URL Coze assigns, e.g. `https://xxx.coze.site` |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`, different from the above |
| `MOOMOO_CLIENT_ID` | From `npm run moomoo:register` |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | Optional, for the AI notes |
| `SEED_OWNER_PASSWORD` and the other `SEED_*` | The family's sign-in passwords |

**Step 4 — allow the deployed origin.** Sign-in is a Server Action, and Next
rejects one whose `Origin` does not match `Host`. Coze proxies from its own
domain, so its hostname must be listed in `experimental.serverActions
.allowedOrigins` in `next.config.ts`. The dev and sandbox hosts are already
there; if sign-in fails on the deployed URL while working locally, add that
exact hostname (or set `PUBLIC_ORIGIN` to it) and redeploy. **This is the most
likely first failure and it produces no obvious error message.**

**Step 5 — register the callback before you need it.** moomoo compares the
redirect URI character for character, and re-registering issues a new
`client_id` that invalidates the stored connection. One client can hold several
URIs, so register every origin the app will ever be served from in one go:

```bash
npm run moomoo:register -- https://your-app.coze.site https://your-app.vercel.app
```

`APP_URL` and `http://localhost:3000` are always included. Set `APP_URL` on each
deployment to its own origin — that is what the app builds its callback from.

**Step 6 — carry your data across**, if you are moving from the SQLite version.
Do this **before the first deploy**, while the database is still empty: the app
seeds its own accounts on every boot, and once they exist the usernames collide
and your original accounts — with their passwords — are skipped. The script
warns when it sees this, but the clean order is:

1. create the database, deploy nothing yet
2. `DATABASE_URL=<coze postgres> npm run db:migrate-from-sqlite`
3. deploy; the boot-time seed then leaves your migrated accounts alone

Coze keeps development and production databases apart, so migrating into one
does nothing to the other. Do it deliberately, for the one you are launching.

#### Verifying the deployment

1. `/login` renders **with styling** — unstyled means the standalone bundle is
   missing `.next/static`, so check `deploy_build.sh` ran fully
2. A wrong password is rejected; the right one signs in — if it hangs or fails
   silently, revisit step 4
3. `/dashboard` shows holdings, and `/settings` reports the broker connection
4. Redeploy, then reload: you should stay signed in, because the session lives
   in Postgres rather than on the container's disk

#### Custom domain

Coze can bind a domain, but a mainland-hosted one requires ICP 备案, which takes
weeks. The Coze-provided URL needs no filing and is the fastest path to having
the family actually using it.

### Docker (works on any VPS)

The portable path, and the fallback if Coze is agent-only:

```bash
docker build -t family-portfolio .
docker run -d --name portfolio \
  -p 3000:3000 \
  --env-file .env.local \
  --restart unless-stopped \
  family-portfolio

docker exec portfolio ./node_modules/.bin/tsx scripts/seed.ts
```

No volume is needed — all state lives in the Postgres instance `DATABASE_URL`
points at, so the container can be rebuilt freely.

Put a TLS terminator in front (Caddy or nginx) so the site is HTTPS — session
cookies are `Secure` in production and will not be stored over plain HTTP.

For access from mainland China without an ICP filing, a **Hong Kong** host
(Alibaba Cloud HK, Tencent Cloud HK) routes well from the mainland. A
mainland-hosted domain requires ICP registration, which takes weeks.

---

## 7. Security notes

- Every page and API route authorizes server-side before returning data.
  `src/proxy.ts` only does a cookie-presence redirect as defence in depth
- Credentials post through a Server Action, so they never appear in a URL
- The broker refresh token is AES-256-GCM encrypted at rest and never sent to
  the browser. Tokens, passwords and account numbers are stripped from logs
- The DeepSeek key stays server-side; the browser only receives finished text
- **Never commit `.env.local` or anything under `data/`**

---

## 8. Troubleshooting

**"No permission to access this account"** — the stored account ID is stale.
Disconnect and reconnect from Settings.

**Connection refused after authorizing** — a write scope was granted. Reconnect
and tick only Market Data and Accounts & Orders.

**Holdings empty after connecting** — press *Sync holdings now* in Settings, or
check the logs for `broker.sync.failure`.

**Prices look stale** — quotes cache for `QUOTE_CACHE_SECONDS` and holdings for
`POSITION_CACHE_SECONDS`. The refresh button on Overview forces a reload.

**Nothing on the page is clickable** — the client bundle did not load. In
development this is usually a blocked HMR WebSocket; build and run production
(`npm run build && npm start`) to confirm.

**AI buttons missing or failing** — check the provider, model and key:

```bash
npm run ai:test
```

It prints the endpoint and model, sends one prompt, and shows the provider's
own error. The key is never printed.

**Diagnosing the broker connection** — prints exactly what moomoo returns for
each call, without ever printing a token:

```bash
npx tsx scripts/moomoo-doctor.ts
```

## Family Room and analysis

Open **Family Room** to post questions (optionally about a ticker), reply, react,
vote for a company to explore, take the learning quiz, save date-locked prediction
capsules, and record shared savings goals. Holdings and watchlist entries link to
related discussions. Each member's contributions are preserved. Only the owner
can remove a shared watchlist entry. Password mode is needed for separate member
identities; open access uses one shared Family identity. For a reverse-proxy
deployment, set `APP_URL` to the public site URL (or `PUBLIC_ORIGIN` to its exact
origin) so browser mutations can validate the public origin.

The virtual portfolio challenge uses imaginary money only. It never calls a
broker order endpoint. It has a fixed end date, equal starting balances and
server-validated prices; its displayed valuation dates and sampled drawdown are
part of the result. Demo and live prices are kept separate. Savings contributions
are also an independent ledger, not money moved into or out of the brokerage.

**Performance** now includes a period selector, cash-flow-adjusted growth index,
value-change waterfall, observed monthly returns, imported benchmark comparison,
USD/CNY account-value decomposition and an options expiration payoff explorer.

Before publishing returns, an owner opens **Manage analysis data**, records all
external deposits/withdrawals (positive/negative, in the portfolio currency), then
confirms the reviewed date range. Security transfers should be recorded at fair
value. Purchases/sales inside the account are not external flows. Editing the
ledger clears its review. The calculation assumes flows occur at end of day;
this is an approximation when large flows occur intraday. A flow on a missing
valuation date prevents return calculation. Missing weekdays suppress daily
best/worst and volatility statistics, including market holidays conservatively.
Drawdown and monthly figures describe observed periods only, not unobserved days.

For benchmark comparison, paste `date,value` CSV (at least two rows) with a named
source for a **USD total-return index including dividends**. The existing quote
provider is not assumed to supply total-return history. The two curves normalize
to 100 on their first common date. For RMB decomposition import historical
USD/CNY rates (RMB per dollar) in the same CSV format. Both selected endpoints
must match; no rate is invented or carried forward. Each import replaces that
series atomically. RMB decomposition describes account-value changes including
cash flows, not investment returns.

Options scenarios combine only matching underlying/expiration/currency legs.
Verify premiums: a broker's adjusted cost may differ from the original premium.
Enter total scenario fees. This shows expiration payoff, not current option
valuation, and excludes early assignment and taxes.

### Independent daily snapshots

History reads the latest 400 observations in chronological order. Snapshots can
still be captured by a page request, but unattended capture is available through
`POST /api/cron/snapshot`. Configure a separate `SNAPSHOT_CRON_SECRET` and a host
scheduler to send `Authorization: Bearer <secret>` every 15 minutes. Keep the
secret in the scheduler's secret storage. The endpoint does not need a login
cookie; it always verifies its bearer secret, even in open-access mode.

The handler is a no-op before 16:00 US Eastern and on weekends, and skips a day
already recorded. It refuses stale, pre-close or previous-day data and returns 503 so the
scheduler can retry. This records the first fresh observed valuation after
regular-session close, not a reconstructed official closing valuation. It cannot
recover missed historical valuations. Market holidays/early closes are not fully
modelled. No scheduler is installed automatically by this repository; enable it
on the host running the app, with persistent SQLite storage.

All new tables are created additively on first use. Existing holdings, history,
accounts and original watchlist notes are preserved. Back up the SQLite database
before deployment. Optional AI watchlist opinions are generated model output,
not verified portfolio facts; the factual analytics do not depend on AI.
