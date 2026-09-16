<template>
  <div class="app-layout">
    <AppHeader />
    <main class="mobile-main">
      <slot />
    </main>
    <AppPwaInstall />
    <AppFooter />
  </div>
</template>

<style lang="scss" scoped>
.app-layout {
  main {
    min-height: calc(100vh - var(--app-header-height) - var(--app-footer-height)),
  }
}
</style>
