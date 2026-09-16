<script setup lang="ts">
import { useThemeVars } from 'naive-ui'

interface FooterConfig {
  githubUrl: string
  version: string
  buildText: string
  authorName: string
  originalAuthorName: string
  authorUrl: string
  originalAuthorUrl: string
}

const themeVars = useThemeVars()
const footer = useRuntimeConfig().public.footerConfig as FooterConfig
</script>

<template>
  <section class="project-info" :style="{ borderColor: themeVars.borderColor }" aria-label="项目信息">
    <div class="project-info-content">
      <div class="project-info-row project-info-row-primary">
        <a class="project-info-item project-info-item-link" :href="footer.githubUrl" target="_blank" rel="noopener noreferrer" aria-label="项目 GitHub">
          <Icon name="ri:github-line" class="project-info-icon" />GitHub
        </a>
        <span class="project-info-item"><Icon name="ri:file-code-line" class="project-info-icon" /><span>版本: {{ footer.version }}</span></span>
        <span class="project-info-item"><Icon name="ri:building-2-line" class="project-info-icon" /><span>构建于: {{ footer.buildText }}</span></span>
      </div>
      <div class="project-info-row project-info-row-secondary">
        <a class="project-info-item project-info-item-link" :href="footer.authorUrl" target="_blank" rel="noopener noreferrer"><Icon name="ri:user-star-line" class="project-info-icon" />作者：{{ footer.authorName }}</a>
        <a class="project-info-item project-info-item-link" :href="footer.originalAuthorUrl" target="_blank" rel="noopener noreferrer"><Icon name="ri:user-line" class="project-info-icon" />原作者：{{ footer.originalAuthorName }}</a>
      </div>
    </div>
  </section>
</template>
