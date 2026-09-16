<script setup lang="ts">
import { SignTypeEnum } from '~/constants/cx'
import { createQrSignTraceId, formatQrCodeFeedbackTime, parseQrCodeSignLink, qrCodeRequestError } from '~/utils/qrCodeSign'
import { connectQrSignEvents } from '~/utils/qrSignEvents.client'
import type { QrJobView, QrStreamSnapshot, QrSubmitDecision } from '~/utils/qrSignProtocol'

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
interface QrFeedback {
  uid: string
  name: string
  time: string
  traceId: string
  status: 'pending' | 'success' | 'error'
  message: string
  jobId?: string
  activityId?: string
  requestedActivityId?: string
  retryUrl?: string
}
const qrCodeResults = ref<QrFeedback[]>([])
const showQrCodeModal = ref(false)
const showCodeOrGestureModal = ref(false)
const retryFailedAvailable = ref(false)
const autoSelectFailedOnRetry = computed(() => {
  const value = runtimeConfig.public.qrCode?.autoSelectFailedOnRetry
  return value !== false && value !== 'false'
})

// 正在执行中的活动
const doingActivity = ref<CX.ActivityItem | null>(null)
let closeQrEvents: (() => void) | undefined
let qrModalGeneration = 0

function applyQrJob(job: QrJobView) {
  if (!showQrCodeModal.value)
    return
  const account = accounts.value.find(item => item.uid === job.uid)
  if (!account || !account.selected)
    return
  let row = qrCodeResults.value.find(item => item.uid === job.uid)
  if (row?.jobId && row.jobId !== job.id && row.status === 'pending')
    return
  if (!row) {
    row = { uid: job.uid, name: account.info?.realname || job.uid, time: formatQrCodeFeedbackTime(),
      traceId: createQrSignTraceId(), status: 'pending', message: '' }
    qrCodeResults.value.push(row)
  }
  if (row.jobId && row.jobId !== job.id) {
    row.requestedActivityId = undefined
    row.retryUrl = undefined
  }
  const differentActivity = Boolean(row.requestedActivityId && row.requestedActivityId !== job.activityId)
  const final = job.state === 'success' || job.state === 'error'
  row.jobId = job.id
  row.activityId = job.activityId
  row.status = job.state === 'success' && !differentActivity ? 'success' : final ? 'error' : 'pending'
  row.message = differentActivity
    ? `先提交的活动 ${job.activityId}：${job.message}。你提交的活动 ${row.requestedActivityId} 尚未执行，请手动重新提交。`
    : job.message
  retryFailedAvailable.value = autoSelectFailedOnRetry.value && qrCodeResults.value.some(item => item.status === 'error')
}

function handleQrSnapshot(snapshot: QrStreamSnapshot) {
  for (const job of snapshot.active)
    applyQrJob(job)
  for (const row of qrCodeResults.value) {
    if (!row.jobId || row.status !== 'pending')
      continue
    const job = snapshot.active.find(item => item.id === row.jobId)
    if (job)
      applyQrJob(job)
    else {
      row.status = 'error'
      row.message = '服务端没有找到原任务，结果未确认；请先核对签到历史，再决定是否重试'
    }
  }
}

watch(showQrCodeModal, (show) => {
  qrModalGeneration += 1
  closeQrEvents?.()
  closeQrEvents = undefined
  qrCodeLoading.value = false
  if (show) {
    closeQrEvents = connectQrSignEvents(
      job => applyQrJob(job),
      handleQrSnapshot,
      () => {
        for (const row of qrCodeResults.value.filter(item => item.status === 'pending'))
          row.message = '结果连接中断，正在重连；请先核对签到历史，不要重复提交'
      },
    )
  }
})
onBeforeUnmount(() => closeQrEvents?.())

function applyQrDecision(row: QrFeedback, decision: QrSubmitDecision, url: string, requestedActivityId: string) {
  if (row.jobId === decision.job.id && row.status !== 'pending')
    return
  row.jobId = decision.job.id
  row.activityId = decision.job.activityId
  row.requestedActivityId = requestedActivityId
  row.retryUrl = url
  row.status = 'pending'
  row.message = decision.state === 'busy' && requestedActivityId !== decision.job.activityId
    ? `活动 ${decision.job.activityId} 正在处理；你提交的活动 ${requestedActivityId} 未执行。待其结束后请手动重新提交。`
    : decision.job.message
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

  qrCodeResults.value = failedRows.map((item): QrFeedback => ({
    ...item,
    status: 'pending',
    message: '等待扫描',
    jobId: undefined,
    requestedActivityId: undefined,
    retryUrl: undefined,
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

  const requestedActivityId = parseQrCodeSignLink(result)?.activityId || ''
  const generation = qrModalGeneration
  qrCodeLoading.value = true
  qrCodeResults.value = toAccounts.map((account): QrFeedback => ({
    uid: account.uid,
    name: account.info?.realname || account.uid,
    time: formatQrCodeFeedbackTime(),
    traceId: createQrSignTraceId(),
    status: 'pending',
    message: '正在提交任务',
    requestedActivityId,
    retryUrl: result,
  }))
  console.info('[qr-code-sign] 批量扫码开始', { count: toAccounts.length, traceIds: qrCodeResults.value.map(row => row.traceId) })
  await Promise.allSettled(toAccounts.map(async (account, index) => {
    const row = qrCodeResults.value[index]!
    try {
      const decision = await accountStore.signByQrCode(account.uid, result, courseId, row.traceId)
      if (generation === qrModalGeneration)
        applyQrDecision(row, decision, result, requestedActivityId)
    }
    catch (error) {
      if (generation !== qrModalGeneration || row.jobId)
        return
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
  }))
  if (generation === qrModalGeneration) {
    qrCodeLoading.value = false
    retryFailedAvailable.value = autoSelectFailedOnRetry.value && qrCodeResults.value.some(item => item.status === 'error')
  }
}

async function retryQrSubmission(row: QrFeedback) {
  if (!row.retryUrl || row.status === 'pending' || qrCodeLoading.value)
    return
  const url = row.retryUrl
  const activityId = parseQrCodeSignLink(url)?.activityId || ''
  const generation = qrModalGeneration
  row.jobId = undefined
  row.status = 'pending'
  row.message = '正在重新提交任务'
  qrCodeLoading.value = true
  try {
    const decision = await accountStore.signByQrCode(row.uid, url, undefined, row.traceId)
    if (generation === qrModalGeneration)
      applyQrDecision(row, decision, url, activityId)
  }
  catch (error) {
    if (generation === qrModalGeneration && !row.jobId) {
      row.status = 'error'
      row.message = qrCodeRequestError(error)
    }
  }
  finally {
    if (generation === qrModalGeneration)
      qrCodeLoading.value = false
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
            <n-button v-if="item.retryUrl && item.status === 'error' && item.activityId && item.requestedActivityId !== item.activityId" size="small" :disabled="qrCodeLoading" @click="retryQrSubmission(item)">重新提交该 URL</n-button>
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
