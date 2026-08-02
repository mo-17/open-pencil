<script setup lang="ts">
import { computed } from 'vue'
import { twMerge } from 'tailwind-merge'

type AppBadgeTone = 'accent' | 'neutral' | 'success' | 'warning' | 'error'

const { ui, tone = 'accent' } = defineProps<{
  tone?: AppBadgeTone
  ui?: {
    base?: string
  }
}>()

const toneClasses: Record<AppBadgeTone, string> = {
  accent: 'bg-accent/10 text-accent',
  neutral: 'border border-border bg-input text-muted',
  success: 'border border-success/30 bg-panel text-success',
  warning:
    'border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]',
  error: 'border border-error/30 bg-panel text-error'
}

const cls = computed(() =>
  twMerge(
    'inline-flex shrink-0 items-center gap-1 rounded px-1 py-px text-[9px] font-medium leading-none',
    toneClasses[tone],
    ui?.base
  )
)
</script>

<template>
  <span :class="cls"><slot /></span>
</template>
