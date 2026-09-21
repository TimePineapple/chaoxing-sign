<script setup lang="ts">
import homePreview from '~/docs/ui-preview/portrait-home.png'
import loginPreview from '~/docs/ui-preview/portrait-login.png'
import qrPreview from '~/docs/ui-preview/portrait-qr.png'
import settingsPreview from '~/docs/ui-preview/portrait-settings.png'
import readme from '~/README.md?raw'

definePageMeta({
  auth: false,
  layout: 'page',
})

const helpStartMarker = '<!-- help:start -->'
const helpEndMarker = '<!-- help:end -->'

function extractHelpMarkdown(source: string) {
  const start = source.indexOf(helpStartMarker)
  const end = source.indexOf(helpEndMarker)

  if (start === -1 || end === -1 || end <= start)
    throw new Error('README help markers are missing or out of order')

  return source.slice(start + helpStartMarker.length, end).trim()
}

const previewAssets: Record<string, string> = {
  './docs/ui-preview/portrait-login.png': loginPreview,
  './docs/ui-preview/portrait-home.png': homePreview,
  './docs/ui-preview/portrait-qr.png': qrPreview,
  './docs/ui-preview/portrait-settings.png': settingsPreview,
}

const helpMarkdown = Object.entries(previewAssets).reduce(
  (markdown, [source, asset]) => markdown.replaceAll(source, asset),
  extractHelpMarkdown(readme).replace(/^(#{2,6}) /gm, heading => `${heading.slice(1)}`),
)
</script>

<template>
  <MDC :value="helpMarkdown" />
</template>
