<script lang="ts" setup>
const props = defineProps({
  showTitle: { type: Boolean, default: false },
})
const { title } = useAppConfig()
</script>

<template>
  <NuxtLink to="/" class="app-brand" aria-label="某星签到助手首页">
    <span class="brand-mark"><Icon name="majesticons:shooting-star-line" size="22" /></span>
    <h2 v-show="showTitle" class="brand-title">
      {{ title }}
    </h2>
  </NuxtLink>
</template>
