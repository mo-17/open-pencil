import {
  safeFlutterPackageName,
  withDefaults,
  type CompilerFontManifest,
  type CompileWarning
} from '@open-pencil/compiler'

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

export type FlutterExportResult = SourceProjectExportResult
export type FlutterExportDestination = SourceProjectExportDestination
export type FlutterExportEditor = SourceExporterEditor

export type FlutterExporterDependencies = SourceProjectExporterDependencies<FlutterExportEditor>

export function applyFlutterRedistributionFontPolicy(
  manifest: CompilerFontManifest
): SourceProjectFontPolicyResult {
  const licensed = applySourceProjectRedistributionFontPolicy(
    manifest,
    'Flutter',
    'flutter-font-license-unverified'
  )
  const warnings = [...licensed.warnings]
  for (const face of manifest.faces) {
    if (
      face.licenseEvidence?.kind === 'verified_open' &&
      face.format !== 'truetype' &&
      face.format !== 'opentype'
    ) {
      warnings.push({
        code: 'flutter-font-format-unsupported',
        message: `Font "${face.family}" uses ${face.format}; this Flutter target accepts only TTF or OTF after complete redistribution notices become available.`
      })
    }
  }
  const faces = licensed.manifest.faces.filter(
    (face) => face.format === 'truetype' || face.format === 'opentype'
  )
  return { manifest: { ...licensed.manifest, faces }, warnings }
}

const DEFAULT_DEPENDENCIES =
  createDefaultSourceProjectExporterDependencies<FlutterExportEditor>('Flutter project')

export function buildFlutterExportFiles(
  compiledFiles: ReadonlyMap<string, string | Uint8Array>,
  warnings: readonly CompileWarning[]
): Map<string, string | Uint8Array> {
  return buildSourceProjectExportFiles(compiledFiles, warnings, 'Flutter')
}

export function exportCurrentDocumentAsFlutterSource(
  editor: FlutterExportEditor,
  signal?: AbortSignal
): Promise<FlutterExportResult>
export function exportCurrentDocumentAsFlutterSource(
  editor: FlutterExportEditor,
  dependencies?: FlutterExporterDependencies,
  signal?: AbortSignal
): Promise<FlutterExportResult>
export async function exportCurrentDocumentAsFlutterSource(
  editor: FlutterExportEditor,
  dependenciesOrSignal: FlutterExporterDependencies | AbortSignal = DEFAULT_DEPENDENCIES,
  explicitSignal?: AbortSignal
): Promise<FlutterExportResult> {
  const { dependencies, signal } = resolveSourceExporterInvocation(
    dependenciesOrSignal,
    DEFAULT_DEPENDENCIES,
    explicitSignal
  )
  const names = sourceProjectNames(editor.state.documentName)
  const packageName = safeFlutterPackageName(editor.state.documentName)
  const fileName = `${names.package}-flutter.zip`
  return runSourceProjectExport({
    editor,
    dependencies,
    fileName,
    signal,
    compilerTargetName: 'Flutter',
    applyFontPolicy: applyFlutterRedistributionFontPolicy,
    createCompilerInput({ pageIds, fontManifest }) {
      return {
        graph: editor.graph,
        pageIds,
        fontManifest,
        options: withDefaults({
          packageName,
          productName: names.product,
          target: 'flutter',
          router: pageIds.length > 1 ? 'flutter-router' : 'none',
          devMode: false
        })
      }
    },
    buildProject: buildFlutterExportFiles
  })
}
