import {
  auditLowcodeNavigation,
  compactLowcodeHeadMetadata,
  validateLowcodeCustomCss,
  validateSupabaseConfig
} from '@open-pencil/core/lowcode-validation'
import type { LowcodeHeadMetadata, SceneGraph, SeoMetadata } from '@open-pencil/scene-graph'

import {
  applyCompilerFontManifest,
  applyExpoCompilerFontManifest,
  applyFlutterCompilerFontManifest
} from './font-manifest'
import { buildComponentRegistry } from './ir/collect/components'
import type { MotionLoweringCache } from './ir/collect/motion'
import { collectServerWorkflows } from './ir/collect/server-workflows'
import { collectComponents, collectTree } from './ir/collect/tree'
import type { IRMotion } from './ir/motion'
import { selectAdapter } from './select-adapter'
import { buildDesignTokenThemeCss } from './theme-css'
import type {
  CompilerInput,
  CompilerOptions,
  CompilerOutput,
  CompileWarning,
  HtmlMetadataOptions
} from './types'

export type {
  CompileWarning,
  HtmlMetadata,
  HtmlMetadataOptions,
  CompilerInput,
  CompilerFontFaceAsset,
  CompilerFontFormat,
  CompilerFontLicenseEvidence,
  CompilerFontManifest,
  CompilerOptions,
  CompilerOutput,
  UiKitName
} from './types'
export {
  resolveCompilerLocalFonts,
  resolveCompilerWebFonts,
  type ResolveCompilerLocalFontsInput,
  type ResolveCompilerWebFontsInput
} from './resolve-fonts'
export { dartPackageName as safeFlutterPackageName } from './adapters/flutter/names'
export {
  createPreviewFileDecodeCache,
  createPreviewFileEncodeCache,
  deserializePreviewFiles,
  resetPreviewFileEncodeCache,
  serializePreviewFiles,
  type PreviewFileDecodeCache,
  type PreviewFileEncodeCache,
  type SerializedPreviewFile
} from './preview-protocol'
// Phase 3 §3: validator + expression sublanguage live in
// `@open-pencil/core/lowcode-validation` so the lowcode AI tool surface
// (which sits in core) can share one source with editor + compiler.
// Re-exported here so existing consumers (`import { validateStateName }
// from '@open-pencil/compiler'`) stay unbroken.
export {
  validateStateName,
  validateExpression,
  validateUrlTemplate,
  type ValidationResult
} from '@open-pencil/core/lowcode-validation'
// Phase 2 §7 — preview iframe needs pageId↔slug round-trip; the React adapter's
// route derivation is the single source of truth, so we lift it to the public
// surface (and an editor-side helper) instead of replicating the algorithm.
export {
  derivePagePaths,
  findPageInfoByPageId,
  type PagePathInfo
} from './adapters/react/route-paths'

const DEFAULT_OPTIONS: CompilerOptions = {
  packageName: 'openpencil-output',
  target: 'react',
  reactVersion: '19',
  router: 'none',
  typescript: true,
  devMode: true,
  i18n: false
}

/**
 * Compile SceneGraph pages into a target project. React and Vue emit Vite web
 * apps; Expo and Flutter emit source-only native static MVPs.
 */
export function compile(input: CompilerInput): CompilerOutput {
  if (input.pageIds.length === 0) {
    return {
      files: new Map(),
      warnings: [{ code: 'no-pages', message: 'CompilerInput.pageIds is empty' }]
    }
  }

  const options = withPersistedThemeCss(
    input.graph,
    withPersistedMetadata(input.graph, input.pageIds, input.options)
  )
  const { adapter, warnings: selectionWarnings } = selectAdapter(options)
  if (!adapter) {
    return { files: new Map(), warnings: selectionWarnings }
  }

  // Phase 3 §8: extract reusable components (COMPONENT masters with ≥1
  // instance) once, then walk each page with the registry so masters + clean
  // instances emit `<Name />` refs instead of inlining the subtree.
  const styleOptions = { rtlLogicalProperties: options.rtlLogicalProperties === true }
  const registry = buildComponentRegistry(input.graph, styleOptions)
  // Phase 3 §9: i18n externalizes display strings at collect time, so the flag
  // threads into both page walks and component-body walks.
  const i18n = options.i18n === true
  const motionCache: MotionLoweringCache = new Map<string, IRMotion>()
  const serverWorkflowWarnings: CompileWarning[] = []
  let serverWorkflows = collectServerWorkflows(
    input.graph.getNode(input.graph.rootId)?.lowcodeServerWorkflows,
    serverWorkflowWarnings
  )
  const rootSupabase = input.graph.getNode(input.graph.rootId)?.lowcodeSupabaseConfig
  if (serverWorkflows && (!rootSupabase || !validateSupabaseConfig(rootSupabase).ok)) {
    serverWorkflowWarnings.push({
      code: 'server-workflows-supabase-config-required',
      message: 'Server workflows require a valid Supabase configuration and were omitted.'
    })
    serverWorkflows = undefined
  }
  const { defs: components, warnings: componentWarnings } = collectComponents(
    input.graph,
    registry,
    i18n,
    styleOptions,
    motionCache,
    serverWorkflows ?? null
  )
  const irs = input.pageIds.map((id) =>
    collectTree(input.graph, id, registry, i18n, styleOptions, motionCache, serverWorkflows ?? null)
  )
  const { files, warnings: adapterWarnings } = adapter.emit(irs, options, components)
  let fontWarnings: CompileWarning[] = []
  if (input.fontManifest) {
    if (options.target === 'expo') {
      fontWarnings = applyExpoCompilerFontManifest(
        files,
        input.graph,
        input.pageIds,
        input.fontManifest
      )
    } else if (options.target === 'flutter') {
      fontWarnings = applyFlutterCompilerFontManifest(
        files,
        input.graph,
        input.pageIds,
        input.fontManifest
      )
    } else {
      fontWarnings = applyCompilerFontManifest(
        files,
        input.graph,
        input.pageIds,
        input.fontManifest
      )
    }
  }
  const navigationWarnings = auditLowcodeNavigation(input.graph, {
    pageIds: input.pageIds
  })
    .issues
    // collectTree already reports the route-pattern fallback with the same source node.
    .filter((issue) => issue.code !== 'route-pattern-invalid')
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.nodeId || issue.pageId ? { nodeId: issue.nodeId ?? issue.pageId } : {})
    }))
  return {
    files,
    warnings: [
      ...selectionWarnings,
      ...serverWorkflowWarnings,
      ...componentWarnings,
      ...irs.flatMap((ir) => ir.warnings),
      ...adapterWarnings,
      ...navigationWarnings,
      ...fontWarnings
    ]
  }
}

export function withDefaults(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

function withPersistedThemeCss(graph: SceneGraph, options: CompilerOptions): CompilerOptions {
  const generated = buildDesignTokenThemeCss(graph)
  const explicit = options.themeCss?.trim()
  const themeCss = [generated.trim(), explicit].filter(Boolean).join('\n\n')
  return themeCss ? { ...options, themeCss: `${themeCss}\n` } : options
}

function withPersistedMetadata(
  graph: SceneGraph,
  pageIds: readonly string[],
  options: CompilerOptions
): CompilerOptions {
  const metadata = mergeMetadataOptions(metadataFromGraph(graph, pageIds), options.metadata)
  return metadata ? { ...options, metadata } : options
}

function metadataFromGraph(
  graph: SceneGraph,
  pageIds: readonly string[]
): HtmlMetadataOptions | undefined {
  const root = graph.getNode(graph.rootId)
  const rootMetadata = compactRootMetadata(
    root?.lowcodeSeoMetadata,
    root?.lowcodeHeadMetadata,
    root?.lowcodeCustomCss
  )
  const pages: Record<string, SeoMetadata> = {}
  for (const pageId of pageIds) {
    const pageMetadata = compactSeoMetadata(graph.getNode(pageId)?.lowcodeSeoMetadata)
    if (pageMetadata) pages[pageId] = pageMetadata
  }
  if (!rootMetadata && Object.keys(pages).length === 0) return undefined
  return Object.keys(pages).length > 0 ? { ...rootMetadata, pages } : rootMetadata
}

function compactRootMetadata(
  seo: SeoMetadata | undefined,
  head: LowcodeHeadMetadata | undefined,
  customCss: string | undefined
): HtmlMetadataOptions | undefined {
  const metadata: HtmlMetadataOptions = { ...compactSeoMetadata(seo) }
  const cleanHead = compactLowcodeHeadMetadata(head)
  const cleanCss = customCss?.trim()
  if (cleanHead) metadata.head = cleanHead
  if (cleanCss && validateLowcodeCustomCss(cleanCss).ok) metadata.customCss = cleanCss
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function mergeMetadataOptions(
  persisted: HtmlMetadataOptions | undefined,
  explicit: HtmlMetadataOptions | undefined
): HtmlMetadataOptions | undefined {
  if (!persisted) return explicit
  if (!explicit) return persisted
  const pages = mergeMetadataPages(persisted.pages, explicit.pages)
  const merged: HtmlMetadataOptions = { ...persisted, ...explicit }
  if (pages) merged.pages = pages
  else delete merged.pages
  return merged
}

function mergeMetadataPages(
  persisted: Record<string, SeoMetadata> | undefined,
  explicit: Record<string, SeoMetadata> | undefined
): Record<string, SeoMetadata> | undefined {
  if (!persisted) return explicit
  if (!explicit) return persisted
  const merged: Record<string, SeoMetadata> = { ...persisted }
  for (const [pageId, metadata] of Object.entries(explicit)) {
    merged[pageId] = { ...merged[pageId], ...metadata }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function compactSeoMetadata(value: SeoMetadata | undefined): SeoMetadata | undefined {
  if (!value) return undefined
  const out: SeoMetadata = {}
  for (const key of ['title', 'description', 'image', 'canonicalUrl'] as const) {
    const fieldValue = value[key]
    if (typeof fieldValue === 'string' && fieldValue.trim() !== '') {
      out[key] = fieldValue.trim()
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}
