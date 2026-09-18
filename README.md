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
| Disk | A persistent, writable directory for the SQLite database |
| Network | Outbound HTTPS to `webapi.moomoo.com` (and `api.deepseek.com` if AI is enabled) |

No CDN, Google Font, or analytics script is fetched at runtime, so the app loads
from mainland China without depending on a blocked host.

---

## 1. Environment configuration

Copy the template and fill it in:

```bash
cp .env.example .env.local
```

### Required

| Variable | What it does |
|---|---|
| `APP_URL` | The site's own base URL. **Must exactly match** the moomoo redirect URI, e.g. `https://portfolio.example.com` |
| `SESSION_SECRET` | Random 32 bytes. `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | Random 32 bytes, **different** from the above. Encrypts the broker refresh token at rest |
| `DATABASE_URL` | `file:./data/portfolio.db` |
| `AUTH_MODE` | `password` to require sign-in. See [Access mode](#5-access-mode) |

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
2. A **persistent writable disk** for `data/`, or a Postgres instance instead
3. **Environment secrets**
4. **HTTPS on a fixed hostname** — moomoo's redirect URI must match exactly
5. Reachability from wherever the family is

### Persistence matters

Positions and quotes re-sync from the broker, and accounts can be re-seeded.
**Daily `portfolio_snapshots` cannot be rebuilt** — they accumulate one row per
trading day and are the entire performance history.

Test this before relying on a host: deploy, sign in, redeploy, then reload. If
you are still signed in, the disk persists. If you are bounced to `/login`, it
does not — move to Postgres.

### Deploying to coze.cn

Coze is primarily an AI agent platform. Confirm it can host a **Node.js web
application** — not just an agent or workflow — before planning around it. In
its console look for a project type offering "deploy from GitHub", a Node
runtime, or a custom web service. If all you can create is an agent, bot or
workflow, it cannot run this app and you should use the Docker route below.

If it does host Node apps, it will need:

- **Repository**: `Jiachen-Carson-ZHANG/US-Stock-Portfolio`, branch `main`
- **Build command**: `npm ci && npm run build`
- **Start command**: `npm start`
- **Node version**: 22
- **Port**: from `PORT`, default 3000
- **Persistent volume** mounted at `/app/data`
- **Environment variables**: everything in section 1

After the first deploy, run `npm run db:seed` once in its shell, then set
`APP_URL` to the real URL and re-run `moomoo:register` so the redirect matches.

### Docker (works on any VPS)

The portable path, and the fallback if Coze is agent-only:

```bash
docker build -t family-portfolio .
docker run -d --name portfolio \
  -p 3000:3000 \
  --env-file .env.local \
  -v portfolio-data:/app/data \
  --restart unless-stopped \
  family-portfolio

docker exec portfolio ./node_modules/.bin/tsx scripts/seed.ts
```

The named volume is what preserves the database across image rebuilds.

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

**Diagnosing the broker connection** — prints exactly what moomoo returns for
each call, without ever printing a token:

```bash
npx tsx scripts/moomoo-doctor.ts
```
