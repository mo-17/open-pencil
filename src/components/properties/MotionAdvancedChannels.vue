<script setup lang="ts">
import { computed } from 'vue'

import type { MotionKeyframe, SceneNode } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import {
  motionV2ChannelEnabled,
  motionV2NumericLimit,
  type MotionColorComponent,
  type MotionV2ColorChannel,
  type MotionV2NumericChannel
} from '@/app/properties/motion/v2'
import {
  motionV2ChannelCapabilityReason,
  motionV2ChannelSupported,
  type MotionV2ChannelCapabilityReason
} from '@/app/properties/motion/v2-capabilities'
import NumberField from '@/components/inputs/NumberField.vue'
import MotionColorChannelControls from '@/components/properties/MotionColorChannelControls.vue'
import Tip from '@/components/ui/Tip.vue'

const { node, keyframe } = defineProps<{
  node: SceneNode
  keyframe: MotionKeyframe
}>()

const emit = defineEmits<{
  toggleNumeric: [channel: MotionV2NumericChannel, enabled: boolean]
  updateNumeric: [channel: MotionV2NumericChannel, value: number]
  toggleColor: [channel: MotionV2ColorChannel, enabled: boolean]
  updateColor: [channel: MotionV2ColorChannel, component: MotionColorComponent, value: number]
}>()

const { panels } = useI18n()

const numericGroups = computed<
  Array<{ label: string; channels: Array<{ channel: MotionV2NumericChannel; label: string }> }>
>(() => [
  {
    label: panels.value.motionAdvancedGeometry,
    channels: [
      { channel: 'originX', label: panels.value.motionOriginX },
      { channel: 'originY', label: panels.value.motionOriginY },
      { channel: 'width', label: panels.value.width },
      { channel: 'height', label: panels.value.height },
      { channel: 'cornerRadius', label: panels.value.motionCornerRadius }
    ]
  },
  {
    label: panels.value.motionAdvancedEffects,
    channels: [
      { channel: 'strokeWidth', label: panels.value.motionStrokeWidth },
      { channel: 'blur', label: panels.value.motionBlur },
      { channel: 'shadowX', label: panels.value.motionShadowX },
      { channel: 'shadowY', label: panels.value.motionShadowY },
      { channel: 'shadowBlur', label: panels.value.motionShadowBlur },
      { channel: 'shadowSpread', label: panels.value.motionShadowSpread }
    ]
  },
  {
    label: panels.value.motionAdvancedTrim,
    channels: [
      { channel: 'trimStart', label: panels.value.motionTrimStart },
      { channel: 'trimEnd', label: panels.value.motionTrimEnd },
      { channel: 'trimOffset', label: panels.value.motionTrimOffset }
    ]
  },
  {
    label: panels.value.motionAdvancedLayout,
    channels: [
      { channel: 'gap', label: panels.value.gap },
      { channel: 'rowGap', label: panels.value.motionRowGap },
      { channel: 'columnGap', label: panels.value.motionColumnGap },
      { channel: 'paddingTop', label: panels.value.motionPaddingTop },
      { channel: 'paddingRight', label: panels.value.motionPaddingRight },
      { channel: 'paddingBottom', label: panels.value.motionPaddingBottom },
      { channel: 'paddingLeft', label: panels.value.motionPaddingLeft }
    ]
  }
])

const colorChannels = computed<Array<{ channel: MotionV2ColorChannel; label: string }>>(() => [
  { channel: 'fillColor', label: panels.value.motionFillColor },
  { channel: 'strokeColor', label: panels.value.motionStrokeColor },
  { channel: 'shadowColor', label: panels.value.motionShadowColor }
])

function onNumericToggle(channel: MotionV2NumericChannel, event: Event): void {
  emit('toggleNumeric', channel, (event.target as HTMLInputElement).checked)
}

function capabilityReason(channel: MotionV2ColorChannel | MotionV2NumericChannel): string {
  const reason = motionV2ChannelCapabilityReason(node, channel)
  return reason ? capabilityReasonLabel(reason) : ''
}

function capabilityReasonLabel(reason: MotionV2ChannelCapabilityReason): string {
  if (reason === 'solidFill') return panels.value.motionChannelRequiresSolidFill
  if (reason === 'stroke') return panels.value.motionChannelRequiresStroke
  if (reason === 'vectorStroke') return panels.value.motionChannelRequiresVectorStroke
  if (reason === 'centerlineStroke') return panels.value.motionChannelRequiresCenterlineStroke
  if (reason === 'vectorGeometry') return panels.value.motionChannelRequiresVectorGeometry
  if (reason === 'boxCorners') return panels.value.motionChannelRequiresBoxCorners
  return panels.value.motionChannelRequiresAutoLayout
}

function channelSupported(channel: MotionV2ColorChannel | MotionV2NumericChannel): boolean {
  return motionV2ChannelSupported(node, channel)
}

function numericToggleDisabled(channel: MotionV2NumericChannel): boolean {
  return !channelSupported(channel) && !motionV2ChannelEnabled(keyframe, channel)
}

function numericMin(channel: MotionV2NumericChannel): number {
  const limit = motionV2NumericLimit(channel)
  return channel === 'trimEnd' ? Math.max(limit.min, keyframe.trimStart ?? limit.min) : limit.min
}

function numericMax(channel: MotionV2NumericChannel): number {
  const limit = motionV2NumericLimit(channel)
  return channel === 'trimStart' ? Math.min(limit.max, keyframe.trimEnd ?? limit.max) : limit.max
}

function numericStep(channel: MotionV2NumericChannel): number {
  return channel === 'originX' ||
    channel === 'originY' ||
    channel === 'trimStart' ||
    channel === 'trimEnd' ||
    channel === 'trimOffset'
    ? 0.01
    : 1
}

function forwardColorUpdate(
  channel: MotionV2ColorChannel,
  component: MotionColorComponent,
  value: number
): void {
  emit('updateColor', channel, component, value)
}
</script>

<template>
  <div class="mt-3 space-y-3 border-t border-border pt-3" data-test-id="motion-v2-channels">
    <div class="text-[10px] font-medium text-surface">{{ panels.motionAdvancedChannels }}</div>
    <section v-for="group in numericGroups" :key="group.label" class="space-y-1.5">
      <div class="text-[9px] font-medium uppercase tracking-wide text-muted">{{ group.label }}</div>
      <div class="grid grid-cols-2 gap-1.5">
        <Tip
          v-for="item in group.channels"
          :key="item.channel"
          :label="capabilityReason(item.channel)"
        >
          <div
            class="flex min-w-0 items-center gap-1"
            :class="{ 'cursor-not-allowed opacity-50': !channelSupported(item.channel) }"
            :data-test-id="`motion-v2-channel-${item.channel}`"
            :data-capability-disabled="!channelSupported(item.channel) || undefined"
          >
            <input
              type="checkbox"
              class="size-3 shrink-0 accent-accent"
              :checked="motionV2ChannelEnabled(keyframe, item.channel)"
              :disabled="numericToggleDisabled(item.channel)"
              :aria-label="item.label"
              :aria-description="capabilityReason(item.channel) || undefined"
              :data-test-id="`motion-v2-toggle-${item.channel}`"
              @change="onNumericToggle(item.channel, $event)"
              @keydown.stop
            />
            <NumberField
              :model-value="keyframe[item.channel] ?? 0"
              :label="item.label"
              :min="numericMin(item.channel)"
              :max="numericMax(item.channel)"
              :step="numericStep(item.channel)"
              :disabled="
                !motionV2ChannelEnabled(keyframe, item.channel) || !channelSupported(item.channel)
              "
              :data-property="`motion-v2-${item.channel}`"
              @commit="emit('updateNumeric', item.channel, $event)"
            />
          </div>
        </Tip>
      </div>
    </section>
    <section class="space-y-1.5">
      <div class="text-[9px] font-medium uppercase tracking-wide text-muted">
        {{ panels.motionAdvancedAppearance }}
      </div>
      <MotionColorChannelControls
        v-for="item in colorChannels"
        :key="item.channel"
        :label="item.label"
        :color="keyframe[item.channel]"
        :property-prefix="`motion-v2-${item.channel}`"
        :disabled="!channelSupported(item.channel)"
        :disabled-reason="capabilityReason(item.channel)"
        @toggle="emit('toggleColor', item.channel, $event)"
        @update="(component, value) => forwardColorUpdate(item.channel, component, value)"
      />
    </section>
  </div>
</template>
