import type { SceneGraph, SeoMetadata } from '@open-pencil/core/scene-graph'

import { buildComponentRegistry } from './ir/collect/components'
import { collectComponents, collectTree } from './ir/collect/tree'
import { selectAdapter } from './select-adapter'
import type { CompilerInput, CompilerOptions, CompilerOutput, HtmlMetadataOptions } from './types'

export type {
  CompileWarning,
  HtmlMetadata,
  HtmlMetadataOptions,
  CompilerInput,
  CompilerOptions,
  CompilerOutput,
  UiKitName
} from './types'
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
 * Compile a SceneGraph page into a runnable project. Phase 0 emits a Vite +
 * React + TS app; Vue is reserved for Phase 5. State, events, and bindings
 * are not yet wired — they land in week 5-6.
 */
export function compile(input: CompilerInput): CompilerOutput {
  if (input.pageIds.length === 0) {
    return {
      files: new Map(),
      warnings: [{ code: 'no-pages', message: 'CompilerInput.pageIds is empty' }]
    }
  }

  const options = withPersistedMetadata(input.graph, input.pageIds, input.options)
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
  const { defs: components, warnings: componentWarnings } = collectComponents(
    input.graph,
    registry,
    i18n,
    styleOptions
  )
  const irs = input.pageIds.map((id) => collectTree(input.graph, id, registry, i18n, styleOptions))
  const { files, warnings: adapterWarnings } = adapter.emit(irs, options, components)
  return {
    files,
    warnings: [
      ...selectionWarnings,
      ...componentWarnings,
      ...irs.flatMap((ir) => ir.warnings),
      ...adapterWarnings
    ]
  }
}

export function withDefaults(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
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
  const rootMetadata = compactSeoMetadata(graph.getNode(graph.rootId)?.lowcodeSeoMetadata)
  const pages: Record<string, SeoMetadata> = {}
  for (const pageId of pageIds) {
    const pageMetadata = compactSeoMetadata(graph.getNode(pageId)?.lowcodeSeoMetadata)
    if (pageMetadata) pages[pageId] = pageMetadata
  }
  if (!rootMetadata && Object.keys(pages).length === 0) return undefined
  return Object.keys(pages).length > 0 ? { ...rootMetadata, pages } : rootMetadata
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
    merged[pageId] = { ...(merged[pageId] ?? {}), ...metadata }
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
