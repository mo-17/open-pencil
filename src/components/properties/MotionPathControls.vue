<script setup lang="ts">
import { computed } from 'vue'

import {
  MOTION_LIMITS,
  type MotionCubicPath,
  type MotionKeyframe,
  type MotionPolylinePath,
  type MotionTrack
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import NumberField from '@/components/inputs/NumberField.vue'
import IconButton from '@/components/ui/IconButton.vue'

const { track, keyframe, motionVersion, editorActive } = defineProps<{
  track: MotionTrack
  keyframe: MotionKeyframe
  motionVersion: 1 | 2 | 3
  editorActive: boolean
}>()

const emit = defineEmits<{
  toggle: [enabled: boolean]
  updateProgress: [value: number]
  updateAutoRotate: [checked: boolean]
  updatePoint: [pointIndex: number, axis: 'x' | 'y', value: number]
  addPoint: []
  removePoint: [pointIndex: number]
  upgradeCubic: []
  toggleEditor: []
  addSegment: []
  removeSegment: [segmentIndex: number]
}>()

const { panels } = useI18n()
const polylinePath = computed<MotionPolylinePath | undefined>(() =>
  track.path?.version === 2 ? undefined : track.path
)
const cubicPath = computed<MotionCubicPath | undefined>(() =>
  track.path?.version === 2 ? track.path : undefined
)

function onToggle(event: Event): void {
  emit('toggle', (event.target as HTMLInputElement).checked)
}

function onAutoRotate(event: Event): void {
  emit('updateAutoRotate', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <section class="mt-3 space-y-2 border-t border-border pt-3" data-test-id="motion-path-controls">
    <label class="flex h-6 items-center gap-1.5 text-[10px] font-medium text-surface">
      <input
        type="checkbox"
        class="size-3 accent-accent"
        :checked="track.path !== undefined"
        :aria-label="panels.motionPath"
        data-test-id="motion-path-enabled"
        @change="onToggle"
        @keydown.stop
      />
      {{ panels.motionPath }}
    </label>
    <template v-if="track.path">
      <div class="grid grid-cols-[1fr_auto] items-center gap-2">
        <NumberField
          :model-value="keyframe.pathProgress ?? keyframe.offset"
          :label="panels.motionPathProgress"
          :min="MOTION_LIMITS.normalized.min"
          :max="MOTION_LIMITS.normalized.max"
          :step="0.01"
          data-property="motion-v2-pathProgress"
          @commit="emit('updateProgress', $event)"
        />
        <label class="flex h-6 items-center gap-1 text-[10px] text-muted">
          <input
            type="checkbox"
            class="size-3 accent-accent"
            :checked="track.path.autoRotate ?? false"
            data-test-id="motion-path-auto-rotate"
            @change="onAutoRotate"
            @keydown.stop
          />
          {{ panels.motionPathAutoRotate }}
        </label>
      </div>
      <div v-if="polylinePath" class="space-y-1.5" data-test-id="motion-path-points">
        <div
          v-for="(point, pointIndex) in polylinePath.points"
          :key="pointIndex"
          class="grid grid-cols-[20px_1fr_1fr_auto] items-center gap-1"
          :data-test-id="`motion-path-point-${pointIndex}`"
        >
          <span class="text-[9px] tabular-nums text-muted">{{ pointIndex + 1 }}</span>
          <NumberField
            :model-value="point.x"
            :label="panels.motionPathPointX"
            :min="MOTION_LIMITS.translate.min"
            :max="MOTION_LIMITS.translate.max"
            :step="1"
            :data-property="`motion-path-point-${pointIndex}-x`"
            @commit="emit('updatePoint', pointIndex, 'x', $event)"
          />
          <NumberField
            :model-value="point.y"
            :label="panels.motionPathPointY"
            :min="MOTION_LIMITS.translate.min"
            :max="MOTION_LIMITS.translate.max"
            :step="1"
            :data-property="`motion-path-point-${pointIndex}-y`"
            @commit="emit('updatePoint', pointIndex, 'y', $event)"
          />
          <IconButton
            :label="panels.motionPathRemovePoint"
            :disabled="polylinePath.points.length <= 2"
            :data-test-id="`motion-path-remove-point-${pointIndex}`"
            @click="emit('removePoint', pointIndex)"
          >
            <icon-lucide-minus class="size-3" />
          </IconButton>
        </div>
      </div>
      <button
        v-if="polylinePath"
        type="button"
        class="h-7 w-full rounded border border-border bg-input px-2 text-[10px] text-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="polylinePath.points.length >= MOTION_LIMITS.maxPathPoints"
        data-test-id="motion-path-add-point"
        @click="emit('addPoint')"
        @keydown.stop
      >
        {{ panels.motionPathAddPoint }}
      </button>
      <button
        v-if="polylinePath && motionVersion !== 1"
        type="button"
        class="h-7 w-full rounded border border-accent/50 bg-accent/10 px-2 text-[10px] text-accent hover:bg-accent/20"
        data-test-id="motion-path-upgrade-cubic"
        @click="emit('upgradeCubic')"
        @keydown.stop
      >
        {{ panels.motionPathUpgradeCubic }}
      </button>
      <div v-if="cubicPath" class="space-y-1.5" data-test-id="motion-path-segments">
        <button
          type="button"
          class="h-7 w-full rounded border border-accent bg-accent/15 px-2 text-[10px] text-surface hover:bg-accent/25"
          :data-active="editorActive"
          data-test-id="motion-path-edit-canvas"
          @click="emit('toggleEditor')"
          @keydown.stop
        >
          {{ editorActive ? panels.motionPathDoneEditing : panels.motionPathEditCanvas }}
        </button>
        <div
          v-for="(_segment, segmentIndex) in cubicPath.segments"
          :key="segmentIndex"
          class="flex h-6 items-center justify-between gap-2 rounded border border-border px-2"
          :data-test-id="`motion-path-segment-${segmentIndex}`"
        >
          <span class="text-[9px] tabular-nums text-muted">
            {{ panels.motionPathSegment({ segment: segmentIndex + 1 }) }}
          </span>
          <IconButton
            :label="panels.motionPathRemoveSegment({ segment: segmentIndex + 1 })"
            :disabled="cubicPath.segments.length <= 1"
            :data-test-id="`motion-path-remove-segment-${segmentIndex}`"
            @click="emit('removeSegment', segmentIndex)"
          >
            <icon-lucide-minus class="size-3" />
          </IconButton>
        </div>
        <button
          type="button"
          class="h-7 w-full rounded border border-border bg-input px-2 text-[10px] text-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="cubicPath.segments.length >= MOTION_LIMITS.maxPathSegments"
          data-test-id="motion-path-add-segment"
          @click="emit('addSegment')"
          @keydown.stop
        >
          {{ panels.motionPathAddSegment }}
        </button>
      </div>
    </template>
  </section>
</template>
