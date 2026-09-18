# Family Portfolio Dashboard

A private, read-only web dashboard that shows one owner's US stock and options
portfolio to four family members. It displays factual data only — no
recommendations, no ratings, no trading. See
`Design and implementation.md` for the full specification.

## Status

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Auth, roles, protected routes, app shell | Done |
| 2 | Dashboard, holdings, position detail, charts | Done |
| 3 | Moomoo OAuth + position sync | Not started |
| 4 | Live quote layer | Mock only |
| 5 | Historical snapshots | Done (daily, after US close) |
| 6 | Security review | Pending |
| 7 | Coze deployment | Not started |

The app currently runs on a synthetic portfolio (`DATA_PROVIDER=mock`). All
broker-specific code sits behind `BrokerProvider` / `MarketDataProvider` in
`src/providers/`, so Phase 3 swaps the implementation without touching the UI.

## Requirements

- Node.js 20.9+ (developed on 22)
- No external CDN, font host or analytics service is used at runtime, so the
  app loads from mainland China.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
# generate each of these separately
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
```

Set `SEED_OWNER_PASSWORD`, `SEED_FATHER_PASSWORD`, `SEED_MOTHER_PASSWORD` and
`SEED_WIFE_PASSWORD` to the passwords you want. If you leave them blank the
seed script generates random ones and prints them once — they are not stored.

```bash
npm run db:seed   # creates the four accounts and loads the mock portfolio
npm run dev
```

Open http://localhost:3000 and sign in as `owner`.

## Accounts

Four fixed local accounts: `owner`, `father`, `mother`, `wife`. There is no
signup route. Only `owner` can reach Settings, sync holdings, or revoke
sessions. Passwords are hashed with Argon2id; sessions are HttpOnly cookies
lasting 30 days, and only a digest of each session token is stored.

## Commands

```bash
npm run dev         # development server
npm run build       # production build
npm start           # serve the production build
npm test            # unit and integration tests (Vitest)
npm run test:e2e    # end-to-end tests (Playwright, desktop + mobile)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run db:seed     # create accounts, load mock portfolio, backfill snapshots
```

`npm run test:e2e` builds the app and seeds its own throwaway database at
`data/e2e.db`; it never touches your real one.

## Database

SQLite by default, at the path in `DATABASE_URL`. Everything database-specific
lives in `src/lib/db/` plus the read/write helpers under `src/lib/portfolio/`,
so moving to Postgres is a contained change.

**SQLite needs a persistent, writable filesystem that survives redeploys.** If
the host resets its disk on deploy, accumulated `portfolio_snapshots` are lost
permanently — positions and quotes re-sync from the broker, but daily history
cannot be rebuilt. Verify persistence on your host before relying on it.

## Security notes

- Every page and API route authorizes server-side before returning portfolio
  data. `src/proxy.ts` only does a cookie-presence redirect as defence in
  depth and grants nothing on its own.
- The app requests no write scopes and exposes no trading endpoint.
- Never commit `.env.local` or anything under `data/`.
