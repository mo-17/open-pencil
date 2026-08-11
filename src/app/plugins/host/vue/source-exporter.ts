import {
  resolveCompilerLocalFonts,
  withDefaults,
  type CompilerFontFaceAsset,
  type CompilerFontManifest,
  type CompileWarning
} from '@open-pencil/compiler'
import {
  assessFontLicenseBytes,
  buildBundledFontRedistributionNotice,
  weightToStyle,
  type NodeFontFace
} from '@open-pencil/core/text'

import { throwIfPluginExportAborted } from '../exporter-abort'
import {
  buildSourceProjectExportFiles,
  createDefaultSourceProjectExporterDependencies,
  resolveSourceExporterInvocation,
  runSourceProjectExport,
  sourceProjectNames,
  type SourceExporterEditor,
  type SourceProjectExporterDependencies,
  type SourceProjectExportResult,
  type SourceProjectFontPolicyResult
} from '../source-exporter-runtime'
import { archiveVueSourceProjectInWorker } from './archive/client'
import { compileVueSourceProjectInWorker } from './compiler/client'

export type VueSourceExportEditor = SourceExporterEditor
export type VueSourceExporterDependencies = SourceProjectExporterDependencies<VueSourceExportEditor>
export type VueSourceExportResult = SourceProjectExportResult

const DEFAULT_DEPENDENCIES = Object.freeze({
  ...createDefaultSourceProjectExporterDependencies<VueSourceExportEditor>('Vue project'),
  archive: archiveVueSourceProjectInWorker,
  compile: compileVueSourceProjectInWorker,
  resolveFontManifest: resolveVueSourceFontManifestWithoutNetwork
})

export async function resolveVueSourceFontManifestWithoutNetwork(
  editor: VueSourceExportEditor,
  pageIds: readonly string[],
  signal?: AbortSignal
): Promise<CompilerFontManifest> {
  throwIfPluginExportAborted(signal)
  const manifest = await resolveCompilerLocalFonts({ graph: editor.graph, pageIds })
  throwIfPluginExportAborted(signal)
  return manifest
}

function numericFontWeight(weight: CompilerFontFaceAsset['weight']): number | undefined {
  const value = Array.isArray(weight) ? weight[0] : Number(weight)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function auditedFaceStyle(face: CompilerFontFaceAsset): string | undefined {
  const weight = numericFontWeight(face.weight)
  return weight === undefined ? undefined : weightToStyle(weight, face.style === 'italic')
}

function exactFaceBuffer(content: Uint8Array): ArrayBuffer {
  return content.slice().buffer
}

export async function applyVueRedistributionFontPolicy(
  manifest: CompilerFontManifest
): Promise<SourceProjectFontPolicyResult> {
  const faces: CompilerFontFaceAsset[] = []
  const noticeFaces: NodeFontFace[] = []
  const warnings: CompileWarning[] = []

  for (const face of manifest.faces) {
    const style = auditedFaceStyle(face)
    if (!style) {
      warnings.push({
        code: 'vue-font-license-unverified',
        message: `Font "${face.family}" (${face.path}) was omitted from the Vue project because its weight/style could not be matched to the reviewed bundled-font manifest; authored font-family CSS remains unchanged.`
      })
      continue
    }

    const assessment = await assessFontLicenseBytes(
      face.family,
      style,
      exactFaceBuffer(face.content)
    )
    if (assessment.classification === 'restricted') {
      const fsType = assessment.embeddedMetadata?.fsType
      warnings.push({
        code: 'font-license-embedding-restricted',
        message: `Font "${face.family}" (${face.path}) was omitted from the Vue project because its exact bytes declare restricted embedding${fsType === undefined ? '' : ` in OpenType OS/2 fsType 0x${fsType.toString(16).padStart(4, '0')}`}; authored font-family CSS remains unchanged.`
      })
      continue
    }

    const license = assessment.license
    const faceNotice = buildBundledFontRedistributionNotice([{ family: face.family, style }])
    if (assessment.classification !== 'verified_open' || !license) {
      warnings.push({
        code: 'vue-font-license-unverified',
        message: `Font "${face.family}" (${face.path}) was omitted from the Vue project because its exact bytes do not match the reviewed bundled-font manifest; authored font-family CSS remains unchanged.`
      })
      continue
    }
    if (!faceNotice) {
      warnings.push({
        code: 'font-license-notice-unavailable',
        message: `Font "${face.family}" (${face.path}; SPDX: ${license.id}) was omitted from the Vue project because its reviewed copyright and full license notice were unavailable; authored font-family CSS remains unchanged.`
      })
      continue
    }

    faces.push({
      ...face,
      licenseEvidence: { kind: 'verified_open', licenseIds: [license.id] }
    })
    noticeFaces.push({ family: face.family, style })
  }

  const notice = buildBundledFontRedistributionNotice(noticeFaces)
  if (faces.length > 0 && !notice) {
    throw new Error('Reviewed Vue font assets are missing their redistribution notice')
  }
  if (faces.length < manifest.faces.length) {
    warnings.unshift({
      code: 'vue-font-assets-omitted',
      message: `Vue export omitted ${manifest.faces.length - faces.length} unverified or restricted font asset(s), preserved authored font-family CSS, and kept every exact reviewed local font byte with its redistribution notice.`
    })
  }

  return {
    manifest: { ...manifest, faces },
    warnings,
    ...(notice ? { additionalFiles: new Map([['FONT-LICENSES.txt', notice]]) } : {})
  }
}

export function exportCurrentDocumentAsVueSource(
  editor: VueSourceExportEditor,
  signal?: AbortSignal
): Promise<VueSourceExportResult>
export function exportCurrentDocumentAsVueSource(
  editor: VueSourceExportEditor,
  dependencies?: VueSourceExporterDependencies,
  signal?: AbortSignal
): Promise<VueSourceExportResult>
export async function exportCurrentDocumentAsVueSource(
  editor: VueSourceExportEditor,
  dependenciesOrSignal: VueSourceExporterDependencies | AbortSignal = DEFAULT_DEPENDENCIES,
  explicitSignal?: AbortSignal
): Promise<VueSourceExportResult> {
  const { dependencies, signal } = resolveSourceExporterInvocation(
    dependenciesOrSignal,
    DEFAULT_DEPENDENCIES,
    explicitSignal
  )
  const names = sourceProjectNames(editor.state.documentName)
  return runSourceProjectExport({
    editor,
    dependencies,
    fileName: `${names.package}-vue.zip`,
    signal,
    compilerTargetName: 'Vue',
    applyFontPolicy: applyVueRedistributionFontPolicy,
    createCompilerInput({ pageIds, fontManifest }) {
      return {
        graph: editor.graph,
        pageIds,
        fontManifest,
        options: withDefaults({
          packageName: names.package,
          productName: names.product,
          target: 'vue',
          router: pageIds.length > 1 ? 'vue-router-v4' : 'none',
          devMode: false
        })
      }
    },
    buildProject(compiledFiles, warnings) {
      return buildSourceProjectExportFiles(compiledFiles, warnings, 'Vue')
    }
  })
}
