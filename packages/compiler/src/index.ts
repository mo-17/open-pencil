import { buildComponentRegistry } from './ir/collect/components'
import { collectComponents, collectTree } from './ir/collect/tree'
import { selectAdapter } from './select-adapter'
import type { CompilerInput, CompilerOptions, CompilerOutput } from './types'

export type { CompileWarning, CompilerInput, CompilerOptions, CompilerOutput, UiKitName } from './types'
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

  const { adapter, warnings: selectionWarnings } = selectAdapter(input.options)
  if (!adapter) {
    return { files: new Map(), warnings: selectionWarnings }
  }

  // Phase 3 §8: extract reusable components (COMPONENT masters with ≥1
  // instance) once, then walk each page with the registry so masters + clean
  // instances emit `<Name />` refs instead of inlining the subtree.
  const registry = buildComponentRegistry(input.graph)
  // Phase 3 §9: i18n externalizes display strings at collect time, so the flag
  // threads into both page walks and component-body walks.
  const i18n = input.options.i18n === true
  const { defs: components, warnings: componentWarnings } = collectComponents(
    input.graph,
    registry,
    i18n
  )
  const irs = input.pageIds.map((id) => collectTree(input.graph, id, registry, i18n))
  const { files, warnings: adapterWarnings } = adapter.emit(irs, input.options, components)
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
