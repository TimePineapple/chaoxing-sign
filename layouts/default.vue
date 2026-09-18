<script setup lang="ts">
const route = useRoute()
const showFooter = computed(() => route.path !== '/auth/login')
</script>

<template>
  <div class="app-layout">
    <AppHeader />
    <main class="mobile-main">
      <slot />
    </main>
    <AppPwaInstall />
    <AppFooter v-if="showFooter" />
  </div>
</template>

<style lang="scss" scoped>
.app-layout {
  main {
    min-height: calc(100vh - var(--app-header-height) - var(--app-footer-height)),
  }
}
</style>
