<script setup lang="ts">
const colorMode = useColorMode()

const isDark = computed(() => colorMode.preference === 'dark')

function toggleDark() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <button class="icon-button" type="button" :aria-label="isDark ? '切换浅色模式' : '切换深色模式'" @click="toggleDark">
    <Icon :name="isDark ? 'ri:moon-line' : 'ri:sun-line'" />
  </button>
</template>
