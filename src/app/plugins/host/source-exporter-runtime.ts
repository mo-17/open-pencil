import {
  compile,
  resolveCompilerWebFonts,
  type CompilerFontManifest,
  type CompilerInput,
  type CompilerOutput,
  type CompileWarning
} from '@open-pencil/compiler'
import { IS_BROWSER } from '@open-pencil/core/constants'
import { fontManager } from '@open-pencil/core/text'

import { chooseTauriExportPath, writeTauriExportFile } from '@/app/document/export/files'
import { downloadBlob } from '@/app/document/io/browser'
import type { EditorStore } from '@/app/editor/active-store'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

import { throwIfPluginExportAborted } from './exporter-abort'
import type { AppPluginExporterExecutionResult } from './exporter-types'
import { archiveProjectFiles } from './project-archive'
import { safeSourceProjectPackageName, safeSourceProjectProductName } from './source-project'

export { archiveProjectFiles as archiveSourceProjectFiles }

export interface SourceExporterEditor {
  graph: EditorStore['graph']
  state: Pick<EditorStore['state'], 'documentName'>
}

export interface SourceProjectExportDestination {
  write(data: Uint8Array, signal?: AbortSignal): Promise<boolean> | Promise<void>
}

export interface SourceProjectFontPolicyResult {
  manifest: CompilerFontManifest
  warnings: CompileWarning[]
}

export interface SourceProjectExporterDependencies<TEditor extends SourceExporterEditor> {
  resolveFontManifest(
    editor: TEditor,
    pageIds: readonly string[],
    signal?: AbortSignal
  ): Promise<CompilerFontManifest>
  compile(input: CompilerInput): CompilerOutput
  archive(
    files: ReadonlyMap<string, string | Uint8Array>,
    signal?: AbortSignal
  ): Promise<Uint8Array>
  chooseDestination(
    fileName: string,
    signal?: AbortSignal
  ): Promise<SourceProjectExportDestination | null>
}

export type SourceProjectExportResult = AppPluginExporterExecutionResult<CompileWarning>

interface SourceProjectCompilerInputContext<TEditor extends SourceExporterEditor> {
  editor: TEditor
  pageIds: string[]
  fontManifest: CompilerFontManifest
}

export interface RunSourceProjectExportOptions<TEditor extends SourceExporterEditor> {
  editor: TEditor
  dependencies: SourceProjectExporterDependencies<TEditor>
  fileName: string
  signal?: AbortSignal
  compilerTargetName?: string
  applyFontPolicy?: (manifest: CompilerFontManifest) => SourceProjectFontPolicyResult
  createCompilerInput(context: SourceProjectCompilerInputContext<TEditor>): CompilerInput
  buildProject(
    compiledFiles: ReadonlyMap<string, string | Uint8Array>,
    warnings: readonly CompileWarning[]
  ): Map<string, string | Uint8Array>
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof value.aborted === 'boolean' &&
    'addEventListener' in value &&
    typeof value.addEventListener === 'function'
  )
}

export function resolveSourceExporterInvocation<TDependencies>(
  dependenciesOrSignal: TDependencies | AbortSignal | undefined,
  defaultDependencies: TDependencies,
  explicitSignal?: AbortSignal
): { dependencies: TDependencies; signal: AbortSignal | undefined } {
  return isAbortSignal(dependenciesOrSignal)
    ? { dependencies: defaultDependencies, signal: dependenciesOrSignal }
    : {
        dependencies: dependenciesOrSignal ?? defaultDependencies,
        signal: explicitSignal
      }
}

function requireSourceProjectCompilerFiles(compiled: CompilerOutput, targetName?: string): void {
  if (compiled.files.size > 0) return
  const warningCodes = compiled.warnings.map((warning) => warning.code).join(', ')
  const target = targetName ? ` ${targetName}` : ''
  throw new Error(
    `Compiler produced no${target} project files${warningCodes ? ` (${warningCodes})` : ''}`
  )
}

export async function runSourceProjectExport<TEditor extends SourceExporterEditor>(
  options: RunSourceProjectExportOptions<TEditor>
): Promise<SourceProjectExportResult> {
  const { editor, dependencies, fileName, signal } = options
  throwIfPluginExportAborted(signal)
  const pageIds = editor.graph.getPages().map(({ id }) => id)
  if (pageIds.length === 0) throw new Error('The current document has no pages to export')

  const destination = await dependencies.chooseDestination(fileName, signal)
  throwIfPluginExportAborted(signal)
  if (!destination) return { fileName, fileCount: 0, warnings: [], saved: false }

  const resolvedFontManifest = await dependencies.resolveFontManifest(editor, pageIds, signal)
  throwIfPluginExportAborted(signal)
  const fontPolicy = options.applyFontPolicy?.(resolvedFontManifest) ?? {
    manifest: resolvedFontManifest,
    warnings: []
  }
  const compiled = dependencies.compile(
    options.createCompilerInput({ editor, pageIds, fontManifest: fontPolicy.manifest })
  )
  throwIfPluginExportAborted(signal)
  requireSourceProjectCompilerFiles(compiled, options.compilerTargetName)

  const warnings = [...fontPolicy.warnings, ...compiled.warnings]
  const project = options.buildProject(compiled.files, warnings)
  const archive = await dependencies.archive(project, signal)
  throwIfPluginExportAborted(signal)
  const saved = (await destination.write(archive, signal)) ?? true
  return { fileName, fileCount: project.size, warnings, saved }
}

export function createDefaultSourceProjectExporterDependencies<
  TEditor extends SourceExporterEditor
>(description: string): SourceProjectExporterDependencies<TEditor> {
  return Object.freeze({
    resolveFontManifest: resolveSourceExporterFontManifest,
    compile,
    archive: archiveProjectFiles,
    chooseDestination(fileName: string, signal?: AbortSignal) {
      return chooseSourceProjectDestination(fileName, description, signal)
    }
  })
}

export function sourceProjectNames(documentName: string): { package: string; product: string } {
  return {
    package: safeSourceProjectPackageName(documentName),
    product: safeSourceProjectProductName(documentName)
  }
}

async function writeTauriSourceProjectAtomically(
  path: string,
  data: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  const { remove, rename } = await import('@tauri-apps/plugin-fs')
  const temporaryPath = `${path}.openpencil-${crypto.randomUUID()}.tmp`
  try {
    throwIfPluginExportAborted(signal)
    await writeTauriExportFile(temporaryPath, data)
    // The temporary file is not user-visible output. Commit it only while the
    // request is still live so an RPC timeout cannot land a completed archive.
    throwIfPluginExportAborted(signal)
    await rename(temporaryPath, path)
  } catch (cause) {
    await remove(temporaryPath).catch(() => undefined)
    throw cause
  }
}

export async function chooseSourceProjectDestination(
  fileName: string,
  description: string,
  signal?: AbortSignal
): Promise<SourceProjectExportDestination | null> {
  throwIfPluginExportAborted(signal)
  if (isTauri()) {
    const path = await chooseTauriExportPath(fileName, description, '.zip')
    throwIfPluginExportAborted(signal)
    return path
      ? {
          async write(data, writeSignal = signal) {
            await writeTauriSourceProjectAtomically(path, data, writeSignal)
          }
        }
      : null
  }

  if (IS_BROWSER && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description,
            accept: { 'application/zip': ['.zip'] }
          }
        ]
      })
      throwIfPluginExportAborted(signal)
      return {
        async write(data, writeSignal = signal) {
          throwIfPluginExportAborted(writeSignal)
          const writable = await handle.createWritable()
          try {
            throwIfPluginExportAborted(writeSignal)
            await writable.write(data as Uint8Array<ArrayBuffer>)
            // File System Access commits on close. Abort the writable instead
            // when cancellation arrives while the bytes are being staged.
            throwIfPluginExportAborted(writeSignal)
            await writable.close()
          } catch (cause) {
            await writable.abort().catch(() => undefined)
            throw cause
          }
        }
      }
    } catch (cause) {
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'name' in cause &&
        cause.name === 'AbortError'
      ) {
        return null
      }
      throw cause
    }
  }

  return {
    async write(data, writeSignal = signal) {
      throwIfPluginExportAborted(writeSignal)
      downloadBlob(data, fileName, 'application/zip')
    }
  }
}

export function applySourceProjectRedistributionFontPolicy(
  manifest: CompilerFontManifest,
  targetName: string,
  unverifiedWarningCode: string
): SourceProjectFontPolicyResult {
  const warnings: CompileWarning[] = []
  for (const face of manifest.faces) {
    if (face.licenseEvidence?.kind === 'verified_open') {
      const licenseIds = face.licenseEvidence.licenseIds.join(', ') || 'none declared'
      warnings.push({
        code: 'font-license-notice-unavailable',
        message: `Font "${face.family}" (${face.path}; SPDX: ${licenseIds}) was omitted from the ${targetName} project because its evidence does not include the required font-specific copyright, license text, or NOTICE files.`
      })
      continue
    }
    if (face.licenseEvidence?.kind === 'restricted') {
      warnings.push({
        code: 'font-license-embedding-restricted',
        message: `Font "${face.family}" has restricted embedding rights and was omitted from the ${targetName} project.`
      })
      continue
    }
    warnings.push({
      code: unverifiedWarningCode,
      message: `Font "${face.family}" was omitted from the ${targetName} project because an exact redistributable license was not verified.`
    })
  }
  return { manifest: { ...manifest, faces: [] }, warnings }
}

function warningLine(warning: CompileWarning, index: number): string {
  const code = warning.code.replaceAll('`', "'")
  const node = warning.nodeId ? ` (node \`${warning.nodeId.replaceAll('`', "'")}\`)` : ''
  const message = warning.message.replace(/\s+/g, ' ').trim()
  return `${index + 1}. \`${code}\`${node}: ${message}`
}

export function buildSourceProjectExportFiles(
  compiledFiles: ReadonlyMap<string, string | Uint8Array>,
  warnings: readonly CompileWarning[],
  targetName: string
): Map<string, string | Uint8Array> {
  const files = new Map(compiledFiles)
  if (warnings.length > 0) {
    files.set(
      'EXPORT_WARNINGS.md',
      `# OpenPencil ${targetName} export warnings\n\nThe project was generated, but the following authored features require review or a native adapter. OpenPencil did not silently treat them as supported.\n\n${warnings.map(warningLine).join('\n')}\n`
    )
  }
  return files
}

export async function resolveSourceExporterFontManifest(
  editor: SourceExporterEditor,
  pageIds: readonly string[],
  signal?: AbortSignal
): Promise<CompilerFontManifest> {
  throwIfPluginExportAborted(signal)
  const manifest = await resolveCompilerWebFonts({
    graph: editor.graph,
    pageIds: [...pageIds],
    providers: fontManager.enabledOnlineFontProviders(),
    ...(isTauri() ? { fetcher: tauriFetch } : {}),
    preferLoaded: true
  })
  throwIfPluginExportAborted(signal)
  return manifest
}
