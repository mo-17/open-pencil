import {
  cloneGeneratedEffectSpec,
  generatedEffectIsAnimated,
  type GeneratedEffectSpecV1
} from '@open-pencil/scene-graph'

import { defineTool } from '#core/tools/schema'

export interface GeneratedEffectRead {
  id: string
  name: string
  type: string
  preset: GeneratedEffectSpecV1['params']['preset'] | null
  animated: boolean
  spec: GeneratedEffectSpecV1 | null
}

type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const readGeneratedEffect = defineTool({
  name: 'read_generated_effect',
  description:
    "Read one node's strict generated-effect layer. The returned v1 spec contains only allowlisted presets, bounded numeric parameters, an explicit timeline/seed, resource limits, reduced-motion behavior, and a static fallback. It never contains shader source or arbitrary code.",
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true }
  },
  execute: (figma, { nodeId }): ReadResult<GeneratedEffectRead> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return { ok: false, error: `Node "${nodeId}" not found` }
    const spec = node.generatedEffect ? cloneGeneratedEffectSpec(node.generatedEffect) : null
    return {
      ok: true,
      data: {
        id: node.id,
        name: node.name,
        type: node.type,
        preset: spec?.params.preset ?? null,
        animated: spec ? generatedEffectIsAnimated(spec) : false,
        spec
      }
    }
  }
})
