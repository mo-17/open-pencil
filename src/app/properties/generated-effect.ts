import { generatedEffectNodeChanges } from '@open-pencil/motion'
import {
  cloneGeneratedEffectSpec,
  parseGeneratedEffectSpec,
  type GeneratedEffectParams,
  type GeneratedEffectPreset,
  type GeneratedEffectSpecV1
} from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

const EFFECT_COLOR = { r: 1, g: 1, b: 1, a: 0.9 } as const

function presetParams(preset: GeneratedEffectPreset): GeneratedEffectParams {
  switch (preset) {
    case 'noise':
      return { preset, cells: 36, intensity: 0.3, tint: { ...EFFECT_COLOR } }
    case 'shimmer':
      return { preset, bands: 3, width: 0.28, angle: 18, color: { ...EFFECT_COLOR } }
    case 'scanlines':
      return { preset, lines: 24, thickness: 0.25, color: { ...EFFECT_COLOR } }
    case 'particles':
      return { preset, count: 24, size: 0.035, drift: 0.25, color: { ...EFFECT_COLOR } }
  }
  const unsupportedPreset: never = preset
  throw new RangeError(`Unsupported generated effect preset: ${String(unsupportedPreset)}`)
}

export function createGeneratedEffect(
  preset: GeneratedEffectPreset = 'shimmer'
): GeneratedEffectSpecV1 {
  return parseGeneratedEffectSpec({
    version: 1,
    params: presetParams(preset),
    uniforms: {
      time: { source: 'timeline', scale: 1, offsetMs: 0, frequencyHz: 2 },
      seed: 1
    },
    budget: { maxPrimitives: 64, maxRasterPixels: 131_072 },
    opacity: 0.65,
    blendMode: 'screen',
    reducedMotion: { mode: 'static', timeMs: 0 },
    fallback: { kind: 'static', timeMs: 0 }
  })
}

export function withGeneratedEffectPreset(
  spec: GeneratedEffectSpecV1,
  preset: GeneratedEffectPreset
): GeneratedEffectSpecV1 {
  return parseGeneratedEffectSpec({
    ...cloneGeneratedEffectSpec(spec),
    params: presetParams(preset)
  })
}

export function updateNodeGeneratedEffect(
  editor: Pick<EditorStore, 'graph' | 'updateNodeWithUndo'>,
  nodeId: string,
  value: GeneratedEffectSpecV1 | undefined,
  label = 'Update generated effect'
): boolean {
  const node = editor.graph.getNode(nodeId)
  if (!node) return false
  const spec = value ? parseGeneratedEffectSpec(value) : undefined
  editor.updateNodeWithUndo(nodeId, generatedEffectNodeChanges(node, spec), label)
  return true
}
