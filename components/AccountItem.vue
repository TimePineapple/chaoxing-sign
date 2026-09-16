<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { SignTypeEnum } from '~/constants/cx'

const props = defineProps<{
  uid: string
  username?: string
  info: CX.User
  setting: CX.Setting
  selected?: boolean
  lastLoginTime: string
}>()

const emit = defineEmits<{ (e: 'click'): void }>()

const ms = useMessage()
const accountStore = useAccountStore()

const loading = ref(false)
const qrCodeLoading = ref(false)
const showQrCodeModal = ref(false)
const showCodeOrGestureModal = ref(false)

const showSettingModal = ref(false)
const showSignHistory = ref(false)

// 正在执行中的活动
const doingActivity = ref<CX.ActivityItem | null>(null)

const monitor = ref(props.setting.monitor)

async function oneClickSign(uid: string) {
  loading.value = true

  const data = await accountStore.oneClickSign(uid).finally(() => {
    loading.value = false
  }) as CX.SignResult[]

  // // 如果一键签到中有二维码签到的课程,则弹出二维码扫码签到的弹窗
  const QrCodeSignActivity = data.find(item => item.signType === SignTypeEnum.QRCode)?.activity

  if (QrCodeSignActivity) {
    doingActivity.value = QrCodeSignActivity
    ms.warning(`检测到有二维码签到的课程[${QrCodeSignActivity.course?.name}],请扫码`, { duration: 20 * 1000, closable: true })
    showQrCodeModal.value = true
    return
  }

  // 检测到签到码签到
  const CodeSignActivity = data.find(item => item.signType === SignTypeEnum.Code)?.activity

  if (CodeSignActivity) {
    doingActivity.value = CodeSignActivity
    ms.warning(`检测到有签到码签到的课程[${CodeSignActivity.course?.name}],请输入签到码, 如 1234`, { duration: 20 * 1000, closable: true })
    showCodeOrGestureModal.value = true
    return
  }

  // 检测到手势签到
  const GestureSignActivity = data.find(item => item.signType === SignTypeEnum.Gesture)?.activity

  if (GestureSignActivity) {
    doingActivity.value = GestureSignActivity
    ms.warning(`检测到有手势签到的课程[${GestureSignActivity.course?.name}],请输入手势轨迹, 如 123654789`, { duration: 20 * 1000, closable: true })
    showCodeOrGestureModal.value = true
  }
}

async function handleLogout() {
  loading.value = true

  await accountStore.logout(props.uid).finally(() => {
    loading.value = false
  })
}

async function handleQrCodeSignSuccess(result: string) {
  qrCodeLoading.value = true

  try {
    await accountStore.signByQrCode(props.uid, result, doingActivity.value?.course?.courseId)
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

async function handleMonitor() {
  loading.value = true

  await accountStore.monitorAccount(props.uid).finally(() => {
    loading.value = false
  })

  monitor.value = true
}

async function handleUnMonitor() {
  loading.value = true

  await accountStore.unMonitorAccount(props.uid).finally(() => {
    loading.value = false
  })

  monitor.value = false
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

      <template #header-extra>
        <span class="status-badge" :class="{ 'status-active': monitor }">{{ monitor ? '监听中' : '未监听' }}</span>
      </template>

      <div class="account-meta">
        <p>
          最近登录时间: {{ useDateFormat(lastLoginTime, 'YYYY-MM-DD HH:mm:ss').value }}
        </p>
      </div>

      <template #action>
        <div class="account-actions" @click.stop>
          <div class="primary-actions">
            <n-button type="primary" @click="oneClickSign(uid)"><template #icon><Icon name="material-symbols:swipe-up-outline" /></template>一键签到</n-button>
            <n-button secondary @click="showQrCodeModal = true"><template #icon><Icon name="mdi:qrcode-scan" /></template>扫码签到</n-button>
          </div>
          <div class="secondary-actions">
            <NuxtLink :to="`/account/${uid}`" class="action-link"><Icon name="material-symbols:medical-information-outline-sharp" />课程</NuxtLink>
            <n-popconfirm v-if="monitor" :negative-text="null" @positive-click="handleUnMonitor()">
              <template #trigger><n-button quaternary><template #icon><Icon name="material-symbols:notifications-off-outline" /></template>取消监听</n-button></template>
              确认取消监听该账号签到任务?
            </n-popconfirm>
            <n-button v-else quaternary @click="handleMonitor()"><template #icon><Icon name="material-symbols:notifications-active-outline" /></template>监听</n-button>
            <n-button quaternary @click="showSignHistory = true"><template #icon><Icon name="material-symbols:history-rounded" /></template>记录</n-button>
            <n-button quaternary @click="showSettingModal = true"><template #icon><Icon name="material-symbols:settings-outline" /></template>设置</n-button>
            <n-popconfirm :negative-text="null" @positive-click.stop="handleLogout()">
              <template #trigger><n-button quaternary type="error"><template #icon><Icon name="material-symbols:logout-sharp" /></template>移除账号</n-button></template>
              确认退出? 这将会清空本系统该账号的所有信息
            </n-popconfirm>
          </div>
        </div>
      </template>
      <QrCodeSignModal v-model:show="showQrCodeModal" :title="doingActivity?.course.name" :loading="qrCodeLoading" @success="handleQrCodeSignSuccess" />
      <CodeOrGestureSignModal v-model:show="showCodeOrGestureModal" :activity="doingActivity!" :loading="loading" @success="handleCodeOrGestureSignSuccess" />
      <SignHistory v-model:show="showSignHistory" :uid="uid" />
      <SettingModal v-if="showSettingModal" v-model:show="showSettingModal" :uid="uid" :setting="setting" />
    </n-card>
    <template #description>
      马上就好...
    </template>
  </n-spin>
</template>
