<script setup lang="ts">
import { computed } from 'vue'

import {
  MOTION_LIMITS,
  type MotionEasing,
  type MotionKeyframe,
  type MotionSpec,
  type SceneNode,
  type MotionTrack
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { MOTION_CHANNELS, type MotionChannel } from '@/app/properties/motion/timeline'
import type {
  MotionColorComponent,
  MotionV2ColorChannel,
  MotionV2NumericChannel
} from '@/app/properties/motion/v2'
import NumberField from '@/components/inputs/NumberField.vue'
import MotionAdvancedChannels from '@/components/properties/MotionAdvancedChannels.vue'
import MotionEasingControls from '@/components/properties/MotionEasingControls.vue'
import MotionPathControls from '@/components/properties/MotionPathControls.vue'
import {
  MotionStructuredChannelsRoot,
  type MotionStructuredChannelLabels
} from '@/components/properties/motion-structured'
import IconButton from '@/components/ui/IconButton.vue'

const { keyframe, keyframeIndex, canEditOffset, canDuplicate } = defineProps<{
  node: SceneNode
  motion: MotionSpec
  keyframe: MotionKeyframe
  track: MotionTrack
  motionVersion: 1 | 2 | 3
  keyframeIndex: number
  canEditOffset: boolean
  canDuplicate: boolean
  pathEditorActive: boolean
}>()

const emit = defineEmits<{
  updateOffset: [value: number]
  toggleChannel: [channel: MotionChannel, enabled: boolean]
  updateChannel: [channel: MotionChannel, value: number]
  updateEasing: [value: MotionEasing | undefined, coalesceKey?: string]
  duplicate: []
  upgradeVersion: []
  toggleAdvancedNumeric: [channel: MotionV2NumericChannel, enabled: boolean]
  updateAdvancedNumeric: [channel: MotionV2NumericChannel, value: number]
  toggleAdvancedColor: [channel: MotionV2ColorChannel, enabled: boolean]
  updateAdvancedColor: [
    channel: MotionV2ColorChannel,
    component: MotionColorComponent,
    value: number
  ]
  togglePath: [enabled: boolean]
  updatePathProgress: [value: number]
  updatePathAutoRotate: [checked: boolean]
  updatePathPoint: [pointIndex: number, axis: 'x' | 'y', value: number]
  addPathPoint: []
  removePathPoint: [pointIndex: number]
  upgradePathToCubic: []
  togglePathEditor: []
  addPathSegment: []
  removePathSegment: [segmentIndex: number]
  commitStructured: [spec: MotionSpec, undoLabel: string]
}>()

const { panels } = useI18n()
const channelLabels = computed<Record<MotionChannel, string>>(() => ({
  opacity: panels.value.motionChannelOpacity,
  x: panels.value.motionChannelX,
  y: panels.value.motionChannelY,
  scaleX: panels.value.motionChannelScaleX,
  scaleY: panels.value.motionChannelScaleY,
  rotate: panels.value.motionChannelRotate
}))
const structuredLabels = computed<MotionStructuredChannelLabels>(() => ({
  title: panels.value.motionStructuredTitle,
  upgrade: panels.value.motionCompositionUpgrade,
  upgradeHint: panels.value.motionStructuredUpgradeHint,
  enable: panels.value.motionStructuredEnable,
  remove: panels.value.motionStructuredRemove,
  addTarget: panels.value.motionStructuredAddTarget,
  paints: panels.value.motionStructuredPaints,
  gradientStops: panels.value.motionStructuredGradientStops,
  effects: panels.value.motionStructuredEffects,
  cornerRadii: panels.value.motionStructuredCornerRadii,
  textReveal: panels.value.motionStructuredTextReveal,
  fontAxes: panels.value.motionStructuredFontAxes,
  vectorMorph: panels.value.motionStructuredVectorMorph,
  opacity: panels.value.opacity,
  position: panels.value.position,
  radius: panels.value.radius,
  x: panels.value.motionChannelX,
  y: panels.value.motionChannelY,
  blur: panels.value.motionBlur,
  spread: panels.value.spread,
  red: panels.value.motionColorRed,
  green: panels.value.motionColorGreen,
  blue: panels.value.motionColorBlue,
  alpha: panels.value.motionColorAlpha,
  topLeft: panels.value.motionStructuredTopLeft,
  topRight: panels.value.motionStructuredTopRight,
  bottomRight: panels.value.motionStructuredBottomRight,
  bottomLeft: panels.value.motionStructuredBottomLeft
}))

function channelDefault(channel: MotionChannel): number {
  return channel === 'opacity' || channel === 'scaleX' || channel === 'scaleY' ? 1 : 0
}

function channelLimit(channel: MotionChannel) {
  if (channel === 'opacity') return MOTION_LIMITS.opacity
  if (channel === 'scaleX' || channel === 'scaleY') return MOTION_LIMITS.scale
  if (channel === 'rotate') return MOTION_LIMITS.rotate
  return MOTION_LIMITS.translate
}

function hasChannel(channel: MotionChannel): boolean {
  return keyframe[channel] !== undefined
}

function channelValue(channel: MotionChannel): number {
  return keyframe[channel] ?? channelDefault(channel)
}

function onChannelToggle(channel: MotionChannel, event: Event): void {
  emit('toggleChannel', channel, (event.target as HTMLInputElement).checked)
}

function onEasingUpdate(value: MotionEasing | undefined, coalesceKey?: string): void {
  emit('updateEasing', value, coalesceKey)
}

function onToggleAdvancedNumeric(channel: MotionV2NumericChannel, enabled: boolean): void {
  emit('toggleAdvancedNumeric', channel, enabled)
}

function onUpdateAdvancedNumeric(channel: MotionV2NumericChannel, value: number): void {
  emit('updateAdvancedNumeric', channel, value)
}

function onToggleAdvancedColor(channel: MotionV2ColorChannel, enabled: boolean): void {
  emit('toggleAdvancedColor', channel, enabled)
}

function onUpdateAdvancedColor(
  channel: MotionV2ColorChannel,
  component: MotionColorComponent,
  value: number
): void {
  emit('updateAdvancedColor', channel, component, value)
}

function onUpdatePathPoint(pointIndex: number, axis: 'x' | 'y', value: number): void {
  emit('updatePathPoint', pointIndex, axis, value)
}
</script>

<template>
  <div class="mt-3 border-t border-border pt-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="text-[10px] font-medium text-surface">
        {{ panels.motionKeyframe }} {{ keyframeIndex + 1 }}
      </div>
      <div class="flex items-center gap-1">
        <IconButton
          :label="panels.motionDuplicateKeyframe"
          :disabled="!canDuplicate"
          data-test-id="motion-duplicate-keyframe"
          @click="emit('duplicate')"
        >
          <icon-lucide-copy class="size-3" />
        </IconButton>
        <div class="w-24">
          <NumberField
            :model-value="keyframe.offset"
            :label="panels.motionOffset"
            :min="0"
            :max="1"
            :step="0.01"
            :disabled="!canEditOffset"
            data-property="motion-keyframe-offset"
            @commit="emit('updateOffset', $event)"
          />
        </div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-1.5">
      <div
        v-for="channel in MOTION_CHANNELS"
        :key="channel"
        class="flex min-w-0 items-center gap-1"
      >
        <input
          type="checkbox"
          class="size-3 shrink-0 accent-accent"
          :checked="hasChannel(channel)"
          :aria-label="channelLabels[channel]"
          @change="onChannelToggle(channel, $event)"
          @keydown.stop
        />
        <NumberField
          :model-value="channelValue(channel)"
          :label="channelLabels[channel]"
          :min="channelLimit(channel).min"
          :max="channelLimit(channel).max"
          :step="channel === 'opacity' ? 0.01 : 1"
          :disabled="!hasChannel(channel)"
          :data-property="`motion-keyframe-${channel}`"
          @commit="emit('updateChannel', channel, $event)"
        />
      </div>
    </div>
    <div class="mt-3">
      <MotionEasingControls
        :easing="keyframe.easing"
        :motion-version="motionVersion"
        :allow-inherited="true"
        property-prefix="motion-keyframe-easing"
        data-test-id="motion-keyframe-easing"
        @update="onEasingUpdate"
      />
    </div>
    <div
      v-if="motionVersion === 1"
      class="mt-3 space-y-2 rounded border border-border bg-input/50 p-2"
      data-test-id="motion-v2-upgrade"
    >
      <p class="text-[10px] leading-4 text-muted">{{ panels.motionAdvancedUpgradeHint }}</p>
      <button
        type="button"
        class="h-7 w-full rounded border border-border bg-input px-2 text-[10px] text-surface hover:bg-hover"
        data-test-id="motion-v2-upgrade-button"
        @click="emit('upgradeVersion')"
        @keydown.stop
      >
        {{ panels.motionAdvancedUpgrade }}
      </button>
    </div>
    <template v-else>
      <MotionAdvancedChannels
        :node="node"
        :keyframe="keyframe"
        @toggle-numeric="onToggleAdvancedNumeric"
        @update-numeric="onUpdateAdvancedNumeric"
        @toggle-color="onToggleAdvancedColor"
        @update-color="onUpdateAdvancedColor"
      />
      <MotionStructuredChannelsRoot
        class="mt-3"
        :node="node"
        :spec="motion"
        :track-id="track.id"
        :keyframe-index="keyframeIndex"
        :labels="structuredLabels"
        @commit="(spec, undoLabel) => emit('commitStructured', spec, undoLabel)"
      />
      <MotionPathControls
        :track="track"
        :keyframe="keyframe"
        :motion-version="motionVersion"
        :editor-active="pathEditorActive"
        @toggle="emit('togglePath', $event)"
        @update-progress="emit('updatePathProgress', $event)"
        @update-auto-rotate="emit('updatePathAutoRotate', $event)"
        @update-point="onUpdatePathPoint"
        @add-point="emit('addPathPoint')"
        @remove-point="emit('removePathPoint', $event)"
        @upgrade-cubic="emit('upgradePathToCubic')"
        @toggle-editor="emit('togglePathEditor')"
        @add-segment="emit('addPathSegment')"
        @remove-segment="emit('removePathSegment', $event)"
      />
    </template>
  </div>
</template>
