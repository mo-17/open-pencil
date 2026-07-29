<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  BLACK,
  type MotionColor,
  type MotionEffectTarget,
  type MotionFontAxisTarget,
  type MotionGradientStopTarget,
  type MotionPaintTarget,
  type MotionSpec,
  type MotionVectorMorph,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  addMotionStructuredTarget,
  motionStructuredCapability,
  motionStructuredChannelEnabled,
  removeMotionStructuredTarget,
  setMotionStructuredChannelEnabled,
  updateMotionStructuredChannel,
  updateMotionStructuredScalar,
  upgradeMotionSpecToV3,
  type MotionStructuredArrayChannel,
  type MotionStructuredChannel
} from '@/app/properties/motion/v3-structured'
import NumberField from '@/components/inputs/NumberField.vue'

import type { MotionStructuredChannelLabels } from './types'

const { node, spec, trackId, keyframeIndex, labels } = defineProps<{
  node: SceneNode
  spec: MotionSpec
  trackId: string
  keyframeIndex: number
  labels: MotionStructuredChannelLabels
}>()

const emit = defineEmits<{
  /** One immutable spec per event; the host records exactly one undo entry. */
  commit: [spec: MotionSpec, undoLabel: string]
}>()

const ui = computed(() => labels)
const errorMessage = ref('')
const track = computed(() => spec.tracks.find((candidate) => candidate.id === trackId))
const frame = computed(() => track.value?.keyframes[keyframeIndex])

function channelLabel(channel: MotionStructuredChannel): string {
  return ui.value[channel]
}

function supported(channel: MotionStructuredChannel): boolean {
  return motionStructuredCapability(node, channel).supported
}

function reason(channel: MotionStructuredChannel): string {
  return motionStructuredCapability(node, channel).reason ?? ''
}

function enabled(channel: MotionStructuredChannel): boolean {
  return frame.value ? motionStructuredChannelEnabled(frame.value, channel) : false
}

function commit(action: () => MotionSpec, label: string): void {
  try {
    errorMessage.value = ''
    emit('commit', action(), label)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function upgrade(): void {
  commit(() => upgradeMotionSpecToV3(spec), ui.value.upgrade)
}

function toggle(channel: MotionStructuredChannel, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  commit(
    () => setMotionStructuredChannelEnabled(spec, node, trackId, channel, checked),
    `${checked ? ui.value.enable : ui.value.remove} ${channelLabel(channel)}`
  )
}

function addTarget(channel: MotionStructuredArrayChannel): void {
  commit(
    () => addMotionStructuredTarget(spec, node, trackId, channel),
    `${ui.value.addTarget}: ${channelLabel(channel)}`
  )
}

function removeTarget(channel: MotionStructuredArrayChannel, index: number): void {
  commit(
    () => removeMotionStructuredTarget(spec, node, trackId, channel, index),
    `${ui.value.remove}: ${channelLabel(channel)}`
  )
}

function updateChannel(
  channel: MotionStructuredChannel,
  update: Parameters<typeof updateMotionStructuredChannel>[5]
): void {
  commit(
    () => updateMotionStructuredChannel(spec, node, trackId, keyframeIndex, channel, update),
    `Edit ${channelLabel(channel)}`
  )
}

function updateColor(color: MotionColor, component: keyof MotionColor, value: number): void {
  color[component] = Math.min(1, Math.max(0, value))
}

function updatePaint(index: number, field: 'opacity' | keyof MotionColor, value: number): void {
  updateChannel('paints', (channel) => {
    const target = (channel as MotionPaintTarget[])[index]
    if (!target) throw new RangeError(`Unknown paint target ${index}`)
    if (field === 'opacity') target.opacity = Math.min(1, Math.max(0, value))
    else {
      target.color ??= { ...BLACK }
      updateColor(target.color, field, value)
    }
  })
}

function updateStop(index: number, field: 'position' | keyof MotionColor, value: number): void {
  updateChannel('gradientStops', (channel) => {
    const target = (channel as MotionGradientStopTarget[])[index]
    if (!target) throw new RangeError(`Unknown gradient-stop target ${index}`)
    if (field === 'position') target.position = Math.min(1, Math.max(0, value))
    else updateColor(target.color, field, value)
  })
}

type ShadowNumberField = 'x' | 'y' | 'blur' | 'spread'

function updateEffect(index: number, field: 'radius' | ShadowNumberField, value: number): void {
  updateChannel('effects', (channel) => {
    const target = (channel as MotionEffectTarget[])[index]
    if (!target) throw new RangeError(`Unknown effect target ${index}`)
    if (target.kind === 'blur') target.radius = Math.max(0, value)
    else target[field === 'radius' ? 'blur' : field] = field === 'blur' ? Math.max(0, value) : value
  })
}

function updateEffectColor(index: number, component: keyof MotionColor, value: number): void {
  updateChannel('effects', (channel) => {
    const target = (channel as MotionEffectTarget[])[index]
    if (!target || target.kind !== 'shadow') return
    updateColor(target.color, component, value)
  })
}

function updateCorner(
  field: 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft',
  value: number
): void {
  updateChannel('cornerRadii', (channel) => {
    const corners = channel as NonNullable<typeof frame.value>['cornerRadii']
    if (corners) corners[field] = Math.max(0, value)
  })
}

function setReveal(value: number): void {
  commit(
    () =>
      updateMotionStructuredScalar(
        spec,
        node,
        trackId,
        keyframeIndex,
        'textReveal',
        Math.min(1, Math.max(0, value))
      ),
    `Edit ${ui.value.textReveal}`
  )
}

function updateAxis(index: number, value: number): void {
  updateChannel('fontAxes', (channel) => {
    const target = (channel as MotionFontAxisTarget[])[index]
    if (!target) throw new RangeError(`Unknown font-axis target ${index}`)
    target.value = value
  })
}

function updateVectorPoint(index: number, axis: 'x' | 'y', value: number): void {
  updateChannel('vectorMorph', (channel) => {
    const morph = channel as MotionVectorMorph
    const point = morph.points[index]
    if (!point) throw new RangeError(`Unknown vector point ${index}`)
    point[axis] = value
  })
}
</script>

<template>
  <section
    class="space-y-3 rounded border border-border p-2"
    data-test-id="motion-structured-channels-root"
    @keydown.stop
  >
    <header class="text-[10px] font-medium text-surface">{{ ui.title }}</header>
    <div v-if="spec.version !== 3" class="space-y-2" data-test-id="motion-v3-upgrade">
      <p class="text-[10px] leading-4 text-muted">{{ ui.upgradeHint }}</p>
      <button
        type="button"
        class="h-7 w-full rounded border border-border bg-input px-2 text-[10px] text-surface"
        data-test-id="motion-v3-upgrade-button"
        @click="upgrade"
      >
        {{ ui.upgrade }}
      </button>
    </div>

    <template v-else>
      <p
        v-if="errorMessage"
        class="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] text-warning"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <article
        v-for="channel in ['paints', 'gradientStops', 'effects'] as const"
        :key="channel"
        class="space-y-2 border-t border-border pt-2"
        :data-test-id="`motion-structured-${channel}`"
        :data-capability-reason="reason(channel) || undefined"
      >
        <label class="flex items-center gap-2 text-[10px] text-surface">
          <input
            type="checkbox"
            class="size-3 accent-accent"
            :checked="enabled(channel)"
            :disabled="!supported(channel) && !enabled(channel)"
            :aria-description="reason(channel) || undefined"
            :data-test-id="`motion-structured-toggle-${channel}`"
            @change="toggle(channel, $event)"
          />
          {{ channelLabel(channel) }}
        </label>
        <p v-if="reason(channel)" class="text-[9px] leading-3 text-muted">{{ reason(channel) }}</p>

        <template v-if="channel === 'paints' && frame?.paints">
          <div
            v-for="(paint, index) in frame.paints"
            :key="`${paint.kind}:${paint.index}`"
            class="space-y-1 rounded bg-input/40 p-1.5"
          >
            <div class="flex items-center justify-between text-[9px] text-muted">
              <span>{{ paint.kind }} {{ paint.index }}</span>
              <button type="button" @click="removeTarget('paints', index)">{{ ui.remove }}</button>
            </div>
            <NumberField
              v-if="paint.opacity !== undefined"
              :model-value="paint.opacity"
              :label="ui.opacity"
              :min="0"
              :max="1"
              :step="0.01"
              :data-property="`motion-structured-paints-${index}-opacity`"
              @commit="updatePaint(index, 'opacity', $event)"
            />
            <div v-if="paint.color" class="grid grid-cols-4 gap-1">
              <NumberField
                v-for="component in ['r', 'g', 'b', 'a'] as const"
                :key="component"
                :model-value="paint.color[component]"
                :label="({ r: ui.red, g: ui.green, b: ui.blue, a: ui.alpha } as const)[component]"
                :min="0"
                :max="1"
                :step="0.01"
                @commit="updatePaint(index, component, $event)"
              />
            </div>
          </div>
        </template>

        <template v-if="channel === 'gradientStops' && frame?.gradientStops">
          <div
            v-for="(stop, index) in frame.gradientStops"
            :key="`${stop.paintIndex}:${stop.stopIndex}`"
            class="space-y-1 rounded bg-input/40 p-1.5"
          >
            <div class="flex items-center justify-between text-[9px] text-muted">
              <span>fill {{ stop.paintIndex }} · stop {{ stop.stopIndex }}</span>
              <button type="button" @click="removeTarget('gradientStops', index)">
                {{ ui.remove }}
              </button>
            </div>
            <NumberField
              :model-value="stop.position"
              :label="ui.position"
              :min="0"
              :max="1"
              :step="0.01"
              @commit="updateStop(index, 'position', $event)"
            />
            <div class="grid grid-cols-4 gap-1">
              <NumberField
                v-for="component in ['r', 'g', 'b', 'a'] as const"
                :key="component"
                :model-value="stop.color[component]"
                :label="({ r: ui.red, g: ui.green, b: ui.blue, a: ui.alpha } as const)[component]"
                :min="0"
                :max="1"
                :step="0.01"
                @commit="updateStop(index, component, $event)"
              />
            </div>
          </div>
        </template>

        <template v-if="channel === 'effects' && frame?.effects">
          <div
            v-for="(effect, index) in frame.effects"
            :key="`${effect.kind}:${effect.index}`"
            class="space-y-1 rounded bg-input/40 p-1.5"
          >
            <div class="flex items-center justify-between text-[9px] text-muted">
              <span>{{ effect.kind }} {{ effect.index }}</span>
              <button type="button" @click="removeTarget('effects', index)">{{ ui.remove }}</button>
            </div>
            <NumberField
              v-if="effect.kind === 'blur'"
              :model-value="effect.radius"
              :label="ui.radius"
              :min="0"
              :max="1000"
              :step="1"
              @commit="updateEffect(index, 'radius', $event)"
            />
            <template v-else>
              <div class="grid grid-cols-2 gap-1">
                <NumberField
                  v-for="field in ['x', 'y', 'blur', 'spread'] as const"
                  :key="field"
                  :model-value="effect[field]"
                  :label="({ x: ui.x, y: ui.y, blur: ui.blur, spread: ui.spread } as const)[field]"
                  :min="field === 'blur' ? 0 : -10000"
                  :max="10000"
                  :step="1"
                  @commit="updateEffect(index, field, $event)"
                />
              </div>
              <div class="grid grid-cols-4 gap-1">
                <NumberField
                  v-for="component in ['r', 'g', 'b', 'a'] as const"
                  :key="component"
                  :model-value="effect.color[component]"
                  :label="({ r: ui.red, g: ui.green, b: ui.blue, a: ui.alpha } as const)[component]"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  @commit="updateEffectColor(index, component, $event)"
                />
              </div>
            </template>
          </div>
        </template>

        <button
          v-if="enabled(channel)"
          type="button"
          class="h-6 rounded border border-border px-2 text-[9px] text-surface"
          :data-test-id="`motion-structured-add-${channel}`"
          @click="addTarget(channel)"
        >
          {{ ui.addTarget }}
        </button>
      </article>

      <article
        v-for="channel in ['cornerRadii', 'textReveal', 'fontAxes', 'vectorMorph'] as const"
        :key="channel"
        class="space-y-2 border-t border-border pt-2"
        :data-test-id="`motion-structured-${channel}`"
        :data-capability-reason="reason(channel) || undefined"
      >
        <label class="flex items-center gap-2 text-[10px] text-surface">
          <input
            type="checkbox"
            class="size-3 accent-accent"
            :checked="enabled(channel)"
            :disabled="!supported(channel) && !enabled(channel)"
            :aria-description="reason(channel) || undefined"
            :data-test-id="`motion-structured-toggle-${channel}`"
            @change="toggle(channel, $event)"
          />
          {{ channelLabel(channel) }}
        </label>
        <p v-if="reason(channel)" class="text-[9px] leading-3 text-muted">{{ reason(channel) }}</p>

        <div v-if="channel === 'cornerRadii' && frame?.cornerRadii" class="grid grid-cols-2 gap-1">
          <NumberField
            v-for="field in ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const"
            :key="field"
            :model-value="frame.cornerRadii[field]"
            :label="ui[field]"
            :min="0"
            :max="100000"
            :step="1"
            @commit="updateCorner(field, $event)"
          />
        </div>
        <NumberField
          v-if="channel === 'textReveal' && frame?.textReveal !== undefined"
          :model-value="frame.textReveal"
          :label="ui.textReveal"
          :min="0"
          :max="1"
          :step="0.01"
          @commit="setReveal"
        />
        <template v-if="channel === 'fontAxes' && frame?.fontAxes">
          <div
            v-for="(axis, index) in frame.fontAxes"
            :key="axis.tag"
            class="flex items-center gap-1"
          >
            <NumberField
              :model-value="axis.value"
              :label="axis.tag"
              :min="-100000"
              :max="100000"
              :step="1"
              @commit="updateAxis(index, $event)"
            />
            <button
              type="button"
              class="text-[9px] text-muted"
              @click="removeTarget('fontAxes', index)"
            >
              {{ ui.remove }}
            </button>
          </div>
          <button
            type="button"
            class="h-6 rounded border border-border px-2 text-[9px] text-surface"
            @click="addTarget('fontAxes')"
          >
            {{ ui.addTarget }}
          </button>
        </template>
        <div
          v-if="channel === 'vectorMorph' && frame?.vectorMorph"
          class="max-h-56 space-y-1 overflow-auto"
        >
          <div
            v-for="(point, index) in frame.vectorMorph.points"
            :key="index"
            class="grid grid-cols-2 gap-1"
          >
            <NumberField
              :model-value="point.x"
              :label="`${ui.x} ${index + 1}`"
              :min="-100000"
              :max="100000"
              :step="1"
              @commit="updateVectorPoint(index, 'x', $event)"
            />
            <NumberField
              :model-value="point.y"
              :label="`${ui.y} ${index + 1}`"
              :min="-100000"
              :max="100000"
              :step="1"
              @commit="updateVectorPoint(index, 'y', $event)"
            />
          </div>
        </div>
      </article>
    </template>
  </section>
</template>
