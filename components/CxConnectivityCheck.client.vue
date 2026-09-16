<script setup lang="ts">
interface ConnectivityResponse {
  code: number
  data: {
    ok: boolean
    message?: string
  }
}

const { status, data } = useAuth()
const notification = useNotification()
let checking = false
let checked = false

function notifyFailure(message: string) {
  notification.error({
    title: '学习通连接失败',
    content: message,
    meta: '服务器当前可能无法完成学习通登录或签到，请联系管理员检查代理与出口网络。',
    duration: 0,
    keepAliveOnHover: true,
    closable: true,
  })
}

async function checkConnectivityOnce() {
  if (status.value !== 'authenticated' || checking || checked)
    return

  checked = true
  checking = true
  try {
    const response = await $fetch<ConnectivityResponse>('/api/cx/connectivity')
    if (!response?.data?.ok)
      notifyFailure(response?.data?.message || '服务器访问学习通登录页失败')
  }
  catch {
    notifyFailure('连通性检测请求失败，请检查服务端是否正常运行')
  }
  finally {
    checking = false
  }
}

watch([status, data], checkConnectivityOnce, { immediate: true })
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
