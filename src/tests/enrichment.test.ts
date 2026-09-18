import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/db';
import { readSnapshots, writeSnapshot, maybeCreateSnapshot } from '@/lib/portfolio/snapshots';
import { addToWatchlist, readWatchlist } from '@/lib/watchlist';
import { adjustedSeries, analysisStats, fxDecomposition, expirationPayoff } from '@/lib/analysis/math';
import { analysisInputSchema } from '@/lib/analysis/store';
import type { PortfolioSnapshot, PortfolioSummary } from '@/types/portfolio';
const snap = (date: string, value: number): PortfolioSnapshot => ({ snapshotDate:date, totalMarketValue:String(value), totalCost:'100', totalUnrealizedPnL:'0', cashValue:'0' });
const review = { from:'2026-09-01', to:'2026-09-30' };
describe('trustworthy analysis', () => {
  it('does not mistake a deposit for investment profit', () => {
    const result = adjustedSeries([snap('2026-09-14',100),snap('2026-09-15',160)], [{date:'2026-09-15',amount:50}], review);
    expect(result.points[1].index).toBeCloseTo(110);
    expect(result.gain).toBeCloseTo(10);
  });
  it('does not publish returns before cash flows are reviewed', () => {
    expect(adjustedSeries([snap('2026-09-14',100),snap('2026-09-15',160)],[],null).points).toEqual([]);
  });
  it('does not turn a multiday gap into a best day or daily volatility', () => {
    const result = adjustedSeries([snap('2026-09-14',100),snap('2026-09-16',110),snap('2026-09-17',112)],[],review);
    expect(analysisStats(result).bestDayPercent).toBeNull();
    expect(analysisStats(result).annualisedVolatilityPercent).toBeNull();
  });
  it('withholds a return if a cash flow has no matching closing valuation', () => {
    expect(adjustedSeries([snap('2026-09-14',100),snap('2026-09-16',160)],[{date:'2026-09-15',amount:50}],review).points).toEqual([]);
  });
  it('decomposes USD and FX effects without losing the cross term', () => {
    const result=fxDecomposition(100,110,7,7.2);
    expect(result.total).toBeCloseTo(92);
    expect(result.investment+result.currency).toBeCloseTo(result.total);
  });
  it('calculates a debit call spread payoff and fees', () => {
    const legs=[{type:'call' as const,strike:100,premium:8,quantity:1,multiplier:100},{type:'call' as const,strike:110,premium:3,quantity:-1,multiplier:100}];
    expect(expirationPayoff(legs,120,4)).toBe(496);
    expect(expirationPayoff(legs,90,4)).toBe(-504);
  });
  it('rejects invalid dates and negative FX rates', () => {
    expect(analysisInputSchema.safeParse({action:'flow',date:'2026-02-30',amount:100,note:''}).success).toBe(false);
    expect(analysisInputSchema.safeParse({action:'observations',kind:'fx',source:'test',rows:[{date:'2026-09-14',value:-1}]}).success).toBe(false);
  });
});
describe('history and collaboration regressions', () => {
  it('returns newest snapshots in chronological order', () => {
    const db=createTestDb();
    const summary={totalMarketValue:{amount:'100',currency:'USD'},totalCostBasis:{amount:'100',currency:'USD'},totalUnrealizedPnL:{amount:'0',currency:'USD'},cashValue:{amount:'0',currency:'USD'}};
    for(const date of ['2026-09-14','2026-09-15','2026-09-16']) writeSnapshot(db,date,summary,'[]');
    expect(readSnapshots(db,2).map(s=>s.snapshotDate)).toEqual(['2026-09-15','2026-09-16']);
    db.close();
  });
  it('does not capture stale or previous-day data as today', () => {
    const db=createTestDb();
    expect(maybeCreateSnapshot(db,{isStale:true} as PortfolioSummary,'[]',new Date('2026-09-15T21:00:00Z'))).toBe(false);
    db.close();
  });
  it('preserves the original note and appends another member contribution', () => {
    const db=createTestDb();
    addToWatchlist(db,{symbol:'AAPL',reason:'Original idea',addedBy:'Father'});
    addToWatchlist(db,{symbol:'aapl',reason:'Another view',addedBy:'Mother'});
    const entry=readWatchlist(db)[0];
    expect(entry.addedBy).toBe('Father');
    expect(entry.reason).toBe('Original idea');
    expect(entry.notes).toEqual(expect.arrayContaining([expect.objectContaining({author:'Mother',body:'Another view'})]));
    db.close();
  });
});
