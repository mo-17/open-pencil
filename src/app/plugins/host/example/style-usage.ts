import type {
  PluginContributionDataContractV2,
  PluginHostPermissionV2
} from '@open-pencil/plugin-contracts'

import { EXAMPLE_EMPTY_PARAMETERS } from './parameters'
import {
  collectExampleVisibleDocumentNodes,
  type ExampleVisibleDocumentEditor
} from './visible-document'

export const EXAMPLE_STYLE_USAGE_PLUGIN_ID = 'example.style-usage'
export const EXAMPLE_STYLE_USAGE_COMMAND_ID = 'summarize-style-usage'
export const EXAMPLE_STYLE_USAGE_ADAPTER_ID = 'open-pencil.example.style-usage'
export const EXAMPLE_STYLE_USAGE_PERMISSIONS = Object.freeze([
  'document.read'
] satisfies readonly PluginHostPermissionV2[])
export const EXAMPLE_STYLE_USAGE_PARAMETERS = EXAMPLE_EMPTY_PARAMETERS
export const EXAMPLE_STYLE_USAGE_RESULT = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      nodeCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      visibleFillCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      visibleStrokeCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      visibleEffectCount: Object.freeze({ type: 'integer' as const, minimum: 0 })
    }),
    required: Object.freeze([
      'nodeCount',
      'visibleFillCount',
      'visibleStrokeCount',
      'visibleEffectCount'
    ]),
    additionalProperties: false as const,
    maxProperties: 4
  }),
  maxBytes: 256
}) satisfies PluginContributionDataContractV2

export const EXAMPLE_STYLE_USAGE_HOST_CONTRACT = Object.freeze({
  pluginId: EXAMPLE_STYLE_USAGE_PLUGIN_ID,
  commandId: EXAMPLE_STYLE_USAGE_COMMAND_ID,
  adapterId: EXAMPLE_STYLE_USAGE_ADAPTER_ID,
  permissions: EXAMPLE_STYLE_USAGE_PERMISSIONS,
  parameters: EXAMPLE_STYLE_USAGE_PARAMETERS,
  result: EXAMPLE_STYLE_USAGE_RESULT
})

export function runExampleStyleUsage(editor: ExampleVisibleDocumentEditor, signal?: AbortSignal) {
  const { nodes } = collectExampleVisibleDocumentNodes(editor, signal)
  let visibleFillCount = 0
  let visibleStrokeCount = 0
  let visibleEffectCount = 0

  for (const node of nodes) {
    signal?.throwIfAborted()
    visibleFillCount += node.fills.filter((fill) => fill.visible).length
    visibleStrokeCount += node.strokes.filter((stroke) => stroke.visible).length
    visibleEffectCount += node.effects.filter((effect) => effect.visible).length
  }

  const data = {
    nodeCount: nodes.length,
    visibleFillCount,
    visibleStrokeCount,
    visibleEffectCount
  }
  return {
    status: 'completed' as const,
    message: `Style usage: ${visibleFillCount} fill(s), ${visibleStrokeCount} stroke(s), and ${visibleEffectCount} effect(s) across ${nodes.length} node(s).`,
    data
  }
}
