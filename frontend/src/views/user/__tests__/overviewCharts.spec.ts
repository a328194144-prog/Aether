import { describe, expect, it } from 'vitest'
import { aggregateDailyCost, aggregateModelShare } from '../overviewCharts'

const now = new Date(2026, 10, 2, 12)
const record = (created_at: string, cost = 1, model = 'a') => ({ created_at, cost, model })

describe('overview chart aggregation', () => {
  it('buckets by local midnight, pads zero days and excludes dates outside the window', () => {
    const records = [
      record(new Date(2026, 10, 1, 23, 59).toISOString(), 2),
      record(new Date(2026, 10, 2, 0, 1).toISOString(), 3),
      record(new Date(2026, 9, 30).toISOString(), 99),
      record(new Date(2026, 10, 3).toISOString(), 99),
      record('invalid', 99),
    ]
    expect(aggregateDailyCost(records, 3, now)).toEqual([
      { date: '2026-10-31', label: '10/31', total: 0 },
      { date: '2026-11-01', label: '11/01', total: 2 },
      { date: '2026-11-02', label: '11/02', total: 3 },
    ])
    expect(aggregateModelShare(records, 3, now)[0]?.total).toBe(5)
  })

  it('uses billing cost including zero, skips unavailable, missing and nonfinite costs', () => {
    const base = record(now.toISOString(), 9)
    const records = [
      { ...base, billing_cost: 2 },
      { ...base, billing_cost: 0 },
      { ...base, billing_cost: null, cost: 3 },
      { ...base, usage_pricing_available: false },
      { ...base, cost: undefined },
      { ...base, cost: NaN },
    ]
    expect(aggregateDailyCost(records, 1, now)[0]?.total).toBe(5)
    expect(aggregateModelShare(records, 1, now)).toEqual([{ model: 'a', other: false, total: 5, pct: 100 }])
  })

  it('sorts models and merges the sixth onward with percentages of the full total', () => {
    const records = [1, 2, 3, 4, 5, 6, 7].map(cost => record(now.toISOString(), cost, `m${cost}`))
    const result = aggregateModelShare(records, 14, now)
    expect(result.map(item => item.model)).toEqual(['m7', 'm6', 'm5', 'm4', 'm3', 'overview.other'])
    expect(result[5]).toEqual({ model: 'overview.other', other: true, total: 3, pct: 3 / 28 * 100 })
    expect(result.reduce((sum, item) => sum + item.pct, 0)).toBeCloseTo(100)
    expect(aggregateModelShare(records.slice(0, 5), 14, now)).toHaveLength(5)
  })

  it('returns zero-filled days and no shares for no spending', () => {
    expect(aggregateDailyCost([], 14, now)).toHaveLength(14)
    expect(aggregateDailyCost([], 14, now).every(day => day.total === 0)).toBe(true)
    expect(aggregateModelShare([record(now.toISOString(), 0)], 14, now)).toEqual([])
  })
})
