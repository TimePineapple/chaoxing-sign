<script setup lang="ts">
import type { LogInst } from 'naive-ui'

const logStore = useLogStore()
const logList = computed(() => logStore.logList)
const logInstRef = ref<LogInst | null>(null)

onMounted(() => {
  watchEffect(() => {
    if (logList.value.length) {
      nextTick(() => {
        logInstRef.value?.scrollTo({ position: 'bottom', slient: true })
      })
    }
  })
})
</script>

<template>
  <n-card class="log-card">
    <template #header>
      <div class="inline-flex justify-center items-center gap-1">
        <Icon name="material-symbols:docs-outline" />
        日志
      </div>
    </template>
    <template #header-extra>
      <div class="inline-flex justify-center items-center gap-2">
        <n-popconfirm @positive-click="logStore.cleanLog()">
          <template #trigger>
            <button class="icon-button" type="button" aria-label="清空操作日志"><Icon name="material-symbols:cleaning-services" /></button>
          </template>
          确认清除所有日志?
        </n-popconfirm>

        <button class="icon-button" type="button" :aria-label="logStore.showLog ? '收起操作日志' : '展开操作日志'" :aria-expanded="logStore.showLog" @click="logStore.showLog = !logStore.showLog"><Icon :name="logStore.showLog ? 'tabler:layout-bottombar-collapse' : 'tabler:layout-navbar-collapse'" /></button>
      </div>
    </template>
    <n-collapse-transition :show="logStore.showLog">
      <n-log ref="logInstRef" class="text-left" :rows="10" :log="logList.join('\n')" trim />
    </n-collapse-transition>
  </n-card>
</template>
