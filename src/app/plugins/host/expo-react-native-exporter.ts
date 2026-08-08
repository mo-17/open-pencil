import { withDefaults, type CompilerFontManifest, type CompileWarning } from '@open-pencil/compiler'

import {
  applySourceProjectRedistributionFontPolicy,
  buildSourceProjectExportFiles,
  createDefaultSourceProjectExporterDependencies,
  resolveSourceExporterInvocation,
  runSourceProjectExport,
  sourceProjectNames,
  type SourceExporterEditor,
  type SourceProjectExportDestination,
  type SourceProjectExportResult,
  type SourceProjectExporterDependencies,
  type SourceProjectFontPolicyResult
} from './source-exporter-runtime'

export type ExpoReactNativeExportResult = SourceProjectExportResult

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

const DEFAULT_DEPENDENCIES =
  createDefaultSourceProjectExporterDependencies<ExpoReactNativeExportEditor>(
    'Expo React Native project'
  )

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
  const names = sourceProjectNames(editor.state.documentName)
  const packageName = names.package
  const fileName = `${packageName}-expo.zip`
  return runSourceProjectExport({
    editor,
    dependencies,
    fileName,
    signal,
    compilerTargetName: 'Expo',
    applyFontPolicy: applyExpoRedistributionFontPolicy,
    createCompilerInput({ pageIds, fontManifest }) {
      return {
        graph: editor.graph,
        pageIds,
        fontManifest,
        options: withDefaults({
          packageName,
          productName: names.product,
          target: 'expo',
          router: pageIds.length > 1 ? 'expo-router' : 'none',
          devMode: false
        })
      }
    },
    buildProject: buildExpoReactNativeExportFiles
  })
}
