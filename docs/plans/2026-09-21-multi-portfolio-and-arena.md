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

**`MOOMOO_CLIENT_ID` stays a single shared environment variable.** It
identifies *this application* to moomoo, not a person — the registration sends
`client_name` and `redirect_uris`, and the grant types are
`authorization_code` and `refresh_token` with no client secret. Every user
authorizes the same client and receives their own refresh token. Mile does not
need her own, and neither does anyone after her.

`TOKEN_ENCRYPTION_KEY` likewise stays one shared variable: it is the key those
tokens are encrypted with, not a per-account secret.

What *is* per portfolio is the refresh token, which already lives in
`broker_connections`. Adding `portfolio_id` to that table makes it one row per
portfolio, and connecting a new account becomes an ordinary OAuth round trip.

**No new environment variable is ever needed for a new person.**

`TOTAL_DEPOSITS` stops being an environment variable entirely: deposits live
in `analysis_flows`, which is dated, per-portfolio after the migration, and
already reconciles to the cent. A new person records their own deposits and
nothing in the environment changes.

---

## Recording deposits

The broker API does not report transfers, and no amount of engineering will
change that — moomoo's `fills_history` returns trades only. A deposit is the
one fact the app cannot derive, and getting it wrong moves every return figure
by the same amount.

So it needs to be asked for, prominently, not buried in a settings page:

- **An "Add deposit" action on the portfolio header**, beside the value, for
  anyone who owns that portfolio. Date, amount, optional note.
- **A banner when the numbers stop reconciling.** Cash that trades and
  recorded deposits cannot explain is a strong signal that money went in
  unrecorded. Today's residual is $23 on $22,100; a threshold of roughly $200
  would catch a real transfer without firing on dividends.
- Withdrawals are the same form with a negative amount.

Everything else — fills, prices, valuations — derives. This is the only thing
a person has to tell the app.

---

## Keeping history current without anyone visiting

Snapshots are a cache of a derivation, so a missed day can always be rebuilt
later from fills and historical prices. But "later" still has to happen, and
if nobody opens the app for a month nothing triggers it.

A **monthly scheduled run of the reconstruction** is the backstop: it fills
every missing day in one pass and corrects any day already recorded. It needs
no secret beyond the scheduler's own auth, and if it fails nothing is lost —
the next visit or the next run rebuilds the same days.

This is different from the per-day capture that was originally planned. That
one needed to fire at a precise time or the day was gone forever. This one
only needs to run eventually.

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

### What the Arena must not show

Ranking the family against each other means each of them can see the others'
page. Account sizes are nobody else's business — a paper account starting at
$10,000 next to a real one at $22,000 invites exactly the comparison this is
meant to avoid.

So the Arena shows **percentages and an index only**: return over the period,
the indexed curve from 100, rank and trophies. No account value, no position
sizes, no cash balance, no dollar P&L. The portfolio pages keep their real
figures and stay behind the same access rule as before — the Arena is a view
over them, not a hole in them.

That also makes the comparison meaningful, since a percentage is the only
thing comparable across accounts of different sizes.

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
6. Deposit recording: the header action and the reconciliation banner
7. The monthly reconstruction backstop
8. Only then: the stat-card dates, the realized/unrealized toggle, dollar
   amounts on the monthly calendar, and the transactions tab

---

## Risks

**The migration touches every table that matters.** Take a dump first. The
reconstruction can rebuild snapshots afterwards, but positions and the broker
token cannot be rebuilt from anything.

**A missed access check leaks a portfolio.** Every loader takes a portfolio id
and re-checks permission. Worth a test per route asserting a viewer without
access gets a 403 — cheaper to write than to discover.

**Two moomoo accounts share one OAuth client but need two consent flows.**
Mile approves read-only scopes on her own device and her refresh token lands
on her portfolio's row. The risk is mixing the tokens up, not the client id —
every broker call must take a portfolio id rather than reading "the"
connection.

**Paper trades need a fresh quote.** Filling at a stale price is how a game
stops being interesting. The fifteen-minute rule already exists; keep it.

---

## Accounts, secrets, and what "only they can see it" can actually mean

Carson's requirement: each person's password and broker token should be theirs
alone, unreadable even by the project owner. Part of that is already true, part
is achievable, and part is not achievable while one person runs the server.
Worth stating precisely, because the gap is easy to mistake for a bug later.

**Passwords are already safe.** They are stored as Argon2id hashes
(`src/lib/auth/password.ts`, m=19456 t=2 p=1). Nobody reads them back —
not Carson, not anyone holding the database. This needs no change.

**Changing your own password does not exist yet.** There is no route, no form,
no server action; the only way a password changes is `seed.ts --reset-passwords`
run from a terminal with `SEED_*` set. So today Carson sets everyone's password
and they cannot change it, which is exactly backwards.

Build: a signed-in user posts current + new password, the current one is
verified, the new hash is written, and every *other* session of theirs is
revoked. Owners get no ability to read a password, only to disable an account.
Log it to `activity_events` so a change is visible after the fact.

**The broker token cannot be hidden from whoever runs the server.** It is
encrypted at rest with `TOKEN_ENCRYPTION_KEY`, which lives in the deployment's
environment. Anyone who can read that environment can decrypt any token in the
table. That is Carson, on both Vercel and EdgeOne.

The only way to change that is to derive the encryption key from the user's own
password, so the server holds ciphertext it cannot open unless that person is
signed in. The cost is severe and structural: background sync, snapshots, the
monthly reconstruction and any cron would stop working for anyone not currently
logged in, because the server could no longer reach their broker. For a family
dashboard whose entire premise is that the data is there when someone opens it,
that trade is not worth making.

So the honest position is: **the server can act as any connected account, and
the person who controls the server controls the token.** What limits it is
scope and evidence, not cryptography —

- moomoo tokens are requested read-only; they cannot place a trade.
- `portfolio_access` (above) keeps *family members* out of each other's data.
- Every broker refresh and every admin action lands in `activity_events`.
- Revoking access is one click in moomoo, on the person's own device, and does
  not depend on trusting this app.

That should be written into the app where people connect their account, not
left implicit. A person deciding whether to link a brokerage deserves to read
it before they click, not discover it afterwards.

**Database access is the same story.** `DATABASE_URL` grants full read/write to
every table; Neon's `neondb_owner` role has no row-level restrictions. Access
control in this app is enforced in application code, not in the database. Anyone
with the connection string bypasses all of it. Keep the string in the two
deployment environments and nowhere else, and rotate it whenever it is exposed.

**`TOTAL_DEPOSITS` is still load-bearing** (`service.ts:80`) even though
`analysis_flows` now holds the same $22,100 with dates and reconciles to the
cent. The env var should be retired in favour of summing the ledger per
portfolio — it cannot survive multi-portfolio anyway, since one global number
cannot describe several accounts.

---

## Status, 2026-09-21

Built and on `feat/family-exploration`:

1. **Schema, migration, access rule** — `portfolios`, `portfolio_access`, a
   `portfolio_id` on every table that needed one, and one access rule applied
   in every loader. Existing rows adopted on boot.
2. **Routing and the switcher** — `/carson` and friends, old paths redirect,
   switcher appears only when there is more than one portfolio.
3. **A second person can connect moomoo** — the consent now carries the
   portfolio it was started for, and the token cache is keyed by portfolio.
   Mile needs an account and a portfolio row; the code path is done.
4. **Paper portfolios** — opening balance, server-validated trades, holdings
   written into the same tables so every existing view works on them.
5. **The Arena** — leaderboard and indexed curves over five periods, ranked by
   time-weighted return, percentages only.
6. **Deposit recording** — a control on the dashboard and a reconciliation
   banner past $200.
7. **Monthly reconstruction backstop** — `POST /api/cron/reconstruct`.

Also done, from the security discussion: change-your-own-password, wider
behaviour logging, credential redaction in log values, and a read-only
`analyst` database role.

8. **Arena commentary** — a grounded, deliberately rude write-up per period,
   with optional Tavily news search to explain what moved.
9. **Trophy cabinet** — placings for finished weeks, months and years,
   recorded by the daily job and unchangeable afterwards.
10. **Asking for access** — a portfolio that is not yours says so and offers
    to ask; the owner approves or declines and both sides are notified.
11. **The polish list** — stat-card periods, the realized/unrealized toggle,
    money on the monthly calendar, and the transactions tab as a full ledger
    of trades and transfers with per-sale results.

### Not built

- **Comment threads in the Arena.** The commentary is there; arguing with it
  in writing is not. Reactions and threads exist in the Family Room and can
  move across when the room is retired.
- **Deleting the Family Room.** The nav points at the Arena; `/family` still
  works. Deleting roughly a thousand lines of working features should happen
  after someone has used the replacement, not before.

### Decisions worth remembering

- **Slugs follow the username**, except Mile's, which she asked to be
  `/mirat`. A mock account carries `-mock` in the address so a link cannot be
  mistaken for a real one.
- **A private portfolio admits it exists.** The safer default is a flat 404,
  which hides whether the address is taken. Among five family members, being
  able to ask is worth more than that concealment — but it is a trade, and it
  is the reason the page says "private" rather than "not found".
- **Only the owner answers an access request.** Administrators run the
  deployment; that is not the same as owning the money.
