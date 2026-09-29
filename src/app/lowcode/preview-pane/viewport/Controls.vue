<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'

import type { PreviewViewport } from './use'

const viewport = defineModel<PreviewViewport>({ required: true })
const { locale } = useI18n()
</script>

<template>
  <label
    class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-panel px-3 py-1.5 text-xs text-muted"
  >
    <span>{{ locale.startsWith('zh') ? '预览尺寸' : 'Preview size' }}</span>
    <select
      v-model="viewport"
      data-test-id="lowcode-preview-viewport"
      :aria-label="locale.startsWith('zh') ? '预览尺寸' : 'Preview size'"
      class="h-7 rounded border border-border bg-input px-2 text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <option value="fit">{{ locale.startsWith('zh') ? '适应面板' : 'Fit panel' }}</option>
      <option value="phone">
        {{ locale.startsWith('zh') ? '手机 · 390 × 844' : 'Phone · 390 × 844' }}
      </option>
      <option value="landscape">
        {{ locale.startsWith('zh') ? '横屏 · 844 × 390' : 'Landscape · 844 × 390' }}
      </option>
      <option value="tablet">
        {{ locale.startsWith('zh') ? '平板 · 768 × 1024' : 'Tablet · 768 × 1024' }}
      </option>
      <option value="desktop">
        {{ locale.startsWith('zh') ? '桌面 · 1440 × 1000' : 'Desktop · 1440 × 1000' }}
      </option>
    </select>
  </label>
</template>
