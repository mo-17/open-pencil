import { exportFigFileWithOptions } from '@open-pencil/core/io/formats/fig'
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

const PROJECTION_WARNING =
  'This is an editable Figma projection. OpenPencil interactions and plugin runtime behavior are not executable in Figma.'

export interface FigmaProjectionExporterDependencies {
  exportProjection(graph: SceneGraph): Promise<Uint8Array>
  chooseDestination(
    fileName: string,
    signal?: AbortSignal
  ): Promise<PluginFileExportDestination | null>
}

const DEFAULT_DEPENDENCIES: FigmaProjectionExporterDependencies = Object.freeze({
  exportProjection(graph: SceneGraph) {
    return exportFigFileWithOptions(graph, { profile: 'figma-compatible' })
  },
  chooseDestination(fileName: string, signal?: AbortSignal) {
    return choosePluginFileExportDestination(
      fileName,
      'Figma editable projection',
      '.fig',
      'application/octet-stream',
      signal
    )
  }
})

export async function exportCurrentDocumentAsFigmaProjection(
  editor: EditorStore,
  dependenciesOrSignal?: FigmaProjectionExporterDependencies | AbortSignal,
  explicitSignal?: AbortSignal
): Promise<AppPluginExporterExecutionResult<string>> {
  const { dependencies, signal } = resolveSourceExporterInvocation(
    dependenciesOrSignal,
    DEFAULT_DEPENDENCIES,
    explicitSignal
  )
  const fileName = `${sourceProjectNames(editor.state.documentName).package}-figma-editable.fig`
  return runPluginFileExport({
    fileName,
    signal,
    warnings: [PROJECTION_WARNING],
    chooseDestination: (name, destinationSignal) =>
      dependencies.chooseDestination(name, destinationSignal),
    createBytes: () => dependencies.exportProjection(editor.graph)
  })
}
