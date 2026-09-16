<script setup lang="ts">
import { SignTypeEnum } from '~/constants/cx'

const accountStore = useAccountStore()
const logStore = useLogStore()
const ms = useMessage()

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
const showQrCodeModal = ref(false)
const showCodeOrGestureModal = ref(false)

// 正在执行中的活动
const doingActivity = ref<CX.ActivityItem | null>(null)

async function handleSignAll() {
  const toAccounts = unref(selectAccounts)

  if (toAccounts.length === 0)
    return logStore.log('请先选择账号', { type: 'warning' })

  logStore.log(`共 ${toAccounts.length} 个账号准备签到`, { type: 'loading' })

  const data = await Promise.allSettled(
    toAccounts.map((account) => {
      return accountStore.oneClickSign(account.uid)
    }),
  )

  const oneData = data?.[0]?.value as CX.SignResult[]

  // // 如果一键签到中有二维码签到的课程,则弹出二维码扫码签到的弹窗
  const QrCodeSignActivity = oneData.find(item => item.signType === SignTypeEnum.QRCode)?.activity
  if (QrCodeSignActivity) {
    doingActivity.value = QrCodeSignActivity
    ms.warning(`检测到有二维码签到的课程[${QrCodeSignActivity.course?.name}],请扫码`, { duration: 20 * 1000, closable: true })
    showQrCodeModal.value = true
    return
  }

  // 检测到签到码签到
  const CodeSignActivity = oneData.find(item => item.signType === SignTypeEnum.Code)?.activity
  if (CodeSignActivity) {
    doingActivity.value = CodeSignActivity
    ms.warning(`检测到有签到码签到的课程[${CodeSignActivity.course?.name}],请输入签到码, 如 1234`, { duration: 20 * 1000, closable: true })
    showCodeOrGestureModal.value = true
    return
  }

  // 检测到手势签到
  const GestureSignActivity = oneData.find(item => item.signType === SignTypeEnum.Gesture)?.activity
  if (GestureSignActivity) {
    doingActivity.value = GestureSignActivity
    ms.warning(`检测到有手势签到的课程[${GestureSignActivity.course?.name}],请输入手势轨迹, 如 123654789`, { duration: 20 * 1000, closable: true })
    showCodeOrGestureModal.value = true
  }

  // logStore.log(`共 ${toAccounts.length} 个账号签到完成`, { type: 'success' })
}

async function openQrCodeSignModal() {
  const toAccounts = unref(selectAccounts)

  if (toAccounts.length === 0)
    return logStore.log('请先选择账号', { type: 'warning' })

  showQrCodeModal.value = true
}

async function handleSuccess(result: string) {
  const toAccounts = unref(selectAccounts)

  logStore.log(`共 ${toAccounts.length} 个账号准备签到`, { type: 'loading' })

  await Promise.allSettled(
    toAccounts.map((account) => {
      return accountStore.signByQrCode(account.uid, result)
    }),
  )

  logStore.log(`共 ${toAccounts.length} 个账号签到完成`, { type: 'success' })
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
  <div class="batch-bar" role="region" aria-label="批量签到操作">
    <div class="batch-selection">
      <n-checkbox v-model:checked="isAllChecked" :indeterminate="indeterminate" size="large" label="全选" @update:checked="handleCheckedChange" />
      <span>已选 <strong>{{ selectAccounts.length }}</strong> 个账号</span>
    </div>
    <div class="primary-actions">
      <n-button type="primary" :loading="loading" @click="handleSignAll()"><template #icon><Icon name="material-symbols:swipe-up-outline" /></template>批量签到</n-button>
      <n-button secondary @click="openQrCodeSignModal()"><template #icon><Icon name="mdi:qrcode-scan" /></template>批量扫码</n-button>
    </div>
    <QrCodeSignModal v-model:show="showQrCodeModal" :title="doingActivity?.course.name" @success="handleSuccess" />
    <CodeOrGestureSignModal v-model:show="showCodeOrGestureModal" :activity="doingActivity!" :loading="loading" @success="handleCodeOrGestureSignSuccess" />
  </div>
</template>

<style scoped>
.icon {
  --at-apply: cursor-pointer transition hover:text-red-4
}
</style>
