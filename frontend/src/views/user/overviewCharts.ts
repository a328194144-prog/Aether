import type { UsageRecord } from '@/api/usage'

type CostRecord = Pick<UsageRecord, 'created_at' | 'model' | 'billing_cost' | 'cost' | 'usage_pricing_available'>
const pad = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

function calendar(days: number, now: Date) {
  const count = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0
  return Array.from({ length: count }, (_, index) => {
    // Calendar arithmetic preserves local days across daylight-saving changes.
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - count + 1 + index)
    return { date: dateKey(date), label: `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`, total: 0 }
  })
}

function pricedRecords(records: readonly CostRecord[], dates: Set<string>) {
  return records.flatMap(record => {
    const date = dateKey(new Date(record.created_at))
    const cost = record.billing_cost ?? record.cost
    return record.usage_pricing_available !== false && cost != null && Number.isFinite(cost) && dates.has(date)
      ? [{ date, model: record.model, cost }]
      : []
  })
}

export function aggregateDailyCost(records: readonly CostRecord[], days = 14, now = new Date()) {
  const result = calendar(days, now)
  const byDate = new Map(result.map(day => [day.date, day]))
  for (const record of pricedRecords(records, new Set(byDate.keys()))) {
    byDate.get(record.date)!.total += record.cost
  }
  return result
}

export function aggregateModelShare(records: readonly CostRecord[], days = 14, now = new Date()) {
  const totals = new Map<string, number>()
  for (const record of pricedRecords(records, new Set(calendar(days, now).map(day => day.date)))) {
    totals.set(record.model, (totals.get(record.model) ?? 0) + record.cost)
  }
  const sorted = [...totals].map(([model, total]) => ({ model, total, other: false }))
    .filter(item => item.total > 0).sort((a, b) => b.total - a.total)
  const total = sorted.reduce((sum, item) => sum + item.total, 0)
  const result = sorted.slice(0, 5)
  if (sorted.length > 5) {
    // The flag distinguishes the translated bucket from actual model names.
    result.push({ model: 'overview.other', other: true, total: sorted.slice(5).reduce((sum, item) => sum + item.total, 0) })
  }
  return result.map(item => ({ ...item, pct: item.total / total * 100 }))
}
