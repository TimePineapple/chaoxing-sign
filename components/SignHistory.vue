<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { signModeMap, signTypeMap } from '~/constants/cx'

const props = defineProps<{
  show: boolean
  uid: string
}>()

const emit = defineEmits<{
  (e: 'update:show', show: boolean): void
}>()

const active = computed({
  get() {
    return props.show
  },
  set(show: boolean) {
    emit('update:show', show)
  },
})

const { data: historyList, pending, refresh } = await useLazyAsyncData(`${props.uid}_sign_history`,
  async () => {
    const { data } = await request(`/api/cx/accounts/${props.uid}/sign_history`, {
      method: 'POST',
      body: {
        uid: props.uid,
      },
    })
    return data
  },
  {
    immediate: false,
    server: false,
  },
)

watch(active, (value) => {
  if (value)
    refresh()
})
</script>

<template>
  <n-drawer v-model:show="active" height="85dvh" placement="bottom" class="history-sheet">
    <n-drawer-content title="签到记录" closable :native-scrollbar="false">
      <n-spin :show="pending">
        <n-list v-if="historyList?.length! > 0" hoverable clickable>
          <n-list-item v-for="item in historyList" :key="item.id">
            <n-thing content-style="margin-top: 10px;">
              <template #header>
                <n-space>
                  <span>{{ item.activityName }}</span>
                  <n-tag type="info" size="small">
                    {{ signTypeMap[item.type] }}
                  </n-tag>
                  <n-tag type="success" size="small">
                    {{ signModeMap[item.mode] }}
                  </n-tag>
                </n-space>
              </template>
              <template #description>{{ useDateFormat(item.time, 'YYYY-MM-DD hh-mm-ss').value }}</template>
              {{ item.result }}
            </n-thing>
          </n-list-item>
        </n-list>
        <n-result v-else class="mt-4" status="info" title="暂无签到记录" size="small" />
      </n-spin>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>

</style>
