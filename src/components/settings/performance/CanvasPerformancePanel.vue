<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import {
  AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE,
  canvasPerformanceMode,
  canvasPerformancePreference,
  type CanvasPerformancePreference
} from '@/app/settings/canvas-performance'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'

const { dialogs } = useI18n()

const modeOptions = computed<Array<{ value: CanvasPerformancePreference; label: string }>>(() => [
  {
    value: AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE,
    label: dialogs.value.canvasPerformanceAutomatic
  },
  {
    value: 'resource-saving',
    label: dialogs.value.canvasPerformanceResourceSaving
  },
  {
    value: 'balanced',
    label: dialogs.value.canvasPerformanceBalanced
  },
  {
    value: 'smooth',
    label: dialogs.value.canvasPerformanceSmooth
  }
])

const selectedHint = computed(() => {
  if (canvasPerformancePreference.value === AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE) {
    return dialogs.value.canvasPerformanceAutomaticHint
  }
  if (canvasPerformancePreference.value === 'resource-saving') {
    return dialogs.value.canvasPerformanceResourceSavingHint
  }
  if (canvasPerformancePreference.value === 'smooth') {
    return dialogs.value.canvasPerformanceSmoothHint
  }
  return dialogs.value.canvasPerformanceBalancedHint
})

const effectiveModeLabel = computed(() => {
  if (canvasPerformanceMode.value === 'resource-saving') {
    return dialogs.value.canvasPerformanceResourceSaving
  }
  if (canvasPerformanceMode.value === 'smooth') return dialogs.value.canvasPerformanceSmooth
  return dialogs.value.canvasPerformanceBalanced
})
</script>

<template>
  <section class="flex flex-col gap-3" data-test-id="settings-performance-panel">
    <div>
      <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsCanvasPerformance }}</h3>
      <p class="mt-0.5 text-[10px] text-muted">
        {{ dialogs.canvasPerformanceDescription }}
      </p>
    </div>

    <SegmentedControl
      v-model="canvasPerformancePreference"
      :options="modeOptions"
      :label="dialogs.canvasPerformanceMode"
      :ui="{ root: 'w-full', item: 'min-w-0 flex-1 px-2' }"
      data-test-id="settings-canvas-performance-mode"
    />

    <p
      class="rounded border border-border bg-input/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted"
      data-test-id="settings-canvas-performance-hint"
    >
      {{ selectedHint }}
      <span
        v-if="canvasPerformancePreference === AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE"
        class="mt-1 block font-medium text-surface"
        data-test-id="settings-canvas-performance-effective-mode"
      >
        {{ dialogs.canvasPerformanceAutomaticCurrent.replace('{mode}', effectiveModeLabel) }}
      </span>
    </p>
  </section>
</template>
