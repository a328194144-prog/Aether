<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowRight, RefreshCw } from 'lucide-vue-next'
import { walletApi, type WalletBalanceResponse, type TodayCostResponse, type WalletTransaction } from '@/api/wallet'
import { billingApi, type BillingPlan, type UserPlanEntitlement } from '@/api/billing'
import { usageApi, type UsageRecord } from '@/api/usage'
import { CardSection, PageContainer, PageHeader } from '@/components/layout'
import { EmptyState, LoadingState } from '@/components/common'
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
      usage.value = (await usageApi.getUsageRecords({ page: 1, page_size: 10 })).records
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
    <div class="space-y-6">
      <CardSection v-for="section in (['balance', 'plans', 'usage', 'bills'] as const)" :key="section" :title="t(`overview.${section}`)" :data-section="section">
        <LoadingState v-if="states[section].loading" :message="t('common.loading')" />
        <EmptyState v-else-if="states[section].error" type="error" :title="t('overview.error')" :action-text="t('overview.retry')" :action-icon="RefreshCw" @action="load(section)" />
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
                <progress class="h-2 w-full accent-primary" :value="quota.total_usd > 0 ? Math.min(100, Math.max(0, quota.used_usd / quota.total_usd * 100)) : 0" max="100" :aria-label="t('overview.daily')" />
              </template>
              <p v-else class="text-sm text-muted-foreground">{{ t('overview.unavailable') }}</p>
            </div>
          </div>
        </template>
        <template v-else-if="section === 'usage'">
          <EmptyState v-if="!usage.length" :title="t('overview.empty')" />
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-muted-foreground"><tr><th class="p-2">{{ t('overview.time') }}</th><th class="p-2">{{ t('overview.model') }}</th><th class="p-2">{{ t('overview.tokens') }}</th><th class="p-2">{{ t('overview.cost') }}</th></tr></thead>
              <tbody><tr v-for="record in usage" :key="record.id" class="border-t">
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
