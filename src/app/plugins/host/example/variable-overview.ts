import type {
  PluginContributionDataContractV2,
  PluginHostPermissionV2
} from '@open-pencil/plugin-contracts'

import type { EditorStore } from '@/app/editor/active-store'

import { EXAMPLE_EMPTY_PARAMETERS } from './parameters'

/** Minimal variable-domain view accepted by the reviewed example adapter. */
export interface ExampleVariableOverviewEditor {
  graph: Pick<EditorStore['graph'], 'variableCollections' | 'variables'>
}

export const EXAMPLE_VARIABLE_OVERVIEW_PLUGIN_ID = 'example.variable-overview'
export const EXAMPLE_VARIABLE_OVERVIEW_COMMAND_ID = 'summarize-variables'
export const EXAMPLE_VARIABLE_OVERVIEW_ADAPTER_ID = 'open-pencil.example.variable-overview'
export const EXAMPLE_VARIABLE_OVERVIEW_PERMISSIONS = Object.freeze([
  'document.variables.read'
] satisfies readonly PluginHostPermissionV2[])
export const EXAMPLE_VARIABLE_OVERVIEW_PARAMETERS = EXAMPLE_EMPTY_PARAMETERS
export const EXAMPLE_VARIABLE_OVERVIEW_RESULT = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      collectionCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      variableCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      modeCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      publishableVariableCount: Object.freeze({ type: 'integer' as const, minimum: 0 })
    }),
    required: Object.freeze([
      'collectionCount',
      'variableCount',
      'modeCount',
      'publishableVariableCount'
    ]),
    additionalProperties: false as const,
    maxProperties: 4
  }),
  maxBytes: 256
}) satisfies PluginContributionDataContractV2

export const EXAMPLE_VARIABLE_OVERVIEW_HOST_CONTRACT = Object.freeze({
  pluginId: EXAMPLE_VARIABLE_OVERVIEW_PLUGIN_ID,
  commandId: EXAMPLE_VARIABLE_OVERVIEW_COMMAND_ID,
  adapterId: EXAMPLE_VARIABLE_OVERVIEW_ADAPTER_ID,
  permissions: EXAMPLE_VARIABLE_OVERVIEW_PERMISSIONS,
  parameters: EXAMPLE_VARIABLE_OVERVIEW_PARAMETERS,
  result: EXAMPLE_VARIABLE_OVERVIEW_RESULT
})

export function runExampleVariableOverview(
  editor: ExampleVariableOverviewEditor,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  let modeCount = 0
  for (const collection of editor.graph.variableCollections.values()) {
    signal?.throwIfAborted()
    modeCount += collection.modes.length
  }

  let publishableVariableCount = 0
  for (const variable of editor.graph.variables.values()) {
    signal?.throwIfAborted()
    if (!variable.hiddenFromPublishing) publishableVariableCount++
  }

  const data = {
    collectionCount: editor.graph.variableCollections.size,
    variableCount: editor.graph.variables.size,
    modeCount,
    publishableVariableCount
  }
  return {
    status: 'completed' as const,
    message: `Variable overview: ${data.collectionCount} collection(s), ${data.variableCount} variable(s), and ${data.modeCount} mode(s).`,
    data
  }
}
