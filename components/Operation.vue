<script setup lang="ts">
import { SignTypeEnum } from '~/constants/cx'
import { createQrSignTraceId, formatQrCodeFeedbackTime, parseQrCodeSignLink, qrCodeRequestError } from '~/utils/qrCodeSign'

const accountStore = useAccountStore()
const logStore = useLogStore()
const runtimeConfig = typeof useRuntimeConfig === 'function'
  ? useRuntimeConfig()
  : { public: {} }

const accounts = toRef(accountStore, 'accounts')
const selectAccounts = toRef(accountStore, 'selectAccounts')

const isAllChecked = ref(false)
const indeterminate = computed(() => {
  return selectAccounts.value.length > 0 && selectAccounts.value.length < accounts.value.length
})

function handleCheckedChange() {
  accountStore.accounts.forEach((account) => {
    account.selected = isAllChecked.value
  })
}

onMounted(() => {
  isAllChecked.value = selectAccounts.value.length === accounts.value.length && accounts.value.length > 0
})

watch(selectAccounts, () => {
  isAllChecked.value = selectAccounts.value.length === accounts.value.length && accounts.value.length > 0
})

const loading = ref(false)
const qrCodeLoading = ref(false)
const qrCodeResults = ref<{ uid: string; name: string; time: string; traceId: string; status: 'pending' | 'success' | 'error'; message: string }[]>([])
const showQrCodeModal = ref(false)
const showCodeOrGestureModal = ref(false)
const retryFailedAvailable = ref(false)
const autoSelectFailedOnRetry = computed(() => {
  const value = runtimeConfig.public.qrCode?.autoSelectFailedOnRetry
  return value !== false && value !== 'false'
})

// 正在执行中的活动
const doingActivity = ref<CX.ActivityItem | null>(null)
const QR_ACCOUNT_INTERVAL_MS = 200

function waitForNextQrAccount() {
  return new Promise<void>(resolve => setTimeout(resolve, QR_ACCOUNT_INTERVAL_MS))
}

async function openQrCodeSignModal() {
  const toAccounts = unref(selectAccounts)

  if (toAccounts.length === 0)
    return logStore.log('请先选择账号', { type: 'warning' })

  doingActivity.value = null
  qrCodeResults.value = []
  retryFailedAvailable.value = false
  showQrCodeModal.value = true
}

function toggleAllChecked() {
  isAllChecked.value = !isAllChecked.value
  handleCheckedChange()
}

function handleRetryFailed() {
  if (!autoSelectFailedOnRetry.value)
    return

  const failedRows = qrCodeResults.value.filter(item => item.status === 'error')
  const failedUids = new Set(failedRows.map(item => item.uid))
  if (failedUids.size === 0) {
    retryFailedAvailable.value = false
    return
  }

  qrCodeResults.value = failedRows.map(item => ({
    ...item,
    status: 'pending',
    message: '等待扫描',
  }))
  accountStore.accounts.forEach((account) => {
    account.selected = failedUids.has(account.uid)
  })
  retryFailedAvailable.value = false
}

async function handleSuccess(result: string) {
  if (qrCodeLoading.value)
    return

  const toAccounts = [...unref(selectAccounts)]
  qrCodeResults.value = []
  retryFailedAvailable.value = false
  if (toAccounts.length === 0) {
    return logStore.log('请先选择账号', { type: 'warning' })
  }

  const activity = doingActivity.value
  const courseId = String(activity?.id) === parseQrCodeSignLink(result)?.activityId
    ? activity?.course?.courseId
    : undefined

  qrCodeLoading.value = true
  qrCodeResults.value = toAccounts.map(account => ({
    uid: account.uid,
    name: account.info?.realname || account.uid,
    time: formatQrCodeFeedbackTime(),
    traceId: createQrSignTraceId(),
    status: 'pending',
    message: '请求已发起，等待服务器返回（最多 45 秒）',
  }))
  console.info('[qr-code-sign] 批量扫码开始', { count: toAccounts.length, traceIds: qrCodeResults.value.map(row => row.traceId) })
  let pendingCount = toAccounts.length
  for (const [index, account] of toAccounts.entries()) {
    const row = qrCodeResults.value[index]
    void (async () => {
      try {
        const data = await accountStore.signByQrCode(account.uid, result, courseId, row.traceId)
        row.status = data?.result === '签到成功' ? 'success' : 'error'
        row.message = data?.result?.trim() || '签到接口未返回有效结果'
        console.info(`[qr-code-sign][${row.traceId}] 账号请求结束`, { success: row.status === 'success' })
      }
      catch (error) {
        row.status = 'error'
        row.message = qrCodeRequestError(error)
        console.warn(`[qr-code-sign][${row.traceId}] 账号请求失败`)
        try {
          logStore.log(`账号: ${row.name} (${row.uid}) 扫码失败: ${row.message}`, { type: 'error' })
        }
        catch {
          console.warn('[qr-code-sign] 无法显示签到日志，已保留接口返回结果')
        }
      }
      finally {
        pendingCount -= 1
        if (pendingCount === 0) {
          qrCodeLoading.value = false
          retryFailedAvailable.value = autoSelectFailedOnRetry.value && qrCodeResults.value.some(item => item.status === 'error')
        }
      }
    })()

    if (index < toAccounts.length - 1)
      await waitForNextQrAccount()
  }
}

async function handleCodeOrGestureSignSuccess(result: string) {
  const toAccounts = unref(selectAccounts)

  const activity = unref(doingActivity)

  if (!activity)
    return

  loading.value = true

  try {
    await Promise.allSettled(
      toAccounts.map(async (account) => {
        if (activity.otherId === SignTypeEnum.Code)
          return await accountStore.signByCode(account.uid, String(activity.id), result)

        else if (activity.otherId === SignTypeEnum.Gesture)
          return await accountStore.signByGesture(account.uid, String(activity.id), result)
      }),
    )
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <footer class="mobile-footer" role="region" aria-label="批量操作">
    <div class="batch-selection">
      <span>已选 <strong>{{ selectAccounts.length }}</strong> 个账号</span>
      <span class="batch-select-label" role="button" tabindex="0" @click.stop="toggleAllChecked" @keydown.enter.stop="toggleAllChecked" @keydown.space.prevent.stop="toggleAllChecked">全选</span>
      <n-checkbox v-model:checked="isAllChecked" :indeterminate="indeterminate" size="large" aria-label="全选" @update:checked="handleCheckedChange" />
    </div>
    <div class="primary-actions">
      <n-button type="primary" :disabled="qrCodeLoading" @click="openQrCodeSignModal()">
        <template #icon><Icon name="mdi:qrcode-scan" /></template>
        批量扫码
      </n-button>
    </div>
    <QrCodeSignModal v-model:show="showQrCodeModal" :title="doingActivity?.course?.name ?? '批量扫码'" :loading="qrCodeLoading" :retry-failed-available="retryFailedAvailable" @success="handleSuccess" @retry-failed="handleRetryFailed">
      <template #result>
        <ul v-if="qrCodeResults.length" aria-label="各账号扫码结果" class="mb-3">
          <li v-for="item in qrCodeResults" :key="item.uid">
            <n-text :type="item.status === 'pending' ? 'info' : item.status">{{ item.time }} {{ item.name }} ({{ item.uid }}): {{ item.message }}</n-text>
          </li>
        </ul>
      </template>
    </QrCodeSignModal>
    <CodeOrGestureSignModal v-model:show="showCodeOrGestureModal" :activity="doingActivity!" :loading="loading" @success="handleCodeOrGestureSignSuccess" />
  </footer>
</template>

<style scoped>
.icon {
  --at-apply: cursor-pointer transition hover:text-red-4
}
</style>
