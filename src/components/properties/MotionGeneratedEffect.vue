<script setup lang="ts">
import { computed } from 'vue'

import {
  GENERATED_EFFECT_LIMITS,
  GENERATED_EFFECT_PRESETS,
  parseGeneratedEffectSpec,
  type GeneratedEffectPreset,
  type GeneratedEffectSpecV1
} from '@open-pencil/scene-graph'
import { useI18n, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  createGeneratedEffect,
  updateNodeGeneratedEffect,
  withGeneratedEffectPreset
} from '@/app/properties/generated-effect'

const editor = useEditorStore()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()

const effect = computed(() => selectedNode.value?.generatedEffect)

const presetLabels: Record<GeneratedEffectPreset, keyof typeof panels.value> = {
  noise: 'motionGeneratedEffectNoise',
  shimmer: 'motionGeneratedEffectShimmer',
  scanlines: 'motionGeneratedEffectScanlines',
  particles: 'motionGeneratedEffectParticles'
}

function commit(spec: GeneratedEffectSpecV1): void {
  const node = selectedNode.value
  if (!node) return
  updateNodeGeneratedEffect(editor, node.id, spec)
}

function add(): void {
  const node = selectedNode.value
  if (!node) return
  updateNodeGeneratedEffect(editor, node.id, createGeneratedEffect())
}

function clear(): void {
  const node = selectedNode.value
  if (!node) return
  updateNodeGeneratedEffect(editor, node.id, undefined, 'Remove generated effect')
}

function setPreset(value: string): void {
  if (!effect.value || !GENERATED_EFFECT_PRESETS.includes(value as GeneratedEffectPreset)) return
  commit(withGeneratedEffectPreset(effect.value, value as GeneratedEffectPreset))
}

function setFinite(field: 'seed' | 'frequencyHz' | 'opacity', raw: string): boolean {
  if (!effect.value) return false
  const value = Number(raw)
  if (!Number.isFinite(value)) return false
  const next = structuredClone(effect.value)
  if (field === 'seed') next.uniforms.seed = Math.round(value)
  else if (field === 'frequencyHz') next.uniforms.time.frequencyHz = value
  else next.opacity = value
  try {
    commit(parseGeneratedEffectSpec(next))
    return true
  } catch {
    // Native input bounds prevent normal invalid values; malformed programmatic
    // input is intentionally ignored instead of weakening the schema boundary.
    return false
  }
}

function setReducedMode(value: string): void {
  if (!effect.value || (value !== 'static' && value !== 'disable')) return
  const next = structuredClone(effect.value)
  next.reducedMotion = value === 'disable' ? { mode: 'disable' } : { mode: 'static', timeMs: 0 }
  commit(parseGeneratedEffectSpec(next))
}
</script>

<template>
  <fieldset data-test-id="motion-generated-effect" class="rounded border border-border p-2">
    <legend class="px-1 text-[11px] text-muted">{{ panels.motionGeneratedEffect }}</legend>

    <template v-if="effect">
      <p class="mb-2 text-[10px] leading-4 text-muted">
        {{ panels.motionGeneratedEffectSafeHint }}
      </p>
      <label class="mb-1 flex items-center gap-2 text-[10px] text-muted">
        <span class="w-20 shrink-0">{{ panels.motionGeneratedEffectPreset }}</span>
        <select
          :value="effect.params.preset"
          data-test-id="motion-generated-effect-preset"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface"
          @change="setPreset(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="preset in GENERATED_EFFECT_PRESETS" :key="preset" :value="preset">
            {{ panels[presetLabels[preset]] }}
          </option>
        </select>
      </label>
      <label class="mb-1 flex items-center gap-2 text-[10px] text-muted">
        <span class="w-20 shrink-0">{{ panels.motionGeneratedEffectSeed }}</span>
        <input
          type="number"
          data-test-id="motion-generated-effect-seed"
          min="0"
          :max="GENERATED_EFFECT_LIMITS.maxSeed"
          step="1"
          :value="effect.uniforms.seed"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface"
          @change="setFinite('seed', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="mb-1 flex items-center gap-2 text-[10px] text-muted">
        <span class="w-20 shrink-0">{{ panels.motionGeneratedEffectFrequency }}</span>
        <input
          type="number"
          data-test-id="motion-generated-effect-frequency"
          min="0"
          :max="GENERATED_EFFECT_LIMITS.maxFrequencyHz"
          step="0.25"
          :value="effect.uniforms.time.frequencyHz"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface"
          @change="setFinite('frequencyHz', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="mb-1 flex items-center gap-2 text-[10px] text-muted">
        <span class="w-20 shrink-0">{{ panels.motionGeneratedEffectOpacity }}</span>
        <input
          type="number"
          data-test-id="motion-generated-effect-opacity"
          min="0"
          max="1"
          step="0.05"
          :value="effect.opacity"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface"
          @change="setFinite('opacity', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="mb-2 flex items-center gap-2 text-[10px] text-muted">
        <span class="w-20 shrink-0">{{ panels.motionGeneratedEffectReducedMotion }}</span>
        <select
          :value="effect.reducedMotion.mode"
          data-test-id="motion-generated-effect-reduced-motion"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface"
          @change="setReducedMode(($event.target as HTMLSelectElement).value)"
        >
          <option value="static">{{ panels.motionGeneratedEffectReducedStatic }}</option>
          <option value="disable">{{ panels.motionGeneratedEffectReducedDisable }}</option>
        </select>
      </label>
      <button
        type="button"
        data-test-id="motion-generated-effect-remove"
        class="w-full rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="clear"
      >
        {{ panels.motionGeneratedEffectRemove }}
      </button>
    </template>

    <button
      v-else
      type="button"
      data-test-id="motion-generated-effect-add"
      class="w-full rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface"
      :disabled="!selectedNode"
      @click="add"
    >
      {{ panels.motionGeneratedEffectAdd }}
    </button>
  </fieldset>
</template>
