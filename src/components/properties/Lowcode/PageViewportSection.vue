<script setup lang="ts">
import { usePageViewport } from '@/app/lowcode/page-viewport/use'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { selection, options, hint, panels } = usePageViewport()
</script>

<template>
  <section class="mt-2 space-y-1.5" data-test-id="page-viewport-section">
    <label class="text-[11px] text-muted" for="page-viewport-select">
      {{ panels.lowcodePageViewport }}
    </label>
    <AppSelect
      :key="selection.version"
      id="page-viewport-select"
      :model-value="selection.mode"
      :options="options"
      :label="panels.lowcodePageViewport"
      :disabled="selection.disabled"
      data-test-id="page-viewport-select"
      aria-describedby="page-viewport-hint"
      @update:model-value="selection.select"
    />
    <p id="page-viewport-hint" class="text-[10px] leading-relaxed text-muted">
      {{ hint }}
    </p>
  </section>
</template>
