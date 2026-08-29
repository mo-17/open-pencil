import type {
  PluginContributionDataContractV2,
  PluginHostPermissionV2
} from '@open-pencil/plugin-contracts'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  collectExampleVisibleDocumentNodes,
  type ExampleVisibleDocumentEditor
} from './visible-document'

export const EXAMPLE_NODE_TYPE_COUNTER_PLUGIN_ID = 'example.node-type-counter'
export const EXAMPLE_NODE_TYPE_COUNTER_COMMAND_ID = 'count-node-types'
export const EXAMPLE_NODE_TYPE_COUNTER_ADAPTER_ID = 'open-pencil.example.node-type-counter'
export const EXAMPLE_NODE_TYPE_COUNTER_FILTERS = Object.freeze([
  'ALL',
  'FRAME',
  'TEXT',
  'RECTANGLE'
] as const)
export type ExampleNodeTypeCounterFilter = (typeof EXAMPLE_NODE_TYPE_COUNTER_FILTERS)[number]

export const EXAMPLE_NODE_TYPE_COUNTER_PERMISSIONS = Object.freeze([
  'document.read'
] satisfies readonly PluginHostPermissionV2[])
export const EXAMPLE_NODE_TYPE_COUNTER_PARAMETERS = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      nodeType: Object.freeze({
        type: 'string' as const,
        title: 'Node type',
        description: 'Optional visible node type filter. Omit it to count all visible nodes.',
        enum: EXAMPLE_NODE_TYPE_COUNTER_FILTERS
      })
    }),
    additionalProperties: false as const,
    maxProperties: 1
  }),
  maxBytes: 64
}) satisfies PluginContributionDataContractV2
export const EXAMPLE_NODE_TYPE_COUNTER_RESULT = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      nodeType: Object.freeze({
        type: 'string' as const,
        enum: EXAMPLE_NODE_TYPE_COUNTER_FILTERS
      }),
      matchingNodeCount: Object.freeze({ type: 'integer' as const, minimum: 0 })
    }),
    required: Object.freeze(['nodeType', 'matchingNodeCount']),
    additionalProperties: false as const,
    maxProperties: 2
  }),
  maxBytes: 128
}) satisfies PluginContributionDataContractV2

export const EXAMPLE_NODE_TYPE_COUNTER_HOST_CONTRACT = Object.freeze({
  pluginId: EXAMPLE_NODE_TYPE_COUNTER_PLUGIN_ID,
  commandId: EXAMPLE_NODE_TYPE_COUNTER_COMMAND_ID,
  adapterId: EXAMPLE_NODE_TYPE_COUNTER_ADAPTER_ID,
  permissions: EXAMPLE_NODE_TYPE_COUNTER_PERMISSIONS,
  parameters: EXAMPLE_NODE_TYPE_COUNTER_PARAMETERS,
  result: EXAMPLE_NODE_TYPE_COUNTER_RESULT
})

function nodeTypeFilter(args: JSONObject): ExampleNodeTypeCounterFilter {
  const value = args.nodeType ?? 'ALL'
  if (
    typeof value !== 'string' ||
    !EXAMPLE_NODE_TYPE_COUNTER_FILTERS.includes(value as ExampleNodeTypeCounterFilter)
  ) {
    throw new TypeError('Node type must match the reviewed example filter set')
  }
  return value as ExampleNodeTypeCounterFilter
}

export function runExampleNodeTypeCounter(
  editor: ExampleVisibleDocumentEditor,
  args: JSONObject = {},
  signal?: AbortSignal
) {
  const nodeType = nodeTypeFilter(args)
  const { nodes } = collectExampleVisibleDocumentNodes(editor, signal)
  const matchingNodeCount =
    nodeType === 'ALL' ? nodes.length : nodes.filter((node) => node.type === nodeType).length

  return {
    status: 'completed' as const,
    message: `Node type count for ${nodeType}: ${matchingNodeCount}.`,
    data: { nodeType, matchingNodeCount }
  }
}
