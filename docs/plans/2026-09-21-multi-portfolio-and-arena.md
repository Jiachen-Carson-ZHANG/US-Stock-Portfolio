# Multi-portfolio, access control, and the Arena

Design for the next session. Nothing here is built yet.

Two changes that share one foundation:

1. **Mile gets her own portfolio** from her own moomoo account, at `/mirat`,
   which Carson can see and their parents cannot.
2. **The Family room is replaced** by something with a single clear purpose:
   a competition between paper portfolios, with AI commentary and a ranking.

Both need the same thing underneath — the app must stop assuming there is one
portfolio — so the schema comes first and everything else builds on it.

---

## Why the schema has to change first

`positions`, `transactions`, `broker_connections`, `portfolio_snapshots` and
`analysis_flows` have no owner column. Every query reads "the portfolio". Nine
pages, four charts and the reconstruction all assume it.

Polishing the cards and the transactions tab before this would mean touching
each of them twice. One migration, then polish once.

---

## Schema

```sql
CREATE TABLE portfolios (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,      -- 'carson', 'mirat', 'dad-paper'
  display_name  TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('broker','paper')),
  base_currency TEXT NOT NULL DEFAULT 'USD',
  -- Paper portfolios start with a stated balance; broker ones take deposits
  -- from their cash-flow ledger.
  opening_cash  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE portfolio_access (
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (portfolio_id, user_id)
);
```

Then `portfolio_id TEXT NOT NULL REFERENCES portfolios(id)` on `positions`,
`transactions`, `broker_connections`, `portfolio_snapshots`, `analysis_flows`,
`quote_cache` excepted — quotes are per symbol, not per portfolio, and sharing
that cache across portfolios is the point of it.

**Migration:** create one portfolio row with slug `carson`, owner = the owner
account, kind `broker`, and stamp every existing row with its id. Nothing is
lost and the app keeps working with one portfolio.

### Access rule

One rule, applied server-side in every route and page:

> You may read a portfolio if you own it, or if there is a row in
> `portfolio_access` for you, or if you are the owner role.

Carson's expectation drops out of that:

| Portfolio | Owner | Access rows |
|---|---|---|
| `carson` | Carson | Mile, Dad, Mum |
| `mirat` | Mile | Carson |
| `dad-paper` | Dad | Carson |
| `mum-paper` | Mum | Carson |

Mile sees hers and Carson's. Dad sees his own paper account and Carson's, and
never Mile's. Carson sees everything.

**This must not be enforced in the UI alone.** The switcher hides what you
cannot see, but every loader takes a portfolio id and re-checks it. A hidden
link is not access control.

---

## Routing

`/carson`, `/mirat`, `/dad-paper` — the slug is the first path segment, and the
existing pages move under it:

```
/carson              -> dashboard
/carson/holdings
/carson/performance
/carson/transactions
/carson/watchlist
```

`/` redirects to the viewer's default: their own portfolio if they have one,
otherwise the first they can see. Old paths (`/dashboard`, `/holdings`)
redirect to the default portfolio so existing links and bookmarks survive.

A switcher in the nav lists only permitted portfolios, marks paper ones, and
is the "entry point" Carson asked for in both directions.

---

## Per-portfolio configuration

Today `MOOMOO_CLIENT_ID` and `TOKEN_ENCRYPTION_KEY` are environment variables,
which works for exactly one broker account. Mile's is a second.

`broker_connections` already has one row per provider and already stores the
encrypted refresh token. Adding `portfolio_id` makes it one row per portfolio,
and `client_id` moves onto that row. `TOKEN_ENCRYPTION_KEY` stays an
environment variable — it is the key that protects all of them, not a
per-account secret.

So Mile connecting her account is a normal OAuth round trip against her own
portfolio row. No new environment variables, ever, for a new person.

`TOTAL_DEPOSITS` likewise stops being an environment variable: deposits live in
`analysis_flows`, which is already dated, already per-portfolio after the
migration, and already reconciles. The env var becomes a fallback for a
portfolio with no ledger.

---

## Paper portfolios

A paper portfolio is a portfolio with `kind = 'paper'` and an `opening_cash`.
Its fills go in the same `transactions` table, written by the app instead of
imported from a broker, priced from the same quote cache.

Everything else then works unchanged: the holdings table, the allocation
donut, the reconstruction, the performance chart, the AI context. That is the
whole reason to model it this way rather than build a separate game.

Trades are validated server-side: enough cash, whole shares, a quote no more
than fifteen minutes old, and the symbol must exist. The existing family-room
challenge already does all of this and its logic can move across.

---

## Replacing the Family room

The current room does too much — posts, replies, reactions, nominations,
sealed predictions, savings goals, a weekly quiz and a trading challenge — and
none of it is obviously the point. It gets replaced by one thing:

### The Arena

Everyone with a portfolio, paper or real, appears in one ranking.

- **Leaderboard** over Day / Week / Month / Year / Max, ranked by
  time-weighted return so a bigger account does not simply win. Trophy for
  first over each completed period; a small cabinet on each profile.
- **AI commentary** on the same periods: what moved, who gained and why, which
  decisions worked. It reads the grounded context already built, extended to
  cover several portfolios, and it is explicitly commentary — never advice.
- **Comments** on any period's summary, so the family can argue with the AI
  and each other. One thread per portfolio per period; keep the existing
  reactions, drop the rest.

What is deliberately dropped: nominations, sealed predictions, savings goals,
the quiz. They can come back individually if missed.

### Fairness

Ranking by percentage return means a $10,000 paper account and a $22,000 real
one compare honestly. Time-weighted return also neutralises deposits, so
adding money never looks like skill — which matters, because Carson's real
account takes deposits and the paper ones do not.

Paper and real are ranked together but labelled, so nobody mistakes one for
the other.

---

## Order of work

1. Schema, migration, access rule, loaders take a portfolio id — no visible change
2. Routing and the switcher — `/carson` works, everything else redirects
3. Mile connects her moomoo to `/mirat`
4. Paper portfolios; parents create theirs
5. The Arena, replacing the Family room
6. Only then: the stat-card dates, the realized/unrealized toggle, dollar
   amounts on the monthly calendar, and the transactions tab

---

## Risks

**The migration touches every table that matters.** Take a dump first. The
reconstruction can rebuild snapshots afterwards, but positions and the broker
token cannot be rebuilt from anything.

**A missed access check leaks a portfolio.** Every loader takes a portfolio id
and re-checks permission. Worth a test per route asserting a viewer without
access gets a 403 — cheaper to write than to discover.

**Two moomoo accounts mean two OAuth clients** and two consent flows. Each
portfolio's `client_id` lives on its own row, so they cannot be confused, but
Mile has to approve read-only scopes herself.

**Paper trades need a fresh quote.** Filling at a stale price is how a game
stops being interesting. The fifteen-minute rule already exists; keep it.
