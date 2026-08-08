import {
  compile,
  safeFlutterPackageName,
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

export type FlutterExportResult = AppPluginExporterExecutionResult<CompileWarning>
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

async function chooseDefaultDestination(
  fileName: string,
  signal?: AbortSignal
): Promise<FlutterExportDestination | null> {
  return chooseSourceProjectDestination(fileName, 'Flutter project', signal)
}

const DEFAULT_DEPENDENCIES: FlutterExporterDependencies = Object.freeze({
  resolveFontManifest: resolveSourceExporterFontManifest,
  compile,
  archive: archiveSourceProjectFiles,
  chooseDestination: chooseDefaultDestination
})

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
  throwIfPluginExportAborted(signal)
  const pageIds = editor.graph.getPages().map(({ id }) => id)
  if (pageIds.length === 0) throw new Error('The current document has no pages to export')
  const names = sourceProjectNames(editor.state.documentName)
  const packageName = safeFlutterPackageName(editor.state.documentName)
  const fileName = `${names.package}-flutter.zip`
  const destination = await dependencies.chooseDestination(fileName, signal)
  throwIfPluginExportAborted(signal)
  if (!destination) return { fileName, fileCount: 0, warnings: [], saved: false }

  const resolvedFontManifest = await dependencies.resolveFontManifest(editor, pageIds, signal)
  throwIfPluginExportAborted(signal)
  const fontPolicy = applyFlutterRedistributionFontPolicy(resolvedFontManifest)
  const compiled = dependencies.compile({
    graph: editor.graph,
    pageIds,
    fontManifest: fontPolicy.manifest,
    options: withDefaults({
      packageName,
      productName: names.product,
      target: 'flutter',
      router: pageIds.length > 1 ? 'flutter-router' : 'none',
      devMode: false
    })
  })
  throwIfPluginExportAborted(signal)
  if (compiled.files.size === 0) {
    const warningCodes = compiled.warnings.map((warning) => warning.code).join(', ')
    throw new Error(
      `Compiler produced no Flutter project files${warningCodes ? ` (${warningCodes})` : ''}`
    )
  }

  const warnings = [...fontPolicy.warnings, ...compiled.warnings]
  const project = buildFlutterExportFiles(compiled.files, warnings)
  const archive = await dependencies.archive(project, signal)
  throwIfPluginExportAborted(signal)
  await destination.write(archive, signal)
  return { fileName, fileCount: project.size, warnings, saved: true }
}
