# Family Portfolio Dashboard

## Design & Implementation Specification

**Version:** 1.0
**Date:** 2026-09-18
**Deployment targets:** Vercel / EdgeOne
**Secondary optional deployment target:** Vercel
**Broker:** Moomoo
**Users:** Owner + three family viewers

---

# 1. Product Definition

Build a private, read-only web dashboard that displays the owner's US-stock and options portfolio to four authorized family members.

The application exists only to:

* display current holdings;
* display factual portfolio information;
* display current or recent market prices;
* calculate factual P&L and portfolio statistics;
* visualize portfolio composition and historical performance;
* allow the owner to synchronize holdings from Moomoo.

The application must **not**:

* execute trades;
* contain buy/sell buttons;
* recommend securities;
* produce “buy / hold / sell” labels;
* generate investment recommendations;
* rank investments;
* predict what the owner should do;
* provide copy-trading functionality;
* allow public registration;
* expose the portfolio publicly.

This is a private family portfolio viewer, not a financial-advice product.

---

# 2. Users and Roles

There are exactly four expected users.

## OWNER

The owner can:

* view all portfolio information;
* connect/reconnect Moomoo;
* trigger portfolio synchronization;
* view data-source status;
* manage viewer accounts;
* revoke viewer sessions;
* change viewer passwords;
* view synchronization errors.

The owner cannot execute trades through this application.

## VIEWER

Viewer accounts are intended for family members.

Viewers can:

* view the dashboard;
* view holdings;
* view portfolio charts;
* view historical performance;
* inspect factual statistics.

Viewers cannot:

* connect Moomoo;
* change holdings;
* change broker credentials;
* modify portfolio information;
* trigger trades;
* access administrative settings.

No self-registration should exist.

---

# 3. Authentication Model

Do not use Google, GitHub, Facebook, or other external authentication providers.

The site must remain usable from mainland China.

Create four local accounts:

```text
owner
father
mother
wife
```

Do not hard-code plaintext passwords.

Passwords must be hashed with:

```text
Argon2id
```

or, if unavailable:

```text
bcrypt
```

Sessions must use:

```text
HttpOnly
Secure
SameSite=Lax
```

cookies.

Recommended session lifetime:

```text
30 days
```

because the users are trusted family members and frequent re-login would create unnecessary friction.

Provide logout and owner-controlled session revocation.

Add login rate limiting.

Example:

```text
5 failed attempts
→ temporary cooldown
```

There must be no `/signup` route.

---

# 4. Privacy Requirement

The application's URL may be publicly reachable, but portfolio data must be private.

Unauthenticated users may access only:

```text
/login
/api/auth/login
```

All portfolio routes and all portfolio APIs must require an authenticated session.

For example:

```text
/dashboard
/holdings
/performance
/api/portfolio/*
/api/quotes/*
/api/broker/*
```

must reject unauthenticated users.

Never rely only on frontend hiding.

This is forbidden:

```javascript
if (!loggedIn) {
  hidePortfolio();
}
```

if the portfolio data was already returned to the browser.

Authorization must occur server-side before portfolio information is returned.

Add:

```html
<meta name="robots" content="noindex,nofollow">
```

and equivalent `robots.txt` rules.

---

# 5. Deployment Strategy

Deploy the shared GitHub repository to Vercel or EdgeOne, using a Node.js
runtime and PostgreSQL. Keep platform-specific configuration separate from
business logic and verify connectivity from mainland China and Singapore.

Use the same codebase for each deployment; do not fork it by platform.
Configure each deployment's public origin and register its broker callback.

---

# 6. Custom Domain

Do not make a custom domain a V1 requirement.

Use:

```text
your-project.vercel.app
```

first.

A custom mainland-hosted domain introduces ICP-related deployment considerations.

Only introduce:

```text
portfolio.example.com
```

after the application is stable and there is a real reason to do so.

---

# 7. Technology Stack

Preferred stack:

```text
Next.js
TypeScript
React
Tailwind CSS
shadcn/ui
Recharts
Zod
```

Use standard Node.js-compatible APIs.

Avoid platform-specific dependencies.

Do not rely on:

```text
Vercel KV
Vercel Edge Config
Vercel-only middleware behavior
Vercel-only serverless APIs
```

The project must remain deployable outside Vercel.

Suggested package manager:

```text
pnpm
```

Alternative:

```text
npm
```

---

# 8. Architecture

High-level architecture:

```text
             ┌─────────────────────┐
             │       Browser       │
             │                     │
             │ China / Singapore   │
             └──────────┬──────────┘
                        │
                       HTTPS
                        │
                        ▼
             ┌─────────────────────┐
             │     Web App         │
             │                     │
             │ Next.js / Node.js   │
             └──────────┬──────────┘
                        │
             authenticated server
                        │
       ┌────────────────┼────────────────┐
       │                │                │
       ▼                ▼                ▼
 Authentication     Portfolio DB     Data Providers
                                         │
                               ┌─────────┴─────────┐
                               ▼                   ▼
                         Moomoo Broker       Market Data
                           Provider           Provider
```

Important architecture rule:

```text
Broker data != market data
```

They must use separate interfaces.

---

# 9. Provider Abstraction

Implement:

```typescript
interface BrokerProvider {
  getAccounts(): Promise<BrokerAccount[]>;
  getPositions(): Promise<BrokerPosition[]>;
  getAccountSummary(): Promise<AccountSummary>;
}
```

Initial implementation:

```text
MoomooBrokerProvider
```

Also implement:

```typescript
interface MarketDataProvider {
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getHistoricalPrices(
    symbol: string,
    range: DateRange
  ): Promise<HistoricalPrice[]>;
}
```

Initial implementation may use Moomoo.

However, the rest of the application must not know that Moomoo supplies market data.

Changing provider later should require changing only:

```text
providers/market-data/*
```

rather than rewriting the dashboard.

---

# 10. Moomoo Integration

Use Moomoo OpenAPI.

API base:

```text
https://webapi.moomoo.com
```

Use OAuth 2.1 + PKCE.

Requested scopes must be limited to:

```text
trade:read
quote:read
```

Do NOT request:

```text
trade:write
quote:write
```

unless a future specification explicitly requires it.

Trading functionality is prohibited.

---

# 11. Moomoo OAuth Flow

Owner-only process:

```text
Settings
   ↓
Connect Moomoo
   ↓
Generate PKCE verifier/challenge
   ↓
Moomoo authorization
   ↓
Owner approves read-only scopes
   ↓
Callback
   ↓
Exchange authorization code
   ↓
Receive access_token + refresh_token
   ↓
Store securely
```

Access tokens expire relatively quickly and must be refreshed server-side.

The browser must never receive the Moomoo refresh token.

Never expose Moomoo tokens through:

```text
localStorage
sessionStorage
frontend environment variables
HTML
client-side JavaScript
logs
error pages
```

---

# 12. Token Storage

OAuth tokens must be encrypted at rest.

Preferred pattern:

```text
refresh token
     ↓
AES-256-GCM encryption
     ↓
ciphertext stored in DB
```

The encryption key should be provided as a server-side deployment secret.

Store:

```text
encrypted_refresh_token
iv
auth_tag
authorized_scopes
created_at
updated_at
```

Access token may be cached server-side because it is short-lived.

Never log:

```text
access_token
refresh_token
authorization header
broker account number
```

---

# 13. Portfolio Data Model

Recommended normalized position model:

```typescript
type Position = {
  id: string;

  broker: "moomoo";

  instrumentType:
    | "stock"
    | "etf"
    | "option"
    | "cash"
    | "other";

  symbol: string;
  underlyingSymbol?: string;

  name?: string;

  quantity: number;

  averageCost?: number;
  currentPrice?: number;

  marketValue?: number;

  unrealizedPnL?: number;
  unrealizedPnLPercent?: number;

  currency: string;

  // options only
  optionType?: "call" | "put";
  strike?: number;
  expirationDate?: string;
  contractMultiplier?: number;

  lastUpdatedAt: string;
};
```

Never use floating-point arithmetic for financial totals when avoidable.

Use:

```text
decimal.js
```

or an equivalent decimal arithmetic library.

---

# 14. Database Tables

Suggested logical schema:

## users

```text
id
username
display_name
password_hash
role
created_at
disabled_at
```

## sessions

```text
id
user_id
token_hash
created_at
expires_at
last_seen_at
revoked_at
```

## broker_connections

```text
id
provider
encrypted_refresh_token
iv
auth_tag
scope
connected_at
last_refresh_at
status
```

## positions

```text
id
broker
instrument_type
symbol
underlying_symbol
name
quantity
average_cost
currency
option_type
strike
expiration_date
contract_multiplier
synced_at
```

## quote_cache

```text
symbol
price
previous_close
change
change_percent
market_status
data_timestamp
source
cached_at
```

## portfolio_snapshots

```text
id
snapshot_date
total_market_value
total_cost
total_unrealized_pnl
cash_value
positions_json
created_at
```

For this project, extreme database normalization is unnecessary.

Prioritize maintainability.

---

# 15. Refresh Strategy

Do not start with WebSocket streaming.

The portfolio is viewed by four people.

REST polling is simpler and sufficient.

Recommended quote refresh:

```text
US market open:
15–30 seconds

US market closed:
2–5 minutes
```

When browser tab becomes hidden:

```text
pause aggressive polling
```

When tab becomes visible again:

```text
refresh immediately
```

Positions do not need 15-second synchronization.

Recommended broker-position refresh:

```text
manual owner refresh

and/or

every 60–120 seconds while dashboard is active
```

Market quote requests must be cached server-side.

Example:

```text
Dad opens dashboard
Mom opens dashboard 2 seconds later

→ second request uses quote cache
→ do not call Moomoo twice
```

---

# 16. Dashboard

Primary route:

```text
/dashboard
```

The first screen should answer:

```text
How much is the portfolio worth?

How much did it move today?

What are the major positions?

Where is the portfolio concentrated?
```

Recommended top cards:

```text
Total Portfolio Value

Today's P&L

Total Unrealized P&L

Total Cost Basis
```

Example:

```text
Portfolio Value
$125,482.30

Today
+$2,106.42
+1.71%

Unrealized P&L
+$18,441.20
+17.23%
```

Do not show investment recommendations.

---

# 17. Holdings Table

Columns:

```text
Symbol
Name
Type
Quantity
Average Cost
Current Price
Market Value
Today %
Unrealized P&L
Portfolio Weight
```

Desktop view may show all columns.

Mobile view should prioritize:

```text
Symbol
Market Value
Daily Change
Total P&L
```

Rows should be expandable.

---

# 18. Position Detail

Route:

```text
/holdings/[symbol]
```

Show factual information only.

For stocks:

```text
Current price
Previous close
Quantity
Average cost
Market value
Unrealized P&L
Portfolio weight
Historical price chart
Position-value history
```

For options:

```text
Underlying
Call / Put
Strike
Expiration
Quantity
Multiplier
Average cost
Current contract price
Market value
Unrealized P&L
Days to expiration
```

If Greeks are available from the selected market-data source, factual Greeks may be shown:

```text
Delta
Gamma
Theta
Vega
IV
```

Do not convert these into a recommendation.

---

# 19. Visualizations

Implement the following charts.

## Portfolio Allocation

Donut chart:

```text
position market value / total portfolio value
```

## Asset Type

Example:

```text
Stocks
ETFs
Options
Cash
```

## Sector Allocation

Only if factual sector metadata is available.

## Daily Change Contribution

Show:

```text
how much each position contributed to today's portfolio P&L
```

## Portfolio Historical Value

Line chart:

```text
date
portfolio value
```

## Unrealized P&L by Position

Horizontal bar chart.

## Concentration

Show factual statistics such as:

```text
Top 1 holding %
Top 3 holdings %
Top 5 holdings %
```

Do not label concentration as:

```text
good
bad
safe
dangerous
```

---

# 20. Additional Factual Analytics

Allowed analytics include:

```text
Total return
Daily return
Position-level return
Portfolio weights
Sector weights
Cash percentage
Realized P&L if available
Unrealized P&L
Historical volatility
Maximum drawdown
Beta
Correlation
Dividend income
Option exposure
Currency exposure
```

These should be described factually.

Example:

```text
Top 3 positions represent 54.2% of portfolio market value.
```

Not:

```text
Your portfolio is too concentrated.
```

---

# 21. Historical Portfolio Tracking

Moomoo may provide account history, but the application should also maintain its own daily portfolio snapshots.

Once per trading day record:

```text
date
total value
cash
positions
prices
```

The application should tolerate missing days.

For V1, snapshots may be created:

```text
on first authenticated dashboard request after US market close
```

This avoids dependence on platform-specific cron jobs.

Later, an authenticated cron endpoint can be added:

```text
POST /api/internal/snapshot
Authorization: Bearer CRON_SECRET
```

---

# 22. Market Status

Dashboard must indicate whether data correspond to:

```text
Pre-market
Regular market
After-hours
Market closed
```

Every quote should contain:

```text
data timestamp
```

The UI should show:

```text
Last updated: 14:32:15
```

Never make stale data appear live.

---

# 23. Currency

Use USD as primary display currency initially.

Architecture must allow future FX conversion.

Do not assume every asset is permanently USD-denominated.

Example model:

```typescript
Money {
  amount: Decimal;
  currency: string;
}
```

---

# 24. Responsive Design

Primary usage devices are likely:

```text
phone
tablet
desktop
```

The dashboard must be mobile-first.

Parents should not need to horizontally scroll large tables.

Use cards on small screens.

Use responsive tables on desktop.

Minimum touch target:

```text
44px
```

Text should be comfortably readable.

Avoid excessively dense trading-terminal design.

---

# 25. Visual Design

Preferred aesthetic:

```text
minimal
premium
financial
calm
high information density without clutter
```

Use either:

```text
light default + optional dark mode
```

or:

```text
dark default
```

but maintain strong contrast.

Recommended layout:

```text
Sidebar / bottom nav

Overview
Holdings
Performance
Settings
```

Use green/red only for factual positive/negative numbers.

Do not overuse color.

Charts should support tooltip inspection.

---

# 26. China Accessibility Constraints

Do not load critical frontend resources from services that may be unavailable in mainland China.

Avoid runtime dependency on:

```text
Google Fonts
Google Analytics
Google Tag Manager
Firebase client SDK
reCAPTCHA
YouTube
unpkg CDN
jsDelivr CDN
```

Bundle fonts and JavaScript locally.

Use system font fallback where practical.

Example:

```css
font-family:
  Inter,
  "PingFang SC",
  "Microsoft YaHei",
  system-ui,
  sans-serif;
```

Do not use Google Fonts remotely.

All core CSS and JS should ship with the application.

---

# 27. Performance

Initial dashboard target:

```text
First Contentful Paint < 2.5 seconds
```

under a normal mainland-China broadband connection against the production deployment.

Avoid loading every historical chart before rendering the dashboard.

Loading sequence:

```text
auth
↓
portfolio summary
↓
holdings
↓
charts
↓
non-critical historical data
```

Use skeleton loaders.

---

# 28. Failure Handling

If Moomoo API is unavailable:

show:

```text
Live data temporarily unavailable.
Showing data last updated at 14:21.
```

Do not blank the entire dashboard.

Use last known position and quote cache.

If a token expires permanently:

owner sees:

```text
Moomoo authorization expired.
Reconnect account.
```

Viewers see:

```text
Portfolio data is temporarily unavailable.
```

They should never see OAuth implementation details.

---

# 29. Security Requirements

Mandatory:

```text
HTTPS only
HttpOnly cookies
CSRF protection where appropriate
rate-limited login
server-side authorization
password hashing
encrypted OAuth token
no secrets in client bundle
no sensitive data in logs
security headers
input validation
```

Use Zod for request validation.

Set:

```text
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

Do not expose detailed stack traces in production.

---

# 30. Logging

Log:

```text
authentication success/failure
broker sync success/failure
quote-provider error
token refresh result
snapshot creation
```

Do not log:

```text
password
OAuth token
session token
full brokerage account number
Authorization headers
```

---

# 31. API Routes

Suggested API structure:

```text
POST /api/auth/login
POST /api/auth/logout

GET  /api/me

GET  /api/portfolio/summary
GET  /api/portfolio/positions
GET  /api/portfolio/history

GET  /api/positions/:symbol

POST /api/broker/moomoo/connect
GET  /api/broker/moomoo/callback
POST /api/broker/moomoo/sync
POST /api/broker/moomoo/disconnect

GET  /api/market/quotes
GET  /api/market/history/:symbol

GET  /api/admin/users
POST /api/admin/users/:id/revoke-sessions
```

Admin/broker mutation endpoints:

```text
owner only
```

---

# 32. Suggested Repository Structure

```text
src/
  app/
    login/
    dashboard/
    holdings/
    holdings/[symbol]/
    performance/
    settings/

    api/
      auth/
      portfolio/
      broker/
      market/
      admin/

  components/
    dashboard/
    charts/
    holdings/
    layout/
    ui/

  lib/
    auth/
    db/
    crypto/
    money/
    portfolio/
    market-hours/

  providers/
    broker/
      types.ts
      moomoo.ts

    market-data/
      types.ts
      moomoo.ts

  types/
    portfolio.ts
    broker.ts
    market.ts

  tests/
```

---

# 33. Environment Configuration

Example `.env.example`:

```text
APP_URL=

SESSION_SECRET=
TOKEN_ENCRYPTION_KEY=

DATABASE_URL=

MOOMOO_CLIENT_ID=

PORTFOLIO_BASE_CURRENCY=USD

QUOTE_CACHE_SECONDS=15
POSITION_CACHE_SECONDS=60
```

Do not commit real secrets.

Do not put:

```text
MOOMOO_ACCESS_TOKEN
MOOMOO_REFRESH_TOKEN
```

into frontend environment variables.

---

# 34. Development Modes

Implement a mock provider.

Environment option:

```text
DATA_PROVIDER=mock
```

Mock data should allow the entire UI to be developed without connecting a real brokerage account.

Example fake portfolio:

```text
AAPL
GOOGL
VST
RBLX
one call option
cash
```

Never use real personal holdings in automated tests.

Production:

```text
DATA_PROVIDER=moomoo
```

---

# 35. Testing

Required tests:

## Unit tests

```text
portfolio-value calculation
P&L calculation
portfolio weights
option multiplier
currency handling
OAuth token encryption
authorization checks
```

## Integration tests

```text
login
logout
unauthenticated access blocked
viewer cannot access admin routes
owner can access broker connection
mock Moomoo sync
token refresh
```

## End-to-end tests

Use Playwright.

Test:

```text
login
dashboard
holdings
position detail
mobile rendering
logout
```

---

# 36. China Testing

Before calling the deployment complete, test from an actual mainland-China connection.

At minimum:

```text
China Telecom
China Mobile or China Unicom
```

Test:

```text
DNS resolution
TLS connection
login
dashboard load
API calls
charts
Moomoo synchronization
```

Do not assume that successful Singapore testing proves mainland-China availability.

---

# 37. Implementation Phases

## Phase 1 — Foundation

Build:

```text
Next.js project
UI shell
authentication
roles
protected routes
mock provider
```

Acceptance criterion:

all four local accounts can log in and unauthorized users cannot access portfolio data.

---

## Phase 2 — Portfolio UI

Build:

```text
dashboard
portfolio cards
holdings table
position details
responsive mobile layout
charts
```

Use mock data only.

Acceptance criterion:

complete dashboard works without Moomoo.

---

## Phase 3 — Moomoo Broker Integration

Implement:

```text
OAuth 2.1 + PKCE
trade:read
quote:read
token encryption
access-token refresh
position synchronization
```

Do not implement trading endpoints.

Acceptance criterion:

owner can connect Moomoo and real holdings replace mock holdings.

---

## Phase 4 — Quote Layer

Implement:

```text
MarketDataProvider
quote caching
market-status awareness
polling
stale-data handling
timestamps
```

Acceptance criterion:

current prices update without excessive API requests.

---

## Phase 5 — Historical Data

Implement:

```text
daily snapshots
portfolio-value chart
daily P&L history
allocation history where available
```

---

## Phase 6 — Security Review

Verify:

```text
no unauthenticated data access
no client-side OAuth tokens
no plaintext passwords
no logs containing financial credentials
viewer cannot mutate data
trade:write absent
```

---

## Phase 7 — Deployment

Deploy the GitHub repository to the selected Node.js hosting platform.
Configure production secrets, PostgreSQL and the public origin, then register
the matching broker callback and test sign-in and mainland-China connectivity.

---

# 38. Additional Deployment

Deploy the same GitHub repository when adding another hosting endpoint.
Do not create a platform-specific code branch. Keep platform-specific code
isolated behind a deployment adapter.

---

# 39. Acceptance Criteria

The project is considered V1 complete when all conditions are true:

1. Four predefined users can authenticate.
2. No public registration exists.
3. Unauthenticated requests cannot retrieve portfolio data.
4. Viewer accounts are read-only.
5. Owner can connect Moomoo.
6. Only read scopes are requested.
7. The application cannot execute a trade.
8. Portfolio holdings synchronize successfully.
9. Portfolio value and P&L calculate correctly.
10. Quotes show their update timestamp.
11. Dashboard works well on a phone.
12. Historical portfolio snapshots are stored.
13. Charts display factual portfolio analytics.
14. Application works from a real mainland-China connection.
15. Secrets are absent from Git and client bundles.
16. The codebase remains portable across Node.js hosting platforms.

---

# 40. Hard Prohibitions for the Coding Agent

Do not add features outside this specification without explicit approval.

Specifically, do NOT add:

```text
AI stock recommendations
Buy/Sell/Hold
price targets
trade execution
trade:write
copy trading
social feeds
public portfolios
public registration
broker password collection
referral links
financial-product marketing
```

Do not replace server-side authentication with frontend-only route hiding.

Do not expose Moomoo tokens to the browser.

Do not use real portfolio credentials in tests.

---

# 41. Coding Priorities

When trade-offs exist, optimize in this order:

```text
1. Security
2. Correct financial calculations
3. Mainland-China accessibility
4. Reliability
5. Simplicity
6. User experience
7. Visual polish
8. Extensibility
```

Do not sacrifice correctness for animation or visual effects.

---

# 42. First Coding-Agent Task

The coding agent should begin with:

```text
Read this specification completely.

Create an implementation plan before modifying code.

Then scaffold the application with:

- Next.js
- TypeScript
- Tailwind
- shadcn/ui
- Zod
- decimal.js
- Recharts
- secure local authentication
- owner/viewer RBAC
- protected server-side routes
- mock BrokerProvider
- mock MarketDataProvider

Do not integrate Moomoo yet.

Build Phase 1 and Phase 2 first using synthetic portfolio data.

Create tests for authentication, authorization, portfolio arithmetic,
and protected API access.

Keep all broker-specific code behind provider interfaces.

Ensure the application contains no trading action and no recommendation
logic.

After Phase 1 and Phase 2 tests pass, stop and report:
1. architecture implemented,
2. routes created,
3. database schema,
4. tests passing,
5. unresolved deployment compatibility issues.
```

The next development iteration should then implement Moomoo OAuth and portfolio synchronization.
