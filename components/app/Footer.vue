<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import pkg from '~/package.json'

const themeVars = useThemeVars()
</script>

<template>
  <footer class="mobile-footer" :style="{ borderColor: themeVars.borderColor }">
    <div class="footer-content">
      <div class="footer-details">
        <div class="footer-links">
          <NuxtLink :to="pkg.author.url" target="_blank" class="flex items-center gap-1 text-xs">
            <i class="i-ri-user-star-line" />
            <p class="font-semibold">
              作者: {{ pkg.author.name }}
            </p>
          </NuxtLink>
          <span class="flex items-center gap-1 text-xs">
            <i class="i-ri-file-code-line" />
            <p class="font-semibold">
              版本: {{ pkg.version }}
            </p>
          </span>
          <div class="flex items-center gap-1 text-xs">
            <i class="i-ri-building-2-line " />
            <span class="font-semibold">
              构建于:
            </span>
            <NuxtLink to="https://nuxt.com/" class="block bg-emerald-400 rounded px-1 py-0.5 text-white text-xs" target="_blank">
              nuxt@{{ pkg.devDependencies.nuxt }}
            </NuxtLink>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <NuxtLink class="action-link" :to="pkg.repository.url" target="_blank" aria-label="项目 GitHub"><Icon name="ri:github-line" />GitHub</NuxtLink>
        </div>
      </div>
    </div>
  </footer>
</template>
