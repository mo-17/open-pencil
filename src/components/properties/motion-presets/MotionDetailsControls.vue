<script setup lang="ts">
import { MOTION_LIMITS } from '@open-pencil/scene-graph'

import NumberField from '@/components/inputs/NumberField.vue'
import FigmaMotionAdapterCard from '@/components/properties/FigmaMotionAdapterCard.vue'
import MotionTimelineEditor from '@/components/properties/MotionTimelineEditor.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'

import {
  useMotionDetailsControls,
  type MotionDetailsControlsProps
} from './use/motion-details-controls'

const { selection, selectedIds } = defineProps<MotionDetailsControlsProps>()

const {
  panels,
  previewVisible,
  singleMotionNode,
  authoringDisabled,
  distanceRule,
  intensityRule,
  statusText,
  triggerOptions,
  triggerValue,
  reducedMotionOptions,
  reducedMotionValue,
  previewAvailable,
  canPreview,
  numberValue,
  previewSelection,
  stopPreview,
  clearMotion,
  updateTrigger,
  updateReducedMotion,
  updateTiming,
  updateParameter
} = useMotionDetailsControls({
  selection: () => selection,
  selectedIds: () => selectedIds
})
</script>

<template>
  <p v-if="statusText" data-test-id="motion-status" class="mt-2 text-[11px] leading-4 text-muted">
    {{ statusText }}
  </p>

  <div v-if="selection.hasMotion" class="mt-3 space-y-2">
    <PanelFieldGroup :label="panels.motionTrigger">
      <AppSelect
        :model-value="triggerValue"
        :label="panels.motionTrigger"
        :options="triggerOptions"
        :disabled="!selection.allHaveMotion || authoringDisabled"
        class="w-full"
        data-test-id="motion-trigger"
        @update:model-value="updateTrigger"
      />
    </PanelFieldGroup>

    <PanelGrid :columns="2">
      <PanelFieldGroup :label="panels.motionDuration">
        <NumberField
          :model-value="numberValue(selection.durationMs)"
          :placeholder="panels.mixed"
          :aria-label="panels.motionDuration"
          :min="MOTION_LIMITS.durationMs.min"
          :max="MOTION_LIMITS.durationMs.max"
          :disabled="!selection.allHaveMotion || authoringDisabled"
          data-property="motion-duration"
          @commit="(value: number) => updateTiming('durationMs', value)"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="panels.motionDelay">
        <NumberField
          :model-value="numberValue(selection.delayMs)"
          :placeholder="panels.mixed"
          :aria-label="panels.motionDelay"
          :min="MOTION_LIMITS.delayMs.min"
          :max="MOTION_LIMITS.delayMs.max"
          :disabled="!selection.allHaveMotion || authoringDisabled"
          data-property="motion-delay"
          @commit="(value: number) => updateTiming('delayMs', value)"
        />
      </PanelFieldGroup>
    </PanelGrid>

    <PanelFieldGroup :label="panels.motionReducedMotion">
      <AppSelect
        :model-value="reducedMotionValue"
        :label="panels.motionReducedMotion"
        :options="reducedMotionOptions"
        :disabled="!selection.allHaveMotion || authoringDisabled"
        class="w-full"
        data-test-id="motion-reduced-motion"
        @update:model-value="updateReducedMotion"
      />
    </PanelFieldGroup>

    <PanelGrid v-if="distanceRule || intensityRule" :columns="2">
      <PanelFieldGroup v-if="distanceRule" :label="panels.motionDistance">
        <NumberField
          :model-value="numberValue(selection.distance)"
          :placeholder="panels.mixed"
          :aria-label="panels.motionDistance"
          :min="distanceRule.min"
          :max="distanceRule.max"
          :disabled="!selection.allHaveMotion || authoringDisabled"
          data-property="motion-distance"
          @commit="(value: number) => updateParameter('distance', value)"
        />
      </PanelFieldGroup>
      <PanelFieldGroup v-if="intensityRule" :label="panels.motionIntensity">
        <NumberField
          :model-value="numberValue(selection.intensity)"
          :placeholder="panels.mixed"
          :aria-label="panels.motionIntensity"
          :min="intensityRule.min"
          :max="intensityRule.max"
          :step="0.1"
          :disabled="!selection.allHaveMotion || authoringDisabled"
          data-property="motion-intensity"
          @commit="(value: number) => updateParameter('intensity', value)"
        />
      </PanelFieldGroup>
    </PanelGrid>

    <div class="flex gap-1.5 pt-1">
      <button
        v-if="!previewVisible"
        type="button"
        data-test-id="motion-preview"
        class="h-7 flex-1 rounded border border-border bg-input px-2 text-[11px] text-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canPreview"
        @click="previewSelection"
        @keydown.stop
      >
        {{ panels.motionPreview }}
      </button>
      <button
        v-else
        type="button"
        data-test-id="motion-stop-preview"
        class="h-7 flex-1 rounded border border-accent bg-accent/15 px-2 text-[11px] text-surface hover:bg-accent/25"
        @click="stopPreview"
        @keydown.stop
      >
        {{ panels.motionStopPreview }}
      </button>
      <button
        type="button"
        data-test-id="motion-clear"
        class="h-7 flex-1 rounded border border-border bg-input px-2 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="clearMotion"
        @keydown.stop
      >
        {{ panels.motionClear }}
      </button>
    </div>
    <p v-if="!previewAvailable" class="text-[10px] leading-4 text-muted">
      {{ panels.motionPreviewUnavailable }}
    </p>

    <MotionTimelineEditor
      v-if="singleMotionNode?.motion && !authoringDisabled"
      :node="singleMotionNode"
      :node-id="singleMotionNode.id"
      :motion="singleMotionNode.motion"
    />
    <FigmaMotionAdapterCard
      v-if="singleMotionNode?.motion && !authoringDisabled"
      :motion="singleMotionNode.motion"
      :opacity="singleMotionNode.opacity"
    />
  </div>
</template>
