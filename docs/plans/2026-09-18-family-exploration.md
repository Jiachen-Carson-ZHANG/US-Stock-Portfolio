# Family exploration implementation plan

**Goal:** Correct portfolio history and reporting, then deliver the approved family interaction and analysis features.

**Architecture:** Keep the existing Next.js server/client boundary and SQLite storage. All mutations authenticate on the server; identity comes from the session. Family activities and virtual money stay separate from brokerage records. New bilingual views reuse the existing design tokens. Unknown financial inputs produce explicit unavailable states, never invented returns.

**Tech stack:** Next.js 16, React 19, TypeScript, SQLite, Zod, Recharts, Vitest, Playwright.

## 1. Family Room (delegated independent implementation)
- Create `src/lib/family/`, `src/components/family/`, `src/app/(app)/family/page.tsx`, `src/app/api/family/route.ts`, and `src/tests/family.test.ts`.
- Own schema in `src/lib/family/schema.ts`, invoked from the family repository, without modifying core DB schema.
- Persistent holding/general discussions, replies, reactions, unread state; weekly company nominations and one vote per member; date-locked prediction time capsules; shared savings goals with separately recorded contributions; fixed-period virtual stock portfolio challenge with equal imaginary starting balance and benchmarkable results. Include short learning quiz.
- Tests first for identity/permissions, duplicates, locks, savings totals and virtual cash limits; then repository, API and responsive bilingual UI. Open access uses the existing Family identity, with an honest note that individual participation needs password mode.
- Do not touch navigation, watchlist, performance, or core DB files; root integrates those.

## 2. Financial correctness and analysis (root)
- Regression tests for newest 400 snapshots, cash-flow-neutral returns, missing-day statistics, preserved watchlist authors and payoff calculations.
- Add validated owner cash-flow ledger and reviewed-history start date; unknown historical flows must not be silently treated as zero.
- Newest snapshots in chronological order. Scheduled authenticated capture endpoint with stale-data checks; document external scheduler setup.
- Bilingual performance explorer: period filters, return index, monthly calendar, value-change waterfall, imported total-return benchmark comparison and historical USD/CNY decomposition. Owner can enter/import the required dated inputs through the interface; invalid/unmatched data is not plotted.
- Options expiration payoff explorer with per-leg premium inputs and fees, using same-expiry/underlying groups only.

## 3. Integration and reliability (root)
- Preserve watchlist original notes and authors; append later member contributions. Handle request failures and pending state consistently.
- Refresh concentration with live data. Add Family Room links/navigation and holding discussion links. Weekly postcard from verified stored snapshots and owner-written notes.
- Update README and environment example for actual features, security mode and scheduler; retain existing environment secrets untouched.

## 4. Verification and review
- Run focused regression tests after each task, full Vitest, TypeScript, lint and production build.
- Add desktop/mobile Playwright coverage of family mutations, performance data entry, error handling and route authorization using only isolated test databases.
- Review final diff for spec compliance, security, correctness, accessibility and regressions; fix findings and rerun affected checks.

## Completion checkpoint

Implemented all four work streams. Review findings were resolved: source-currency
labels, pre-close snapshot rejection, and reverse-proxy origin validation.
Ended paper challenges are explicitly last-observed valuations, not final close
settlements. Cash-flow timing uses the documented end-of-day convention.

Validation: full 175-test unit suite passed; the later proxy regression and
related route tests passed (20 focused tests). All 44 desktop/mobile browser
checks passed; all 10 enrichment/family checks passed again on the final
production build. TypeScript, ESLint and diff whitespace checks passed.

Operational setup remains explicit: individual family identity requires password
mode; benchmark/FX data are imported through the owner UI; unattended snapshots
require a host scheduler and SNAPSHOT_CRON_SECRET. No deployment or real broker
order was performed. Existing environment secrets were not edited.
