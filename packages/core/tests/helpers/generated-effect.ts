import { parseGeneratedEffectSpec, type GeneratedEffectPreset } from '@open-pencil/scene-graph'

import examples from '../fixtures/generated-effects.json'

export function generatedEffect(preset: GeneratedEffectPreset = 'particles') {
  return parseGeneratedEffectSpec(structuredClone(examples[preset]))
}
