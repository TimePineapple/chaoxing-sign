<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { SignTypeEnum } from '~/constants/cx'
import { formatQrCodeFeedbackTime, qrCodeRequestError } from '~/utils/qrCodeSign'

const props = defineProps<{
  uid: string
  username?: string
  info: CX.User
  setting: CX.Setting
  selected?: boolean
  lastLoginTime: string
}>()

const emit = defineEmits<{ (e: 'click'): void }>()

const accountStore = useAccountStore()

const loading = ref(false)
const qrCodeLoading = ref(false)
const qrCodeResult = ref<{ time: string; status: 'pending' | 'success' | 'error'; message: string } | null>(null)
const showQrCodeModal = ref(false)
const showCodeOrGestureModal = ref(false)

const showSettingModal = ref(false)
const showSignHistory = ref(false)

// 正在执行中的活动
const doingActivity = ref<CX.ActivityItem | null>(null)

async function handleQrCodeSignSuccess(result: string) {
  if (qrCodeLoading.value)
    return

  const time = formatQrCodeFeedbackTime()
  qrCodeResult.value = { time, status: 'pending', message: '请求已发起，等待服务器返回（最多 45 秒）' }
  qrCodeLoading.value = true

  try {
    const data = await accountStore.signByQrCode(props.uid, result, doingActivity.value?.course?.courseId)
    qrCodeResult.value = {
      time,
      status: data?.result === '签到成功' ? 'success' : 'error',
      message: data?.result?.trim() || '签到接口未返回有效结果',
    }
  }
  catch (error) {
    qrCodeResult.value = { time, status: 'error', message: qrCodeRequestError(error) }
  }
  finally {
    qrCodeLoading.value = false
  }
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
