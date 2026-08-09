import { buildNextJsReactProjectFiles } from '@open-pencil/compiler/adapters/react/next-project'

import {
  createReactSourceProjectExporter,
  type ReactSourceExporterDependencies
} from './react-source-exporter-runtime'
import type { SourceExporterEditor, SourceProjectExportResult } from './source-exporter-runtime'

export type NextJsExportEditor = SourceExporterEditor
export type NextJsExporterDependencies = ReactSourceExporterDependencies
export type NextJsExportResult = SourceProjectExportResult

export const exportCurrentDocumentAsNextJsSource = createReactSourceProjectExporter(
  'nextjs',
  (compiledFiles, _packageName, productName) =>
    buildNextJsReactProjectFiles(compiledFiles, productName)
)
