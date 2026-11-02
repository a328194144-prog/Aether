import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import MyOverview from '../MyOverview.vue'
import { walletApi } from '@/api/wallet'
import { billingApi } from '@/api/billing'
import { usageApi } from '@/api/usage'
import { createI18n, setI18nLocale } from '@/i18n'
import { dashboardRoutes } from '@/router/routes/dashboard'

vi.mock('@/api/wallet', () => ({ walletApi: { getBalance: vi.fn(), getTodayCost: vi.fn(), getTransactions: vi.fn() } }))
vi.mock('@/api/billing', () => ({ billingApi: { listPlans: vi.fn(), listEntitlements: vi.fn() } }))
vi.mock('@/api/usage', () => ({ usageApi: { getUsageRecords: vi.fn() } }))

let app: App
let root: HTMLElement
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
function mount() {
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(MyOverview)
  app.use(createI18n())
  app.component('RouterLink', defineComponent({
    props: ['to'],
    setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
  }))
  app.mount(root)
}

beforeEach(() => {
  setI18nLocale('zh-CN')
  vi.resetAllMocks()
  vi.mocked(walletApi.getBalance).mockResolvedValue({ wallet: null, balance: null } as Awaited<ReturnType<typeof walletApi.getBalance>>)
  vi.mocked(walletApi.getTodayCost).mockResolvedValue({ total_cost: 2 } as Awaited<ReturnType<typeof walletApi.getTodayCost>>)
  vi.mocked(walletApi.getTransactions).mockResolvedValue({ items: [] } as unknown as Awaited<ReturnType<typeof walletApi.getTransactions>>)
  vi.mocked(billingApi.listPlans).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(billingApi.listEntitlements).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(usageApi.getUsageRecords).mockResolvedValue({ records: [], total: 0, page: 1, page_size: 10 })
})
afterEach(() => {
  app?.unmount()
  root?.remove()
})

describe('MyOverview', () => {
  it('loads four sections independently and keeps detail links in empty states', async () => {
    mount()
    expect(root.querySelectorAll('[data-section]')).toHaveLength(4)
    await flush()
    expect(root.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(root.querySelector('a[href="/dashboard/usage"]')).not.toBeNull()
    expect(root.querySelector('a[href="/dashboard/wallet"]')).not.toBeNull()
    expect(usageApi.getUsageRecords).toHaveBeenCalledWith({ page: 1, page_size: 10 })
    expect(walletApi.getTransactions).toHaveBeenCalledWith({ limit: 8, offset: 0 })
  })

  it('allows a failed section to retry without refetching other sections', async () => {
    vi.mocked(walletApi.getTransactions).mockRejectedValueOnce(new Error('offline'))
    mount()
    await flush()
    const retry = root.querySelector<HTMLButtonElement>('[data-section="bills"] button')
    expect(retry).not.toBeNull()
    retry!.click()
    await flush()
    expect(walletApi.getTransactions).toHaveBeenCalledTimes(2)
    expect(usageApi.getUsageRecords).toHaveBeenCalledTimes(1)
    expect(root.querySelector('[data-section="bills"] button')).toBeNull()
  })

  it('keeps other sections usable while the wallet is loading', async () => {
    vi.mocked(walletApi.getBalance).mockReturnValue(new Promise(() => {}))
    mount()
    await flush()
    expect(root.querySelector('[data-section="balance"]')?.textContent).toContain('加载')
    expect(root.querySelector('[data-section="plans"]')?.textContent).toContain('暂无生效套餐')
    expect(root.querySelector('[data-section="usage"]')?.textContent).toContain('暂无记录')
  })

  it('renders failures in all four sections without displaying zero balances', async () => {
    vi.mocked(walletApi.getBalance).mockRejectedValue(new Error('offline'))
    vi.mocked(billingApi.listEntitlements).mockRejectedValue(new Error('offline'))
    vi.mocked(usageApi.getUsageRecords).mockRejectedValue(new Error('offline'))
    vi.mocked(walletApi.getTransactions).mockRejectedValue(new Error('offline'))
    mount()
    await flush()
    expect(root.querySelectorAll('[data-section] button')).toHaveLength(4)
    expect(root.textContent).not.toContain('$0')
  })

  it('shows real usage costs and wallet snapshots but leaves missing costs unknown', async () => {
    vi.mocked(usageApi.getUsageRecords).mockResolvedValue({
      records: [
        { id: 'one', model: 'model-one', created_at: '2026-11-01T00:00:00Z', total_tokens: 123, billing_cost: 1.25, cost: 9 },
        { id: 'two', model: 'model-two', total_tokens: 0, usage_available: false },
      ],
      total: 2, page: 1, page_size: 10,
    } as Awaited<ReturnType<typeof usageApi.getUsageRecords>>)
    vi.mocked(walletApi.getTransactions).mockResolvedValue({
      items: [{ id: 'tx', category: 'recharge', amount: 10, balance_before: 2, balance_after: 12 }],
    } as Awaited<ReturnType<typeof walletApi.getTransactions>>)
    mount()
    await flush()
    const rows = root.querySelectorAll('[data-section="usage"] tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('$1.25')
    expect(rows[0]?.textContent).not.toContain('$9')
    expect(rows[1]?.querySelectorAll('td')[3]?.textContent).toBe('-')
    expect(root.querySelector('[data-section="bills"] tbody')?.textContent).toContain('$2.00')
    expect(root.querySelector('[data-section="bills"] tbody')?.textContent).toContain('$12.00')
  })

  it('shows active benefits, one account daily progress bar, and no invented weekly usage', async () => {
    vi.mocked(walletApi.getBalance).mockResolvedValue({
      balance: 12, wallet_balance: 12,
      daily_quota: { has_active: true, total_usd: 10, used_usd: 3, remaining_usd: 7 },
    } as Awaited<ReturnType<typeof walletApi.getBalance>>)
    vi.mocked(billingApi.listEntitlements).mockResolvedValue({
      items: [
        { id: 'daily', plan_id: 'daily-plan', status: 'active', entitlements: [{ type: 'daily_quota', daily_quota_usd: 10 }] },
        { id: 'weekly', plan_id: 'weekly-plan', status: 'active', entitlements: [{ type: 'usage_policy', rules: [{ metric: 'actual_cost_usd', window: { kind: 'calendar_week' }, limit: 50 }] }] },
        { id: 'expired', plan_id: 'expired-plan', status: 'active', expires_at: '2000-01-01', entitlements: [] },
        { id: 'inactive', plan_id: 'inactive-plan', status: 'active', active: false, entitlements: [] },
      ],
      total: 4,
    } as unknown as Awaited<ReturnType<typeof billingApi.listEntitlements>>)
    mount()
    await flush()
    expect(root.textContent).toContain('daily-plan')
    expect(root.textContent).toContain('weekly-plan')
    expect(root.textContent).not.toContain('expired-plan')
    expect(root.textContent).not.toContain('inactive-plan')
    expect(root.querySelectorAll('progress')).toHaveLength(1)
    expect(root.querySelector('progress')?.value).toBe(30)
    expect(root.textContent).toContain('$50')
    expect(root.textContent).toContain('$2')
  })

  it('retains all hidden destinations and the Dashboard route name', () => {
    const children = dashboardRoutes[0]?.children ?? []
    expect(children.find(route => route.path === '')?.name).toBe('Dashboard')
    for (const path of ['endpoint-status', 'models', 'vscodex', 'referral']) {
      expect(children.some(route => route.path === path)).toBe(true)
    }
  })
})
