import { buildCapacitorReactProjectFiles } from '@open-pencil/compiler/adapters/react/capacitor-project'

import {
  createReactSourceProjectExporter,
  type ReactSourceExporterDependencies
} from './react-source-exporter-runtime'
import type { SourceExporterEditor, SourceProjectExportResult } from './source-exporter-runtime'

export type CapacitorExportEditor = SourceExporterEditor
export type CapacitorExporterDependencies = ReactSourceExporterDependencies
export type CapacitorExportResult = SourceProjectExportResult

export const exportCurrentDocumentAsCapacitorSource = createReactSourceProjectExporter(
  'capacitor',
  buildCapacitorReactProjectFiles
)
