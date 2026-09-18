<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { SignTypeEnum } from '~/constants/cx'
import { formatQrCodeFeedbackTime, qrCodeRequestError } from '~/utils/qrCodeSign'
import { connectQrSignEvents } from '~/utils/qrSignEvents.client'
import { getClientLocationForQr } from '~/utils/clientLocation.client'
import type { QrJobView, QrStreamSnapshot, QrSubmitDecision } from '~/utils/qrSignProtocol'
import type { RecentSign } from '~/types/recentSign'

const props = defineProps<{
  uid: string
  username?: string
  info: CX.User
  setting: CX.Setting
  selected?: boolean
  lastLoginTime: string
  recentSign?: RecentSign
}>()

const emit = defineEmits<{ (e: 'click'): void }>()

const accountStore = useAccountStore()

const loading = ref(false)
const qrCodeLoading = ref(false)
interface QrFeedback {
  time: string
  status: 'pending' | 'success' | 'error'
  message: string
  jobId?: string
  activityId?: string
  requestedActivityId?: string
  retryUrl?: string
}
const qrCodeResult = ref<QrFeedback | null>(null)
const showQrCodeModal = ref(false)
const showCodeOrGestureModal = ref(false)

const showSettingModal = ref(false)
const showSignHistory = ref(false)

const now = ref(Date.now())
let recentSignExpiry: ReturnType<typeof setTimeout> | undefined
watch(() => props.recentSign?.time, (time) => {
  now.value = Date.now()
  if (recentSignExpiry)
    clearTimeout(recentSignExpiry)
  const expiresAt = Date.parse(time || '') + 30 * 60 * 1000
  if (Number.isFinite(expiresAt) && expiresAt > now.value)
    recentSignExpiry = setTimeout(() => { now.value = Date.now() }, expiresAt - now.value)
}, { immediate: true })
const visibleRecentSign = computed(() => {
  const sign = props.recentSign
  const time = Date.parse(sign?.time || '')
  return sign && Number.isFinite(time) && time <= now.value && now.value < time + 30 * 60 * 1000
    ? sign
    : null
})

// 正在执行中的活动
const doingActivity = ref<CX.ActivityItem | null>(null)
let closeQrEvents: (() => void) | undefined
let qrModalGeneration = 0

function applyQrJob(job: QrJobView) {
  if (job.uid !== props.uid || !showQrCodeModal.value)
    return
  const previous = qrCodeResult.value
  if (previous?.jobId && previous.jobId !== job.id && previous.status === 'pending')
    return
  const current = previous?.jobId && previous.jobId !== job.id ? null : previous
  const differentActivity = Boolean(current?.requestedActivityId && current.requestedActivityId !== job.activityId)
  const final = job.state === 'success' || job.state === 'error'
  qrCodeResult.value = {
    ...current,
    time: current?.time || formatQrCodeFeedbackTime(),
    status: job.state === 'success' && !differentActivity ? 'success' : final ? 'error' : 'pending',
    jobId: job.id,
    activityId: job.activityId,
    message: differentActivity
      ? `先提交的活动 ${job.activityId}：${job.message}。你提交的活动 ${current?.requestedActivityId} 尚未执行，请手动重新提交。`
      : job.message,
  }
}

function handleQrSnapshot(snapshot: QrStreamSnapshot) {
  const current = qrCodeResult.value
  if (current?.jobId) {
    const job = snapshot.active.find(item => item.id === current.jobId)
    if (job)
      applyQrJob(job)
    else if (current.status === 'pending')
      qrCodeResult.value = { ...current, status: 'error', message: '服务端没有找到原任务，结果未确认；请先核对签到历史，再决定是否重试' }
    return
  }
  const active = snapshot.active.find(item => item.uid === props.uid)
  if (active)
    applyQrJob(active)
}

watch(showQrCodeModal, (show) => {
  qrModalGeneration += 1
  closeQrEvents?.()
  closeQrEvents = undefined
  qrCodeLoading.value = false
  if (show) {
    qrCodeResult.value = null
    closeQrEvents = connectQrSignEvents(
      job => applyQrJob(job),
      handleQrSnapshot,
      () => {
        if (qrCodeResult.value?.status === 'pending')
          qrCodeResult.value.message = '结果连接中断，正在重连；请先核对签到历史，不要重复提交'
      },
    )
  }
})
onBeforeUnmount(() => {
  closeQrEvents?.()
  if (recentSignExpiry)
    clearTimeout(recentSignExpiry)
})

function applyQrDecision(decision: QrSubmitDecision, url: string, requestedActivityId: string) {
  const current = qrCodeResult.value
  if (current?.jobId === decision.job.id && current.status !== 'pending')
    return
  qrCodeResult.value = {
    time: formatQrCodeFeedbackTime(),
    status: 'pending',
    message: decision.state === 'busy' && requestedActivityId !== decision.job.activityId
      ? `活动 ${decision.job.activityId} 正在处理；你提交的活动 ${requestedActivityId} 未执行。待其结束后请手动重新提交。`
      : decision.job.message,
    jobId: decision.job.id,
    activityId: decision.job.activityId,
    requestedActivityId,
    retryUrl: url,
  }
}

async function handleQrCodeSignSuccess(result: string) {
  if (qrCodeLoading.value)
    return

  const requestedActivityId = new URL(result).searchParams.get('id') || ''
  const generation = qrModalGeneration
  qrCodeResult.value = { time: formatQrCodeFeedbackTime(), status: 'pending', message: '正在提交任务', requestedActivityId, retryUrl: result }
  qrCodeLoading.value = true

  try {
    const location = await getClientLocationForQr()
    const decision = await accountStore.signByQrCode(props.uid, result, doingActivity.value?.course?.courseId, undefined, location)
    if (generation === qrModalGeneration)
      applyQrDecision(decision, result, requestedActivityId)
  }
  catch (error) {
    if (generation === qrModalGeneration && !qrCodeResult.value?.jobId)
      qrCodeResult.value = { time: formatQrCodeFeedbackTime(), status: 'error', message: qrCodeRequestError(error), requestedActivityId, retryUrl: result }
  }
  finally {
    if (generation === qrModalGeneration)
      qrCodeLoading.value = false
  }
}

function retryQrSubmission() {
  const current = qrCodeResult.value
  if (!current?.retryUrl || current.status === 'pending')
    return
  void handleQrCodeSignSuccess(current.retryUrl)
}

async function handleCodeOrGestureSignSuccess(result: string) {
  const activity = unref(doingActivity)

  if (!activity)
    return

  loading.value = true

  try {
    if (activity.otherId === SignTypeEnum.Code)
      await accountStore.signByCode(props.uid, doingActivity.value!.course.courseId!, String(activity.id), result)

    else if (activity.otherId === SignTypeEnum.Gesture)
      await accountStore.signByGesture(props.uid, doingActivity.value!.course.courseId!, String(activity.id), result)
  }
  finally {
    loading.value = false
  }
}

</script>

<template>
  <n-spin :show="loading">
    <n-card class="account-card" :class="{ 'account-card-selected': selected }" @click="emit('click')">
      <template #header>
        <div class="account-identity">
          <n-avatar :size="44" :src="info.avatar" round />
          <div class="account-person">
            <h3>{{ info.realname }}</h3>
            <p>{{ info.siteName }}</p>
          </div>
          <div class="account-selection" @click.stop>
            <n-checkbox :checked="selected === true" :aria-label="`选择账号 ${info.realname}`" @update:checked="emit('click')" />
          </div>
        </div>
      </template>

      <div class="account-meta">
        <p>
          最近登录时间: {{ useDateFormat(lastLoginTime, 'YYYY-MM-DD HH:mm:ss').value }}
        </p>
        <p v-if="visibleRecentSign" class="account-recent-sign">
          最近签到：{{ visibleRecentSign.name }} {{ useDateFormat(visibleRecentSign.time, 'HH:mm:ss').value }}
        </p>
      </div>

      <template #action>
        <div class="account-actions" @click.stop>
          <div class="account-action-layout">
            <n-button class="account-scan-button" type="primary" @click="qrCodeResult = null; showQrCodeModal = true"><template #icon><Icon name="mdi:qrcode-scan" /></template>扫码签到</n-button>
            <div class="account-mini-actions">
              <n-button quaternary class="account-mini-button" @click="showSignHistory = true"><template #icon><Icon name="material-symbols:history-rounded" /></template>记录</n-button>
              <n-button quaternary class="account-mini-button" @click="showSettingModal = true"><template #icon><Icon name="material-symbols:settings-outline" /></template>设置</n-button>
            </div>
          </div>
        </div>
      </template>
      <QrCodeSignModal v-model:show="showQrCodeModal" :title="doingActivity?.course.name" :loading="qrCodeLoading" @success="handleQrCodeSignSuccess">
        <template #result>
          <p v-if="qrCodeResult" role="status">
            <n-text :type="qrCodeResult.status === 'pending' ? 'info' : qrCodeResult.status">{{ qrCodeResult.time }} {{ info.realname }} ({{ uid }}): {{ qrCodeResult.message }}</n-text>
            <n-button v-if="qrCodeResult.retryUrl && qrCodeResult.status === 'error' && qrCodeResult.activityId && qrCodeResult.requestedActivityId !== qrCodeResult.activityId" size="small" :disabled="qrCodeLoading" @click="retryQrSubmission">重新提交该 URL</n-button>
          </p>
        </template>
      </QrCodeSignModal>
      <CodeOrGestureSignModal v-model:show="showCodeOrGestureModal" :activity="doingActivity!" :loading="loading" @success="handleCodeOrGestureSignSuccess" />
      <SignHistory v-model:show="showSignHistory" :uid="uid" />
      <SettingModal v-if="showSettingModal" v-model:show="showSettingModal" :uid="uid" :setting="setting" />
    </n-card>
    <template #description>
      马上就好...
    </template>
  </n-spin>
</template>
