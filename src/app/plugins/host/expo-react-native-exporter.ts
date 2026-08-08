import {
  compile,
  withDefaults,
  type CompilerFontManifest,
  type CompileWarning
} from '@open-pencil/compiler'

import { throwIfPluginExportAborted } from './exporter-abort'
import type { AppPluginExporterExecutionResult } from './exporter-types'
import {
  applySourceProjectRedistributionFontPolicy,
  archiveSourceProjectFiles,
  buildSourceProjectExportFiles,
  chooseSourceProjectDestination,
  resolveSourceExporterFontManifest,
  resolveSourceExporterInvocation,
  sourceProjectNames,
  type SourceExporterEditor,
  type SourceProjectExportDestination,
  type SourceProjectExporterDependencies,
  type SourceProjectFontPolicyResult
} from './source-exporter-runtime'

export type ExpoReactNativeExportResult = AppPluginExporterExecutionResult<CompileWarning>

export type ExpoReactNativeExportDestination = SourceProjectExportDestination

export type ExpoReactNativeExportEditor = SourceExporterEditor

export type ExpoReactNativeExporterDependencies =
  SourceProjectExporterDependencies<ExpoReactNativeExportEditor>

export type ExpoFontPolicyResult = SourceProjectFontPolicyResult

export function applyExpoRedistributionFontPolicy(
  manifest: CompilerFontManifest
): ExpoFontPolicyResult {
  return applySourceProjectRedistributionFontPolicy(
    manifest,
    'Expo',
    'expo-font-license-unverified'
  )
}

async function chooseDefaultDestination(
  fileName: string,
  signal?: AbortSignal
): Promise<ExpoReactNativeExportDestination | null> {
  return chooseSourceProjectDestination(fileName, 'Expo React Native project', signal)
}

const DEFAULT_DEPENDENCIES: ExpoReactNativeExporterDependencies = Object.freeze({
  resolveFontManifest: resolveSourceExporterFontManifest,
  compile,
  archive: archiveSourceProjectFiles,
  chooseDestination: chooseDefaultDestination
})

export function buildExpoReactNativeExportFiles(
  compiledFiles: ReadonlyMap<string, string | Uint8Array>,
  warnings: readonly CompileWarning[]
): Map<string, string | Uint8Array> {
  return buildSourceProjectExportFiles(compiledFiles, warnings, 'Expo')
}

export function exportCurrentDocumentAsExpoReactNativeSource(
  editor: ExpoReactNativeExportEditor,
  signal?: AbortSignal
): Promise<ExpoReactNativeExportResult>
export function exportCurrentDocumentAsExpoReactNativeSource(
  editor: ExpoReactNativeExportEditor,
  dependencies?: ExpoReactNativeExporterDependencies,
  signal?: AbortSignal
): Promise<ExpoReactNativeExportResult>
export async function exportCurrentDocumentAsExpoReactNativeSource(
  editor: ExpoReactNativeExportEditor,
  dependenciesOrSignal: ExpoReactNativeExporterDependencies | AbortSignal = DEFAULT_DEPENDENCIES,
  explicitSignal?: AbortSignal
): Promise<ExpoReactNativeExportResult> {
  const { dependencies, signal } = resolveSourceExporterInvocation(
    dependenciesOrSignal,
    DEFAULT_DEPENDENCIES,
    explicitSignal
  )
  throwIfPluginExportAborted(signal)
  const pageIds = editor.graph.getPages().map(({ id }) => id)
  if (pageIds.length === 0) throw new Error('The current document has no pages to export')
  const names = sourceProjectNames(editor.state.documentName)
  const packageName = names.package
  const fileName = `${packageName}-expo.zip`
  const destination = await dependencies.chooseDestination(fileName, signal)
  throwIfPluginExportAborted(signal)
  if (!destination) return { fileName, fileCount: 0, warnings: [], saved: false }

  const resolvedFontManifest = await dependencies.resolveFontManifest(editor, pageIds, signal)
  throwIfPluginExportAborted(signal)
  const fontPolicy = applyExpoRedistributionFontPolicy(resolvedFontManifest)
  const compiled = dependencies.compile({
    graph: editor.graph,
    pageIds,
    fontManifest: fontPolicy.manifest,
    options: withDefaults({
      packageName,
      productName: names.product,
      target: 'expo',
      router: pageIds.length > 1 ? 'expo-router' : 'none',
      devMode: false
    })
  })
  throwIfPluginExportAborted(signal)
  if (compiled.files.size === 0) {
    const warningCodes = compiled.warnings.map((warning) => warning.code).join(', ')
    throw new Error(
      `Compiler produced no Expo project files${warningCodes ? ` (${warningCodes})` : ''}`
    )
  }

  const warnings = [...fontPolicy.warnings, ...compiled.warnings]
  const project = buildExpoReactNativeExportFiles(compiled.files, warnings)
  const archive = await dependencies.archive(project, signal)
  throwIfPluginExportAborted(signal)
  await destination.write(archive, signal)
  return {
    fileName,
    fileCount: project.size,
    warnings,
    saved: true
  }
}
