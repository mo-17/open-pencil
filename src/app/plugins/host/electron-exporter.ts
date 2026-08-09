import { buildElectronReactProjectFiles } from '@open-pencil/compiler/adapters/react/electron-project'

import {
  createReactSourceProjectExporter,
  type ReactSourceExporterDependencies
} from './react-source-exporter-runtime'
import type { SourceExporterEditor, SourceProjectExportResult } from './source-exporter-runtime'

export type ElectronExportEditor = SourceExporterEditor
export type ElectronExporterDependencies = ReactSourceExporterDependencies
export type ElectronExportResult = SourceProjectExportResult

export const exportCurrentDocumentAsElectronSource = createReactSourceProjectExporter(
  'electron',
  (compiledFiles, _packageName, productName) =>
    buildElectronReactProjectFiles(compiledFiles, productName)
)
