<script setup lang="ts">
import { useThemeVars } from 'naive-ui'

const show = ref(false)

const themeVars = useThemeVars()
</script>

<template>
  <header
    class="mobile-header"
    :style="{ borderColor: themeVars.borderColor }"
  >
    <div class="header-content">
      <AppLogo :show-title="true" />

      <div class="flex-1" />

      <div class="header-actions">
        <AppNav />
        <AppThemeSwitcher />
        <UserButton />
      </div>

    </div>
  </header>
</template>
