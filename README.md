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
| `TOKEN_ENCRYPTION_KEY` | Random 32 bytes encoded as base64. Encrypts broker refresh tokens at rest |
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

Put the printed `MOOMOO_CLIENT_ID` in `.env.local` and restart. Then open your portfolio → **Broker connection and refresh** and sign in.

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
| unset / `open` | Open only in development; production refuses to start |
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

### Docker (works on any VPS)

A portable deployment option for a Node.js host:

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

## Portfolios, access and the Arena

Every portfolio has an address. Carson's is `/carson`; Mile's would be
`/mirat`. The old paths (`/dashboard`, `/holdings`, `/performance`,
`/transactions`) still work and redirect to whichever portfolio is yours.

**Who can see what** is one rule, applied server-side in every loader:
you may read a portfolio if you own it, if someone granted you access, or if
you hold the owner role. Writing is narrower — only the person who owns a
portfolio may connect a broker, record a transfer or place a paper trade.
An administrator can look; they cannot act as you.

A portfolio you cannot read answers 404 rather than 403, so guessing a slug
tells you nothing about whether it exists.

**Creating one:** Settings → Portfolios. Choose an address, a name, whose it
is, and whether it follows a real brokerage or starts from a stated balance.
Paper portfolios trade against live prices with no real money.

**The Arena** (`/arena`) ranks every portfolio you can see by time-weighted
return over Day / Week / Month / Year / All time. It shows percentages and an
indexed curve only — never an account value, a position size or a cash
balance. That is enforced by the data type, not by the template.

### Scheduled jobs

| Endpoint | When | Why |
|---|---|---|
| `POST /api/cron/snapshot` | daily, after the close | records the day for every portfolio |
| `POST /api/cron/reconstruct` | monthly | rebuilds all history from fills; the backstop for days nobody was there to capture |
| `GET /api/cron/orders` | every minute while the market is open | fills resting orders on the practice accounts |
| `GET /api/cron/quotes` | every minute | refreshes the shared price cache so no page load has to |

All three take `Authorization: Bearer $SNAPSHOT_CRON_SECRET`. The first two
are not required for correctness — history can always be re-derived — but
without the monthly one nothing re-derives it if nobody opens the app.

The order matcher is different: without it a limit order only gets looked at
when somebody loads the page it is resting on, so one left overnight sits
untouched while the price trades straight through it. It is a `GET` because
that is all a simple uptime pinger sends, it does nothing when the market is
shut, and it touches only the accounts that actually have an order open.

Vercel's own cron runs once a day on the free plan, which is no use here, so
use any external scheduler that can send a header. cron-job.org is free and
does; the whole setup is five fields:

1. Sign up at cron-job.org and choose **Create cronjob**.
2. **URL**: `https://<your-site>/api/cron/orders`
3. **Schedule**: every 1 minute. (Every 5 is fine too — it only changes how
   quickly a touched limit turns into a fill.)
4. **Advanced → Headers**, add one:
   `Authorization: Bearer <the value of SNAPSHOT_CRON_SECRET>`
5. Save, then press **Test run**. A working setup answers
   `{"matched":true,...}` during market hours and
   `{"matched":false,"reason":"Market closed"}` outside them. `401` means the
   header is wrong; `503` means `SNAPSHOT_CRON_SECRET` is not set on the
   deployment.

Add a second job the same way for `/api/cron/quotes`, also every minute. It
decides for itself whether there is anything to do: at most once a minute
during the regular session, at most once every half hour in pre-market and
after hours, and nothing at all when the market is shut. Guarding the cadence
in the endpoint rather than trusting the scheduler means a misconfigured
pinger costs one cheap query rather than a rate-limit ban.

It fetches one price per name across every account, not one per portfolio:
ten people holding NVDA cost one NVDA quote. Holdings are deliberately not
refreshed on a timer — what somebody owns changes when they trade, is private
to them, and is picked up when they open their own page.

The same scheduler can drive the other jobs on their own schedules.

### Where the functions run

`vercel.json` pins them to `sin1` (Singapore) because the Neon database is in
`ap-southeast-1`. The default region is `iad1` (Washington), and from there
every query crossed the Pacific: 233 ms a round trip against 7-10 ms beside
the database, which on a page making twenty to forty queries is most of the
wait. On the Hobby plan the dashboard setting (Project → Settings →
Functions → Function Region) wins over this file, so set both. If the
database ever moves, move this with it.

### Recording transfers

The broker API returns trades and never transfers, so a deposit nobody
records looks exactly like a gain of the same size. Use **Record a transfer**
on the dashboard. A banner appears when cash the fills cannot explain passes
$200, which is above what dividends and fees account for.

`TOTAL_DEPOSITS` is now only a fallback for a portfolio whose flows have not
been entered, and will be removed.

### Database roles

`scripts/sql/roles.sql` creates a read-only `analyst` role that cannot read
`broker_connections` or `users.password_hash`. Use it for anything you run by
hand; keep the owner connection string in the deployment environments only.
Read the comments at the top — it is a guard against accidents, not against a
determined operator.

## Read-only broker security (September 2026 audit)

Broker tokens remain encrypted in PostgreSQL. The operator controls the server
and encryption key and can decrypt them; this is not encryption against the
operator. Passwords are stored as Argon2id hashes. Moomoo passwords are never
collected by this app. A broker read grant cannot be upgraded merely by editing
our database; permissions are granted by the user at Moomoo.

Only `quote:read`, `trade:read` and documented `accid:` selectors are accepted.
Both read permissions are required. Missing, write or unknown permissions are
rejected at connection storage and refresh; old unsafe grants require
reconnection. The broker client also permits only the specific read endpoints
used by the dashboard (including POST quote snapshots). Tests use synthetic
tokens and mocked responses and do not submit real orders.

Production builds and startup require `AUTH_MODE=password`. Configure it on
both the build and runtime environments. Scheduler endpoints separately check
`SNAPSHOT_CRON_SECRET`; the monthly reconstruction endpoint no longer requires
a browser session.

Every signed-in member can see Carson's default portfolio by design. The
administrator can read all portfolios. Other access is explicit and can be
requested from the portfolio owner. Any permitted reader can request a broker
sync without the owner being logged in; only the portfolio owner can connect,
replace or disconnect their broker, edit transfers or place mock trades.
Each broker portfolio now has a `/<portfolio>/connection` page, linked from
its dashboard, including empty portfolios. New users can register and choose their own password. An administrator must
approve the account before it becomes active and receives its starting portfolio.

Watchlist discussions remain shared, but AI notes are stored by source portfolio
and shown only through that portfolio's authorized context. Old unscoped AI
notes are not displayed because their source cannot be established. AI providers
receive the permitted financial context; optional Arena news search sends ticker
queries to Tavily. Family Room remains a shared family space, not a private vault.

Disconnect deletes the stored connection, not financial history or backups.
Users should also revoke authorization at Moomoo to invalidate outstanding broker
access. The revised `scripts/sql/roles.sql` grants only explicit permitted tables
and user columns; it excludes broker connections, password hashes and sessions.
Apply it deliberately with a new analyst password on each deployed database.
It is not automatically applied by the schema migration.

### Vercel deployment consistency

A build uses committed files, not uncommitted local changes. Ship the OAuth
scope validator together with its callers: `tokens.ts` and the callback import
`assertReadOnlyScope` from `oauth.ts`. A missing-export build error means the
source snapshot is incomplete; adding an environment variable cannot fix it.

In Vercel's value fields, enter values only: `DATABASE_URL` starts with
`postgresql://` or `postgres://`, not `DATABASE_URL=`. Set `APP_URL` to the real
HTTPS application origin and, when used, `PUBLIC_ORIGIN` to that same origin.
Register `<APP_URL>/api/broker/moomoo/callback` with Moomoo exactly. Environment
changes require a new deployment and must apply to its Production/Preview scope.

`TAVILY_API_KEY` is optional for Arena news search. `SESSION_SECRET` is unused:
sessions use random opaque tokens with database-stored hashes. Seed passwords
are used only when provisioning accounts through the seed script, not on every
request. Cron secrets authenticate jobs but do not create a host scheduler.
