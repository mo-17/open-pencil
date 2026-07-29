<script setup lang="ts">
import { computed } from 'vue'

import {
  getMotionChannels,
  MOTION_LIMITS,
  type MotionCompositeMode,
  type MotionDirection,
  type MotionEasing,
  type MotionFill,
  type MotionTrack,
  type MotionTrigger
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import type { MotionTrackTimingPatch } from '@/app/properties/motion/timeline'
import NumberField from '@/components/inputs/NumberField.vue'
import MotionEasingControls from '@/components/properties/MotionEasingControls.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'

const { track, iterationsValue, canDuplicate, canMoveUp, canMoveDown, renameError } = defineProps<{
  track: MotionTrack
  motionVersion: 1 | 2 | 3
  iterationsValue: number | 'infinite'
  canDuplicate: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  renameError?: string | null
}>()

const emit = defineEmits<{
  updateTrigger: [value: MotionTrigger]
  updateName: [value: string]
  updateComposition: [patch: { mode?: MotionCompositeMode; weight?: number; priority?: number }]
  upgradeComposition: []
  updateTiming: [patch: MotionTrackTimingPatch]
  updateExit: [value: NonNullable<MotionTrack['exit']>]
  updateEasing: [value: MotionEasing | undefined, coalesceKey?: string]
  toggleInfinite: [checked: boolean]
  rename: [value: string]
  duplicate: []
  move: [delta: -1 | 1]
}>()

const { panels } = useI18n()
const triggerOptions = computed<Array<{ value: MotionTrigger; label: string }>>(() => [
  { value: 'mount', label: panels.value.motionTriggerMount },
  { value: 'pageEnter', label: panels.value.motionTriggerPageEnter },
  { value: 'pageExit', label: panels.value.motionTriggerPageExit },
  { value: 'hover', label: panels.value.motionTriggerHover },
  { value: 'press', label: panels.value.motionTriggerPress },
  { value: 'focus', label: panels.value.motionTriggerFocus },
  { value: 'click', label: panels.value.motionTriggerClick },
  { value: 'inView', label: panels.value.motionTriggerInView },
  { value: 'loop', label: panels.value.motionTriggerLoop }
])
const directionOptions = computed<Array<{ value: MotionDirection; label: string }>>(() => [
  { value: 'normal', label: panels.value.motionDirectionNormal },
  { value: 'reverse', label: panels.value.motionDirectionReverse },
  { value: 'alternate', label: panels.value.motionDirectionAlternate },
  { value: 'alternate-reverse', label: panels.value.motionDirectionAlternateReverse }
])
const fillOptions = computed<Array<{ value: MotionFill; label: string }>>(() => [
  { value: 'none', label: panels.value.motionFillNone },
  { value: 'forwards', label: panels.value.motionFillForwards },
  { value: 'backwards', label: panels.value.motionFillBackwards },
  { value: 'both', label: panels.value.motionFillBoth }
])
const exitOptions = computed<Array<{ value: NonNullable<MotionTrack['exit']>; label: string }>>(
  () => [
    { value: 'none', label: panels.value.motionExitNone },
    { value: 'reverse', label: panels.value.motionExitReverse },
    { value: 'reset', label: panels.value.motionExitReset }
  ]
)
const supportsWeightedComposition = computed(() => {
  const channels = getMotionChannels(track.keyframes)
  return !Object.entries(channels).some(
    ([channel, active]) => active && !['opacity', 'translate', 'scale', 'rotate'].includes(channel)
  )
})
const compositionOptions = computed<Array<{ value: MotionCompositeMode; label: string }>>(() => [
  { value: 'replace', label: panels.value.motionCompositionReplace },
  ...(supportsWeightedComposition.value
    ? [
        { value: 'add' as const, label: panels.value.motionCompositionAdd },
        { value: 'accumulate' as const, label: panels.value.motionCompositionAccumulate }
      ]
    : [])
])

function onInfiniteChange(event: Event): void {
  emit('toggleInfinite', (event.target as HTMLInputElement).checked)
}

function onEasingUpdate(value: MotionEasing | undefined, coalesceKey?: string): void {
  emit('updateEasing', value, coalesceKey)
}

function commitRename(event: Event): void {
  emit('rename', (event.target as HTMLInputElement).value)
}

function commitTrackLabel(event: Event): void {
  emit('updateName', (event.target as HTMLInputElement).value)
}

function onRenameKeydown(event: KeyboardEvent): void {
  const input = event.target as HTMLInputElement
  if (event.key === 'Enter') input.blur()
  else if (event.key === 'Escape') {
    input.value = track.id
    input.blur()
  }
}
</script>

<template>
  <div class="mt-3 space-y-2 border-t border-border pt-3">
    <div class="flex items-center gap-1">
      <input
        :value="track.id"
        class="h-6 min-w-0 flex-1 rounded border bg-input px-1.5 font-mono text-[10px] text-surface outline-none focus:border-accent"
        :class="renameError ? 'border-red-500' : 'border-border'"
        :aria-label="panels.motionRenameTrack"
        :aria-invalid="renameError ? 'true' : undefined"
        data-test-id="motion-track-name"
        @change="commitRename"
        @keydown.stop="onRenameKeydown"
      />
      <IconButton
        :label="panels.motionDuplicateTrack"
        :disabled="!canDuplicate"
        data-test-id="motion-duplicate-track"
        @click="emit('duplicate')"
      >
        <icon-lucide-copy class="size-3" />
      </IconButton>
      <IconButton
        :label="panels.motionMoveTrackUp"
        :disabled="!canMoveUp"
        data-test-id="motion-move-track-up"
        @click="emit('move', -1)"
      >
        <icon-lucide-arrow-up class="size-3" />
      </IconButton>
      <IconButton
        :label="panels.motionMoveTrackDown"
        :disabled="!canMoveDown"
        data-test-id="motion-move-track-down"
        @click="emit('move', 1)"
      >
        <icon-lucide-arrow-down class="size-3" />
      </IconButton>
    </div>
    <p v-if="renameError" class="text-[10px] text-red-500" data-test-id="motion-track-name-error">
      {{ renameError }}
    </p>
    <PanelFieldGroup v-if="motionVersion === 3" :label="panels.motionTrackLabel">
      <input
        :value="track.name ?? ''"
        class="h-6 w-full rounded border border-border bg-input px-1.5 text-[10px] text-surface outline-none focus:border-accent"
        :aria-label="panels.motionTrackLabel"
        data-test-id="motion-track-label"
        maxlength="128"
        @change="commitTrackLabel"
        @keydown.stop
      />
    </PanelFieldGroup>
    <div
      v-if="motionVersion < 3"
      class="rounded border border-border bg-input/40 p-2"
      data-test-id="motion-composition-upgrade"
    >
      <p class="text-[10px] leading-4 text-muted">{{ panels.motionCompositionUpgradeHint }}</p>
      <button
        type="button"
        class="mt-1.5 h-7 w-full rounded bg-accent px-2 text-[10px] font-medium text-white hover:brightness-110"
        @click="emit('upgradeComposition')"
      >
        {{ panels.motionCompositionUpgrade }}
      </button>
    </div>
    <div
      v-else
      class="space-y-2 rounded border border-border p-2"
      data-test-id="motion-composition"
    >
      <PanelFieldGroup :label="panels.motionComposition">
        <AppSelect
          :model-value="track.composition?.mode ?? 'replace'"
          :label="panels.motionComposition"
          :options="compositionOptions"
          data-test-id="motion-composition-mode"
          @update:model-value="emit('updateComposition', { mode: $event })"
        />
      </PanelFieldGroup>
      <PanelGrid :columns="2">
        <PanelFieldGroup :label="panels.motionCompositionWeight">
          <NumberField
            :model-value="supportsWeightedComposition ? (track.composition?.weight ?? 1) : 1"
            :aria-label="panels.motionCompositionWeight"
            :min="0"
            :max="1"
            :step="0.05"
            :disabled="!supportsWeightedComposition"
            data-property="motion-composition-weight"
            @commit="emit('updateComposition', { weight: $event })"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="panels.motionCompositionPriority">
          <NumberField
            :model-value="track.composition?.priority ?? 0"
            :aria-label="panels.motionCompositionPriority"
            :min="-1000"
            :max="1000"
            :step="1"
            data-property="motion-composition-priority"
            @commit="emit('updateComposition', { priority: $event })"
          />
        </PanelFieldGroup>
      </PanelGrid>
      <p v-if="!supportsWeightedComposition" class="text-[10px] leading-4 text-muted">
        {{ panels.motionCompositionAdvancedConstraint }}
      </p>
    </div>
    <PanelFieldGroup :label="panels.motionTrigger">
      <AppSelect
        :model-value="track.trigger"
        :label="panels.motionTrigger"
        :options="triggerOptions"
        data-test-id="motion-track-trigger"
        @update:model-value="emit('updateTrigger', $event)"
      />
    </PanelFieldGroup>
    <PanelGrid :columns="2">
      <PanelFieldGroup :label="panels.motionDuration">
        <NumberField
          :model-value="track.timing.durationMs"
          :aria-label="`${panels.motionTrack} ${panels.motionDuration}`"
          :min="MOTION_LIMITS.durationMs.min"
          :max="MOTION_LIMITS.durationMs.max"
          suffix="ms"
          data-property="motion-track-duration"
          @commit="emit('updateTiming', { durationMs: $event })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="panels.motionDelay">
        <NumberField
          :model-value="track.timing.delayMs ?? 0"
          :aria-label="`${panels.motionTrack} ${panels.motionDelay}`"
          :min="MOTION_LIMITS.delayMs.min"
          :max="MOTION_LIMITS.delayMs.max"
          suffix="ms"
          data-property="motion-track-delay"
          @commit="emit('updateTiming', { delayMs: $event })"
        />
      </PanelFieldGroup>
    </PanelGrid>
    <MotionEasingControls
      :easing="track.timing.easing ?? 'ease'"
      :motion-version="motionVersion"
      property-prefix="motion-easing"
      data-test-id="motion-track-easing"
      @update="onEasingUpdate"
    />
    <div class="grid grid-cols-[1fr_auto] items-end gap-2">
      <PanelFieldGroup :label="panels.motionIterations">
        <NumberField
          :model-value="typeof iterationsValue === 'number' ? iterationsValue : 1"
          :aria-label="`${panels.motionTrack} ${panels.motionIterations}`"
          :min="MOTION_LIMITS.iterations.min"
          :max="MOTION_LIMITS.iterations.max"
          :step="1"
          :disabled="iterationsValue === 'infinite'"
          data-property="motion-track-iterations"
          @commit="emit('updateTiming', { iterations: $event })"
        />
      </PanelFieldGroup>
      <label class="flex h-6 items-center gap-1 text-[10px] text-muted">
        <input
          type="checkbox"
          class="size-3 accent-accent"
          :checked="iterationsValue === 'infinite'"
          @change="onInfiniteChange"
          @keydown.stop
        />
        {{ panels.motionInfinite }}
      </label>
    </div>
    <PanelGrid :columns="2">
      <PanelFieldGroup :label="panels.motionDirection">
        <AppSelect
          :model-value="track.timing.direction ?? 'normal'"
          :label="panels.motionDirection"
          :options="directionOptions"
          data-test-id="motion-track-direction"
          @update:model-value="emit('updateTiming', { direction: $event })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="panels.motionFill">
        <AppSelect
          :model-value="track.timing.fill ?? 'both'"
          :label="panels.motionFill"
          :options="fillOptions"
          data-test-id="motion-track-fill"
          @update:model-value="emit('updateTiming', { fill: $event })"
        />
      </PanelFieldGroup>
    </PanelGrid>
    <PanelFieldGroup :label="panels.motionExit">
      <AppSelect
        :model-value="track.exit ?? 'none'"
        :label="panels.motionExit"
        :options="exitOptions"
        data-test-id="motion-track-exit"
        @update:model-value="emit('updateExit', $event)"
      />
    </PanelFieldGroup>
  </div>
</template>
