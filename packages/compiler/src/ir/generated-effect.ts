import {
  cloneGeneratedEffectSpec,
  validateGeneratedEffectSpec,
  type GeneratedEffectSpecV1,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { IRWarning } from './types'

export type IRGeneratedEffect = GeneratedEffectSpecV1

/** Strict IR boundary: malformed/future data remains inert and never reaches emit. */
export function collectGeneratedEffect(
  node: SceneNode,
  warnings: IRWarning[],
  supportsOverlay: boolean
): IRGeneratedEffect | undefined {
  if (node.generatedEffect === undefined) return undefined
  const validated = validateGeneratedEffectSpec(node.generatedEffect)
  if (!validated.success) {
    warnings.push({
      code: 'generated-effect-invalid',
      message: `node ${node.id} has malformed or unsupported generated-effect data; emitted output uses no generated layer`,
      nodeId: node.id
    })
    return undefined
  }
  if (!supportsOverlay) {
    warnings.push({
      code: 'generated-effect-unsupported-element',
      message: `node ${node.id} emits as a void element and cannot host a generated Canvas2D layer; emitted output uses the safe no-layer fallback`,
      nodeId: node.id
    })
    return undefined
  }
  return cloneGeneratedEffectSpec(validated.value)
}
