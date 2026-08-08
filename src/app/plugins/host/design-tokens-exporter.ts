import { exportDesignTokens, type DesignTokenExportResult } from '@open-pencil/core/io'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

import type { AppPluginExporterExecutionResult } from './exporter-types'
import {
  choosePluginFileExportDestination,
  type PluginFileExportDestination,
  resolveSourceExporterInvocation,
  runPluginFileExport,
  sourceProjectNames
} from './source-exporter-runtime'

export interface DesignTokensExporterDependencies {
  exportTokens(graph: SceneGraph): DesignTokenExportResult
  chooseDestination(
    fileName: string,
    signal?: AbortSignal
  ): Promise<PluginFileExportDestination | null>
}

const DEFAULT_DEPENDENCIES: DesignTokensExporterDependencies = Object.freeze({
  exportTokens: exportDesignTokens,
  chooseDestination(fileName: string, signal?: AbortSignal) {
    return choosePluginFileExportDestination(
      fileName,
      'OpenPencil design tokens',
      '.json',
      'application/json',
      signal
    )
  }
})

export async function exportCurrentDocumentDesignTokens(
  editor: EditorStore,
  dependenciesOrSignal?: DesignTokensExporterDependencies | AbortSignal,
  explicitSignal?: AbortSignal
): Promise<AppPluginExporterExecutionResult<string>> {
  const { dependencies, signal } = resolveSourceExporterInvocation(
    dependenciesOrSignal,
    DEFAULT_DEPENDENCIES,
    explicitSignal
  )
  const fileName = `${sourceProjectNames(editor.state.documentName).package}-design-tokens.json`
  return runPluginFileExport({
    fileName,
    signal,
    warnings: [],
    chooseDestination: (name, destinationSignal) =>
      dependencies.chooseDestination(name, destinationSignal),
    createBytes() {
      const result = dependencies.exportTokens(editor.graph)
      return new TextEncoder().encode(result.text)
    }
  })
}
