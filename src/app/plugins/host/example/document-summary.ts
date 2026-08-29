import type {
  PluginContributionDataContractV2,
  PluginHostPermissionV2
} from '@open-pencil/plugin-contracts'

import type { EditorStore } from '@/app/editor/active-store'

import { EXAMPLE_EMPTY_PARAMETERS } from './parameters'
import {
  collectExampleVisibleDocumentNodes,
  type ExampleVisibleDocumentEditor
} from './visible-document'

export interface ExampleDocumentSummaryEditor extends ExampleVisibleDocumentEditor {
  state: Pick<EditorStore['state'], 'selectedIds'>
}

export const EXAMPLE_DOCUMENT_SUMMARY_PLUGIN_ID = 'example.document-summary'
export const EXAMPLE_DOCUMENT_SUMMARY_COMMAND_ID = 'summarize-document'
export const EXAMPLE_DOCUMENT_SUMMARY_ADAPTER_ID = 'open-pencil.example.document-summary'
export const EXAMPLE_DOCUMENT_SUMMARY_PERMISSIONS = Object.freeze([
  'document.read',
  'document.selection.read'
] satisfies readonly PluginHostPermissionV2[])
export const EXAMPLE_DOCUMENT_SUMMARY_PARAMETERS = EXAMPLE_EMPTY_PARAMETERS
export const EXAMPLE_DOCUMENT_SUMMARY_RESULT = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      pageCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      nodeCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      selectedNodeCount: Object.freeze({ type: 'integer' as const, minimum: 0 })
    }),
    required: Object.freeze(['pageCount', 'nodeCount', 'selectedNodeCount']),
    additionalProperties: false as const,
    maxProperties: 3
  }),
  maxBytes: 256
}) satisfies PluginContributionDataContractV2

export const EXAMPLE_DOCUMENT_SUMMARY_HOST_CONTRACT = Object.freeze({
  pluginId: EXAMPLE_DOCUMENT_SUMMARY_PLUGIN_ID,
  commandId: EXAMPLE_DOCUMENT_SUMMARY_COMMAND_ID,
  adapterId: EXAMPLE_DOCUMENT_SUMMARY_ADAPTER_ID,
  permissions: EXAMPLE_DOCUMENT_SUMMARY_PERMISSIONS,
  parameters: EXAMPLE_DOCUMENT_SUMMARY_PARAMETERS,
  result: EXAMPLE_DOCUMENT_SUMMARY_RESULT
})

export function runExampleDocumentSummary(
  editor: ExampleDocumentSummaryEditor,
  signal?: AbortSignal
) {
  const { pages, nodes } = collectExampleVisibleDocumentNodes(editor, signal)
  const visibleNodeIds = new Set(nodes.map((node) => node.id))

  const pageCount = pages.length
  const nodeCount = nodes.length
  const selectedNodeCount = [...editor.state.selectedIds].filter((id) =>
    visibleNodeIds.has(id)
  ).length
  return {
    status: 'completed' as const,
    message: `Document summary: ${pageCount} page(s), ${nodeCount} node(s), ${selectedNodeCount} selected.`,
    data: { pageCount, nodeCount, selectedNodeCount }
  }
}
