<script setup lang="ts">
import { computed, ref } from 'vue'

import { colorToFill, colorToHex, parseColor } from '@open-pencil/core/color'
import type {
  InteractionState,
  StateOverride,
  StateOverrides,
  Stroke
} from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'
import { useSectionUI } from '@/components/ui/section'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('stateOverrides', () => selectedNode.value?.id)

const STATES: readonly InteractionState[] = ['hover', 'focus', 'active', 'disabled']
const activeState = ref<InteractionState>('hover')
const overrides = useSceneComputed<StateOverrides>(() => selectedNode.value?.stateOverrides ?? {})
const currentOverride = computed<StateOverride>(() => overrides.value[activeState.value] ?? {})

interface UnknownRecord {
  [key: string]: unknown
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined
}

function color(value: unknown): Color | undefined {
  if (typeof value === 'string') return parseColor(value)
  const candidate = record(value)
  if (!candidate) return undefined
  const { r, g, b, a = 1 } = candidate
  if (![r, g, b, a].every((channel) => typeof channel === 'number' && Number.isFinite(channel))) {
    return undefined
  }
  return { r: r as number, g: g as number, b: b as number, a: a as number }
}

function firstPaintRecord(value: unknown): UnknownRecord | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(record).find((paint) => paint && paint.visible !== false)
}

function paintHex(value: unknown, fallback: string): string {
  const resolved = color(firstPaintRecord(value)?.color)
  return resolved ? colorToHex(resolved) : fallback
}

const baseFillHex = computed(() => paintHex(selectedNode.value?.fills, '#000000'))
const baseStrokeHex = computed(() => paintHex(selectedNode.value?.strokes, '#000000'))
const fillEnabled = computed(
  () => Array.isArray(currentOverride.value.fills) && currentOverride.value.fills.length > 0
)
const strokeEnabled = computed(
  () => Array.isArray(currentOverride.value.strokes) && currentOverride.value.strokes.length > 0
)
const fillHex = computed(() => paintHex(currentOverride.value.fills, baseFillHex.value))
const strokeHex = computed(() => paintHex(currentOverride.value.strokes, baseStrokeHex.value))
const strokeWeight = computed(() => {
  const value = firstPaintRecord(currentOverride.value.strokes)?.weight
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const base = firstPaintRecord(selectedNode.value?.strokes)?.weight
  return typeof base === 'number' && Number.isFinite(base) ? base : 1
})
const opacityPercent = computed(() => {
  const value = currentOverride.value.opacity
  return value === undefined ? '' : String(Math.round(value * 100))
})
const cornerRadius = computed(() => currentOverride.value.cornerRadius ?? '')

function cleanOverrides(value: StateOverrides): StateOverrides {
  const cleaned: StateOverrides = {}
  for (const state of STATES) {
    const override = value[state]
    if (!override) continue
    const entries = Object.entries(override).filter(([, field]) => field !== undefined)
    if (entries.length > 0) cleaned[state] = Object.fromEntries(entries) as StateOverride
  }
  return cleaned
}

function commit(next: StateOverrides): void {
  const node = selectedNode.value
  if (!node) return
  const cleaned = cleanOverrides(next)
  editor.updateNodeWithUndo(
    node.id,
    { stateOverrides: Object.keys(cleaned).length > 0 ? cleaned : undefined },
    'Update interaction state'
  )
}

function setField<K extends keyof StateOverride>(
  key: K,
  value: StateOverride[K] | undefined
): void {
  const state = activeState.value
  const current: StateOverride = { ...overrides.value[state] }
  if (value === undefined) Reflect.deleteProperty(current, key)
  else current[key] = value
  commit({ ...overrides.value, [state]: current })
}

function clearState(): void {
  const next = { ...overrides.value }
  Reflect.deleteProperty(next, activeState.value)
  commit(next)
}

function eventChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement).value.trim()
}

function setFillEnabled(event: Event): void {
  setField('fills', eventChecked(event) ? [colorToFill(fillHex.value)] : undefined)
}

function setFillColor(event: Event): void {
  setField('fills', [colorToFill(eventValue(event))])
}

function stroke(colorValue: string, weight: number): Stroke {
  return {
    color: parseColor(colorValue),
    weight: Math.max(0, weight),
    opacity: 1,
    visible: true,
    align: 'INSIDE'
  }
}

function setStrokeEnabled(event: Event): void {
  setField(
    'strokes',
    eventChecked(event) ? [stroke(strokeHex.value, strokeWeight.value)] : undefined
  )
}

function setStrokeColor(event: Event): void {
  setField('strokes', [stroke(eventValue(event), strokeWeight.value)])
}

function setStrokeWeight(event: Event): void {
  const raw = eventValue(event)
  if (raw === '') return
  const value = Number(raw)
  if (Number.isFinite(value)) setField('strokes', [stroke(strokeHex.value, value)])
}

function setOpacity(event: Event): void {
  const raw = eventValue(event)
  if (raw === '') {
    setField('opacity', undefined)
    return
  }
  const value = Number(raw)
  if (Number.isFinite(value)) setField('opacity', Math.min(100, Math.max(0, value)) / 100)
}

function setCornerRadius(event: Event): void {
  const raw = eventValue(event)
  if (raw === '') {
    setField('cornerRadius', undefined)
    return
  }
  const value = Number(raw)
  if (Number.isFinite(value)) setField('cornerRadius', Math.max(0, value))
}
</script>

<template>
  <div
    data-test-id="lowcode-interaction-states"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <div class="mb-1.5 flex items-center justify-between gap-2">
      <label class="text-[11px] text-muted">{{ panels.lowcodeInteractionStates }}</label>
      <button
        type="button"
        data-test-id="lowcode-interaction-clear"
        class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-40"
        :disabled="!overrides[activeState]"
        @click="clearState"
      >
        {{ panels.lowcodeInteractionClear }}
      </button>
    </div>

    <div class="mb-2 grid grid-cols-4 gap-1" role="tablist">
      <button
        v-for="state in STATES"
        :key="state"
        type="button"
        role="tab"
        :aria-selected="activeState === state"
        :data-test-id="`lowcode-interaction-state-${state}`"
        :class="[
          'relative min-w-0 rounded px-1 py-1 text-[10px] transition-colors',
          activeState === state
            ? 'bg-accent text-white'
            : 'bg-input text-muted hover:bg-hover hover:text-surface'
        ]"
        @click="activeState = state"
      >
        <span class="block truncate">{{ state }}</span>
        <span
          v-if="overrides[state]"
          class="absolute right-0.5 top-0.5 size-1 rounded-full bg-current"
          aria-hidden="true"
        />
      </button>
    </div>

    <p class="mb-2 text-[10px] leading-4 text-muted">
      {{ panels.lowcodeInteractionHint }}
    </p>

    <div class="flex flex-col gap-2 rounded border border-border/70 p-2">
      <div class="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <input
          :checked="fillEnabled"
          type="checkbox"
          data-test-id="lowcode-interaction-fill-enabled"
          :aria-label="panels.fill"
          @change="setFillEnabled"
        />
        <span class="text-[10px] text-muted">{{ panels.fill }}</span>
        <input
          :value="fillHex"
          type="color"
          data-test-id="lowcode-interaction-fill-color"
          :aria-label="`${activeState} ${panels.fill}`"
          :disabled="!fillEnabled"
          class="h-6 w-9 cursor-pointer rounded border border-border bg-input p-0.5 disabled:cursor-default disabled:opacity-40"
          @change="setFillColor"
        />
      </div>

      <div class="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <input
          :checked="strokeEnabled"
          type="checkbox"
          data-test-id="lowcode-interaction-stroke-enabled"
          :aria-label="panels.stroke"
          @change="setStrokeEnabled"
        />
        <span class="text-[10px] text-muted">{{ panels.stroke }}</span>
        <div class="flex items-center gap-1">
          <input
            :value="strokeHex"
            type="color"
            data-test-id="lowcode-interaction-stroke-color"
            :aria-label="`${activeState} ${panels.stroke}`"
            :disabled="!strokeEnabled"
            class="h-6 w-9 cursor-pointer rounded border border-border bg-input p-0.5 disabled:cursor-default disabled:opacity-40"
            @change="setStrokeColor"
          />
          <input
            :value="strokeWeight"
            type="number"
            min="0"
            step="0.5"
            data-test-id="lowcode-interaction-stroke-width"
            :aria-label="panels.lowcodeInteractionStrokeWidth"
            :disabled="!strokeEnabled"
            class="h-7 w-14 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent disabled:opacity-40"
            @change="setStrokeWeight"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <label class="flex min-w-0 flex-col gap-0.5">
          <span class="text-[10px] text-muted">{{ panels.opacity }} (%)</span>
          <input
            :value="opacityPercent"
            type="number"
            min="0"
            max="100"
            :placeholder="panels.lowcodeInteractionInherit"
            data-test-id="lowcode-interaction-opacity"
            class="h-7 min-w-0 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
            @change="setOpacity"
          />
        </label>
        <label class="flex min-w-0 flex-col gap-0.5">
          <span class="text-[10px] text-muted">{{ panels.radius }}</span>
          <input
            :value="cornerRadius"
            type="number"
            min="0"
            :placeholder="panels.lowcodeInteractionInherit"
            data-test-id="lowcode-interaction-radius"
            class="h-7 min-w-0 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
            @change="setCornerRadius"
          />
        </label>
      </div>
    </div>
  </div>
</template>
