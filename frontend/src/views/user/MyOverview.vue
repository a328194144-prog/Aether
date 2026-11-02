<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowRight, RefreshCw } from 'lucide-vue-next'
import { walletApi, type WalletBalanceResponse, type TodayCostResponse, type WalletTransaction } from '@/api/wallet'
import { billingApi, type BillingPlan, type UserPlanEntitlement } from '@/api/billing'
import { usageApi, type UsageRecord } from '@/api/usage'
import { CardSection, PageContainer, PageHeader } from '@/components/layout'
import { EmptyState, LoadingState } from '@/components/common'
import BarChart from '@/components/charts/BarChart.vue'
import DoughnutChart from '@/components/charts/DoughnutChart.vue'
import type { ChartOptions } from 'chart.js'
import { aggregateDailyCost, aggregateModelShare } from './overviewCharts'
import { useI18n } from '@/i18n'
import { formatCurrency, formatDateShort, formatDateTime, formatTokens } from '@/utils/format'
import { billingEntitlementLabels } from '@/utils/billingEntitlements'
import { formatWalletCurrency, walletTransactionCategoryLabel } from '@/features/wallet/utils/walletDisplay'

const { t } = useI18n()
const balance = ref<WalletBalanceResponse | null>(null)
const today = ref<TodayCostResponse | null>(null)
const plans = ref<BillingPlan[]>([])
const entitlements = ref<UserPlanEntitlement[]>([])
const usage = ref<UsageRecord[]>([])
const transactions = ref<WalletTransaction[]>([])
const states = reactive({
  balance: { loading: true, error: false },
  plans: { loading: true, error: false },
  usage: { loading: true, error: false },
  bills: { loading: true, error: false },
})
const activePlans = computed(() => entitlements.value.filter(item =>
  item.active !== false && item.status === 'active'
  && (!item.starts_at || Date.parse(item.starts_at) <= Date.now())
  && (!item.expires_at || Date.parse(item.expires_at) > Date.now()),
))
const quota = computed(() => balance.value?.daily_quota)
const hasDailyQuota = computed(() => activePlans.value.some(item => item.entitlements.some(e => e.type === 'daily_quota')))
const walletAmount = computed(() => balance.value?.wallet_balance ?? balance.value?.wallet?.balance ?? balance.value?.balance)
const money = (value: number | null | undefined) => value == null ? '-' : formatCurrency(value)
const walletMoney = (value: number | null | undefined) => value == null ? '-' : formatWalletCurrency(value)
const sections = ['balance', 'plans', 'trend', 'share', 'usage', 'bills'] as const
const stateKey = (section: typeof sections[number]) => section === 'trend' || section === 'share' ? 'usage' : section
const dailyCosts = computed(() => aggregateDailyCost(usage.value))
const modelShares = computed(() => aggregateModelShare(usage.value))
const chartTotal = computed(() => dailyCosts.value.reduce((sum, day) => sum + day.total, 0))
const colors = ['#6366f1', '#f59e0b', '#10b981', '#38bdf8', '#a78bfa', '#94a3b8']
const modelLabel = (item: ReturnType<typeof aggregateModelShare>[number]) => item.other ? t('overview.other') : item.model
const trendData = computed(() => ({
  labels: dailyCosts.value.map(day => day.label),
  datasets: [{ data: dailyCosts.value.map(day => day.total), backgroundColor: dailyCosts.value.map((_, i) => i === dailyCosts.value.length - 1 ? '#f59e0b' : '#6366f1') }],
}))
const shareData = computed(() => ({
  labels: modelShares.value.map(modelLabel),
  datasets: [{ data: modelShares.value.map(item => item.total), backgroundColor: colors }],
}))
const trendOptions: ChartOptions<'bar'> = {
  plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => formatCurrency(Number(context.raw)) } } },
}
const shareOptions: ChartOptions<'doughnut'> = {
  cutout: '75%',
  plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.label}: ${formatCurrency(Number(context.raw))}` } } },
}
const quotaOptions: ChartOptions<'doughnut'> = {
  cutout: '78%', plugins: { legend: { display: false }, tooltip: { enabled: false } },
}
const quotaPercent = computed(() => quota.value && quota.value.total_usd > 0
  ? Math.min(100, Math.max(0, quota.value.used_usd / quota.value.total_usd * 100)) : 0)
const quotaData = computed(() => ({
  datasets: [{ data: [Math.max(0, quota.value?.used_usd ?? 0), Math.max(0, quota.value?.remaining_usd ?? 0)], backgroundColor: ['#6366f1', '#e5e7eb'], borderWidth: 0 }],
}))

async function load(section: keyof typeof states) {
  states[section] = { loading: true, error: false }
  try {
    if (section === 'balance') {
      const [wallet, cost] = await Promise.all([walletApi.getBalance(), walletApi.getTodayCost()])
      balance.value = wallet
      today.value = cost
    } else if (section === 'plans') {
      const [benefits, catalog] = await Promise.all([billingApi.listEntitlements(), billingApi.listPlans()])
      entitlements.value = benefits.items
      plans.value = catalog.items
    } else if (section === 'usage') {
      usage.value = (await usageApi.getUsageRecords({ page: 1, page_size: 200 })).records
    } else {
      transactions.value = (await walletApi.getTransactions({ limit: 8, offset: 0 })).items
    }
  } catch {
    states[section].error = true
  } finally {
    states[section].loading = false
  }
}

onMounted(() => {
  for (const section of Object.keys(states) as Array<keyof typeof states>) void load(section)
})
</script>

<template>
  <PageContainer>
    <PageHeader :title="t('overview.title')" />
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <CardSection v-for="section in sections" :key="section" :title="t(`overview.${section}`)" :data-section="section" :class="['min-w-0', section === 'share' ? '' : section === 'usage' ? 'lg:col-span-2' : 'lg:col-span-3']">
        <LoadingState v-if="states[stateKey(section)].loading" :message="t('common.loading')" />
        <EmptyState v-else-if="states[stateKey(section)].error" type="error" :title="t('overview.error')" :action-text="t('overview.retry')" :action-icon="RefreshCw" @action="load(stateKey(section))" />
        <template v-else-if="section === 'balance'">
          <EmptyState v-if="!balance?.wallet && walletAmount == null && !balance?.unlimited" :title="t('overview.noWallet')" />
          <dl v-else class="grid gap-6 sm:grid-cols-2">
            <div><dt class="text-sm text-muted-foreground">{{ t('overview.balance') }}</dt><dd class="mt-2 text-2xl font-semibold break-all">{{ balance?.unlimited ? t('ui.unlimited9ee3c07') : walletMoney(walletAmount) }}</dd></div>
            <div><dt class="text-sm text-muted-foreground">{{ t('overview.today') }}</dt><dd class="mt-2 text-2xl font-semibold break-all">{{ money(today?.total_cost) }}</dd></div>
          </dl>
        </template>
        <template v-else-if="section === 'plans'">
          <EmptyState v-if="!activePlans.length" :title="t('overview.noPlans')" />
          <div v-else class="divide-y">
            <div v-for="item in activePlans" :key="item.id" class="space-y-2 py-4 first:pt-0 break-words">
              <h3 class="font-medium">{{ plans.find(plan => plan.id === item.plan_id)?.title || item.plan_id }}</h3>
              <p class="text-sm text-muted-foreground">{{ t('overview.expires') }}: {{ formatDateShort(item.expires_at) }}</p>
              <ul class="space-y-1 text-sm">
                <li v-for="(label, index) in billingEntitlementLabels(item.entitlements)" :key="index">{{ label }}</li>
              </ul>
              <template v-if="item.entitlements.some(e => e.type === 'usage_policy')">
                <p v-if="item.entitlements.some(e => e.type === 'usage_policy' && e.rules.some(rule => rule.window.kind === 'calendar_week' && rule.metric === 'actual_cost_usd'))" class="text-sm text-muted-foreground">{{ t('overview.weekUnavailable') }}</p>
                <p class="text-sm">{{ t('overview.today') }}: {{ states.balance.loading || states.balance.error ? '-' : money(today?.total_cost) }}</p>
              </template>
            </div>
            <div v-if="hasDailyQuota" class="space-y-3 pt-4">
              <p class="text-sm font-medium">{{ t('overview.daily') }}</p>
              <LoadingState v-if="states.balance.loading" :message="t('common.loading')" />
              <EmptyState v-else-if="states.balance.error" type="error" :title="t('overview.error')" :action-text="t('overview.retry')" :action-icon="RefreshCw" @action="load('balance')" />
              <template v-else-if="quota?.has_active">
                <p class="text-sm">{{ t('overview.quota', { used: money(quota.used_usd), total: money(quota.total_usd), remaining: money(quota.remaining_usd) }) }}</p>
                <div class="relative h-36 w-36" role="img" :aria-label="`${t('overview.daily')}: ${quotaPercent.toFixed(1)}%`">
                  <DoughnutChart :data="quotaData" :options="quotaOptions" :height="144" />
                  <span class="pointer-events-none absolute inset-0 flex items-center justify-center text-xl font-semibold">{{ quotaPercent.toFixed(1) }}%</span>
                </div>
              </template>
              <p v-else class="text-sm text-muted-foreground">{{ t('overview.unavailable') }}</p>
            </div>
          </div>
        </template>
        <template v-else-if="section === 'trend' || section === 'share'">
          <EmptyState v-if="chartTotal <= 0" :title="t('overview.empty')" />
          <div v-else-if="section === 'trend'" class="h-56" role="img" :aria-label="t('overview.trend')">
            <BarChart :data="trendData" :options="trendOptions" :stacked="false" :height="224" />
          </div>
          <div v-else class="space-y-4">
            <div class="relative mx-auto aspect-square w-48 max-w-full" role="img" :aria-label="`${t('overview.share')}: ${money(chartTotal)}`">
              <DoughnutChart :data="shareData" :options="shareOptions" :height="192" />
              <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-9 text-center">
                <span class="text-xs text-muted-foreground">{{ t('overview.period') }}</span>
                <span class="w-full break-all text-lg font-semibold">{{ money(chartTotal) }}</span>
              </div>
            </div>
            <ul class="space-y-2 text-sm">
              <li v-for="(item, index) in modelShares" :key="index" class="flex flex-wrap items-center gap-2">
                <span class="h-2.5 w-2.5 shrink-0 rounded-sm" :style="{ backgroundColor: colors[index] }" />
                <span class="min-w-0 flex-1 break-all">{{ modelLabel(item) }}</span>
                <span>{{ money(item.total) }}</span><span class="text-muted-foreground">{{ item.pct.toFixed(1) }}%</span>
              </li>
            </ul>
          </div>
        </template>
        <template v-else-if="section === 'usage'">
          <EmptyState v-if="!usage.length" :title="t('overview.empty')" />
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-muted-foreground"><tr><th class="p-2">{{ t('overview.time') }}</th><th class="p-2">{{ t('overview.model') }}</th><th class="p-2">{{ t('overview.tokens') }}</th><th class="p-2">{{ t('overview.cost') }}</th></tr></thead>
              <tbody><tr v-for="record in usage.slice(0, 10)" :key="record.id" class="border-t">
                <td class="p-2 whitespace-nowrap">{{ formatDateTime(record.created_at) }}</td><td class="p-2 break-all">{{ record.model }}</td>
                <td class="p-2">{{ record.usage_available === false || record.total_tokens == null ? '-' : formatTokens(record.total_tokens) }}</td><td class="p-2 whitespace-nowrap">{{ record.usage_pricing_available === false ? '-' : money(record.billing_cost ?? record.cost) }}</td>
              </tr></tbody>
            </table>
          </div>
        </template>
        <template v-else>
          <EmptyState v-if="!transactions.length" :title="t('overview.empty')" />
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-muted-foreground"><tr><th class="p-2">{{ t('overview.time') }}</th><th class="p-2">{{ t('overview.type') }}</th><th class="p-2">{{ t('overview.amount') }}</th><th class="p-2">{{ t('overview.change') }}</th></tr></thead>
              <tbody><tr v-for="item in transactions" :key="item.id" class="border-t">
                <td class="p-2 whitespace-nowrap">{{ formatDateTime(item.created_at) }}</td><td class="p-2">{{ walletTransactionCategoryLabel(item.category) }}</td>
                <td class="p-2 whitespace-nowrap">{{ walletMoney(item.amount) }}</td><td class="p-2 whitespace-nowrap">{{ walletMoney(item.balance_before) }} &rarr; {{ walletMoney(item.balance_after) }}</td>
              </tr></tbody>
            </table>
          </div>
        </template>
        <template v-if="section === 'usage' || section === 'bills'" #footer>
          <RouterLink :to="section === 'usage' ? '/dashboard/usage' : '/dashboard/wallet'" class="inline-flex items-center gap-2 text-sm text-primary hover:underline">
            {{ t(section === 'usage' ? 'overview.allUsage' : 'overview.walletLink') }}<ArrowRight class="h-4 w-4" />
          </RouterLink>
        </template>
      </CardSection>
    </div>
  </PageContainer>
</template>
