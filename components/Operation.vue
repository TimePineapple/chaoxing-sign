<script setup lang="ts">
import { SignTypeEnum } from '~/constants/cx'
import { createQrSignTraceId, parseQrCodeSignLink, qrCodeRequestError } from '~/utils/qrCodeSign'

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
const qrCodeLoading = ref(false)
const qrCodeResults = ref<{ uid: string; name: string; traceId: string; status: 'pending' | 'success' | 'error'; message: string }[]>([])
const qrCodeSummary = ref('')
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

  doingActivity.value = null
  qrCodeResults.value = []
  qrCodeSummary.value = ''
  showQrCodeModal.value = true
}

async function handleSuccess(result: string) {
  if (qrCodeLoading.value)
    return

  const toAccounts = [...unref(selectAccounts)]
  qrCodeResults.value = []
  if (toAccounts.length === 0) {
    qrCodeSummary.value = '没有选中账号，请关闭扫码窗口后选择账号'
    return logStore.log('请先选择账号', { type: 'warning' })
  }

  const activity = doingActivity.value
  const courseId = String(activity?.id) === parseQrCodeSignLink(result)?.activityId
    ? activity?.course?.courseId
    : undefined

  qrCodeLoading.value = true
  qrCodeSummary.value = `正在提交 ${toAccounts.length} 个账号，请等待各账号结果`
  qrCodeResults.value = toAccounts.map(account => ({
    uid: account.uid,
    name: account.info?.realname || account.uid,
    traceId: createQrSignTraceId(),
    status: 'pending',
    message: '请求已发起，等待服务器返回（最多 45 秒）',
  }))
  console.info('[qr-code-sign] 批量扫码开始', { count: toAccounts.length, traceIds: qrCodeResults.value.map(row => row.traceId) })
  try {
    await Promise.all(toAccounts.map(async (account, index) => {
      const row = qrCodeResults.value[index]
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
      }
    }))

    const successCount = qrCodeResults.value.filter(item => item.status === 'success').length
    const failedCount = qrCodeResults.value.length - successCount
    // Commit visible results before optional toast/log side effects.
    qrCodeSummary.value = `批量扫码完成：成功 ${successCount} 个，失败 ${failedCount} 个`
    for (const row of qrCodeResults.value) {
      if (row.status === 'error')
        logStore.log(`账号: ${row.name} (${row.uid}) 扫码失败: ${row.message}`, { type: 'error' })
    }
    logStore.log(qrCodeSummary.value, {
      type: failedCount === 0 ? 'success' : successCount === 0 ? 'error' : 'warning',
    })
  }
  catch {
    // A broken message renderer must not hide completed account results.
    console.warn('[qr-code-sign] 无法显示签到日志，请查看弹窗内各账号结果')
  }
  finally {
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
  <div class="batch-bar" role="region" aria-label="批量签到操作">
    <div class="batch-selection">
      <n-checkbox v-model:checked="isAllChecked" :indeterminate="indeterminate" size="large" label="全选" @update:checked="handleCheckedChange" />
      <span>已选 <strong>{{ selectAccounts.length }}</strong> 个账号</span>
    </div>
    <div class="primary-actions">
      <n-button type="primary" :loading="loading" @click="handleSignAll()"><template #icon><Icon name="material-symbols:swipe-up-outline" /></template>批量签到</n-button>
      <n-button secondary :disabled="qrCodeLoading" @click="openQrCodeSignModal()"><template #icon><Icon name="mdi:qrcode-scan" /></template>批量扫码</n-button>
    </div>
    <QrCodeSignModal v-model:show="showQrCodeModal" :title="doingActivity?.course?.name ?? '批量扫码'" :loading="qrCodeLoading" @success="handleSuccess">
      <template #result>
        <p v-if="qrCodeSummary" role="status" class="mb-2">{{ qrCodeSummary }}</p>
        <ul v-if="qrCodeResults.length" aria-label="各账号扫码结果" class="mb-3">
          <li v-for="item in qrCodeResults" :key="item.uid">
            <n-text :type="item.status === 'pending' ? 'info' : item.status">{{ item.name }} ({{ item.uid }}): {{ item.message }}（追踪号 {{ item.traceId }}）</n-text>
          </li>
        </ul>
      </template>
    </QrCodeSignModal>
    <CodeOrGestureSignModal v-model:show="showCodeOrGestureModal" :activity="doingActivity!" :loading="loading" @success="handleCodeOrGestureSignSuccess" />
  </div>
</template>

<style scoped>
.icon {
  --at-apply: cursor-pointer transition hover:text-red-4
}
</style>
