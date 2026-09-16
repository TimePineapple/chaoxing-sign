<script setup lang="ts">
import 'assets/css/preflight.css'
import { darkTheme, dateZhCN, lightTheme, zhCN } from 'naive-ui'

const colorMode = useColorMode()
const { title, keywords, description } = useAppConfig()

const theme = computed(() => {
  return colorMode.value === 'system' ? (colorMode.value ? lightTheme : darkTheme) : colorMode.value === 'light' ? lightTheme : darkTheme
})

const themeColor = ref('#e70012')

const themeOverrides = computed(() => {
  const theme = unref(themeColor)
  const lightenStr = lighten(theme, 6)

  return {
    common: {
      primaryColor: theme,
      primaryColorHover: lightenStr,
      primaryColorPressed: lightenStr,
      primaryColorSuppl: theme,
      borderRadius: '14px',
      fontSize: '16px',
      heightMedium: '44px',
      heightLarge: '48px',
    },
  }
})

useHead({
  title,
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    {
      key: 'webmanifest',
      rel: 'manifest',
      href: '/manifest.webmanifest',
    },
  ],
  meta: [
    {
      name: 'keywords',
      content: keywords,
    },
    {
      name: 'description', content: description,
    },
    {
      name: 'referrer', content: 'no-referrer',
    },
  ],
})
</script>

<template>
  <n-config-provider
    cls-prefix="n"
    :locale="zhCN" :date-locale="dateZhCN"
    :theme="theme"
    :theme-overrides="themeOverrides"
    :inline-theme-disabled="true"
  >
    <n-global-style />
    <VitePwaManifest />
    <NuxtLoadingIndicator />

    <n-notification-provider placement="top-right" :max="2">
      <CxConnectivityCheck />
      <n-message-provider keep-alive-on-hover>
        <NuxtLayout>
          <NuxtPage />
        </NuxtLayout>
      </n-message-provider>
    </n-notification-provider>
  </n-config-provider>
</template>
