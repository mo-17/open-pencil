<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@open-pencil/vue'

import AppSelect from '@/components/ui/AppSelect.vue'
import { useMotionAnimationExport } from '@/app/document/export/motion/use-motion-animation-export'

const motionExport = useMotionAnimationExport()
const { panels } = useI18n()

const formatOptions = computed(() =>
  [
    { value: 'png-sequence' as const, label: panels.value.motionExportPngSequence },
    { value: 'gif' as const, label: panels.value.motionExportGif },
    { value: 'webm' as const, label: panels.value.motionExportWebm }
  ].map((option) => {
    const capability = motionExport.capabilities.value.find(
      (candidate) => candidate.format === option.value
    )
    return {
      ...option,
      label: capability?.available
        ? option.label
        : panels.value.motionExportUnavailable({ format: option.label })
    }
  })
)

const reducedOptions = computed(() => [
  { value: 'allow' as const, label: panels.value.motionExportReducedAllow },
  { value: 'reduce' as const, label: panels.value.motionExportReducedReduce },
  { value: 'disable' as const, label: panels.value.motionExportReducedDisable }
])

const sourceOptions = computed(() => [
  ...(motionExport.nodeSourceAvailable.value
    ? [{ value: 'nodes' as const, label: panels.value.motionExportSelectedNodes }]
    : []),
  ...(motionExport.sceneSourceAvailable.value
    ? [{ value: 'scene' as const, label: panels.value.motionExportScene }]
    : [])
])

const progressLabel = computed(() => {
  const progress = motionExport.progress.value
  if (!progress) return ''
  return panels.value.motionExportProgress({
    phase: progress.phase,
    completed: progress.completed,
    total: progress.total
  })
})
</script>

<template>
  <div class="mt-2 flex flex-col gap-1.5 border-t border-border pt-2" data-test-id="motion-export">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11px] font-medium text-surface">{{ panels.motionExportTitle }}</span>
      <span class="text-[10px] text-muted">{{
        panels.motionExportAnimatedCount({ count: motionExport.exportTargetCount.value })
      }}</span>
    </div>

    <p v-if="!motionExport.hasExportSource.value" class="text-[10px] text-muted">
      {{ panels.motionExportEmptyHint }}
    </p>

    <AppSelect
      v-if="sourceOptions.length > 1"
      v-model="motionExport.sourceMode.value"
      :options="sourceOptions"
      :label="panels.motionExportSource"
      data-test-id="motion-export-source"
      :ui="{ trigger: 'w-full' }"
    />

    <AppSelect
      v-if="
        motionExport.sourceMode.value === 'scene' && motionExport.sceneSequenceOptions.value.length
      "
      v-model="motionExport.sceneSequenceId.value"
      :options="motionExport.sceneSequenceOptions.value"
      :label="panels.motionExportSceneSequence"
      data-test-id="motion-export-scene-sequence"
      :ui="{ trigger: 'w-full' }"
    />

    <AppSelect
      v-model="motionExport.format.value"
      :options="formatOptions"
      :label="panels.motionExportFormat"
      data-test-id="motion-export-format"
      :ui="{ trigger: 'w-full' }"
    />

    <div class="grid grid-cols-2 gap-1.5">
      <label class="flex flex-col gap-0.5 text-[10px] text-muted">
        {{ panels.motionExportFps }}
        <input
          v-model.number="motionExport.fps.value"
          type="number"
          min="1"
          :max="motionExport.format.value === 'gif' ? 100 : 120"
          class="h-7 rounded border border-border bg-input px-2 text-[11px] text-surface"
          data-test-id="motion-export-fps"
        />
      </label>
      <label class="flex flex-col gap-0.5 text-[10px] text-muted">
        {{ panels.motionExportLoops }}
        <input
          v-model.number="motionExport.loops.value"
          type="number"
          min="1"
          max="100"
          class="h-7 rounded border border-border bg-input px-2 text-[11px] text-surface"
          data-test-id="motion-export-loops"
        />
      </label>
    </div>

    <AppSelect
      v-model="motionExport.reducedMotion.value"
      :options="reducedOptions"
      :label="panels.motionExportReducedPolicy"
      data-test-id="motion-export-reduced"
      :ui="{ trigger: 'w-full' }"
    />

    <p
      v-if="motionExport.capabilityLoading.value"
      class="text-[10px] text-muted"
      data-test-id="motion-export-capability"
    >
      {{ panels.motionExportDetectingCapability }}
    </p>
    <p v-else class="text-[10px] text-muted" data-test-id="motion-export-capability">
      {{ motionExport.activeCapability.value?.reason }}
      <span v-if="motionExport.activeCapability.value?.alpha === 'opaque-only'">
        · {{ panels.motionExportOpaqueOnly }}
      </span>
      <span v-else-if="motionExport.activeCapability.value?.alpha === 'binary-threshold'">
        · {{ panels.motionExportBinaryAlpha }}
      </span>
    </p>

    <div v-if="motionExport.exporting.value" class="flex items-center gap-2">
      <span
        class="min-w-0 flex-1 truncate text-[10px] text-muted"
        data-test-id="motion-export-progress"
      >
        {{ progressLabel }}
      </span>
      <button
        type="button"
        class="rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover"
        data-test-id="motion-export-cancel"
        @click="motionExport.cancel"
      >
        {{ panels.motionExportCancel }}
      </button>
    </div>

    <p
      v-if="motionExport.error.value"
      class="text-[10px] text-danger"
      data-test-id="motion-export-error"
    >
      {{ motionExport.error.value }}
    </p>
    <p
      v-else-if="motionExport.saved.value"
      class="text-[10px] text-success"
      data-test-id="motion-export-saved"
    >
      {{ panels.motionExportSaved }}
    </p>

    <button
      type="button"
      class="w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-default disabled:opacity-50"
      :disabled="!motionExport.canExport.value"
      data-test-id="motion-export-start"
      @click="motionExport.start"
    >
      {{ panels.motionExportStart({ format: motionExport.format.value }) }}
    </button>
  </div>
</template>
