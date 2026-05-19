import { collectTree } from './ir/collect-tree'
import { selectAdapter } from './select-adapter'
import type { CompilerInput, CompilerOptions, CompilerOutput } from './types'

export type { CompileWarning, CompilerInput, CompilerOptions, CompilerOutput } from './types'

const DEFAULT_OPTIONS: CompilerOptions = {
  packageName: 'openpencil-output',
  target: 'react',
  reactVersion: '19',
  router: 'none',
  typescript: true
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

  const ir = collectTree(input.graph, input.pageIds[0])
  const { files, warnings: adapterWarnings } = adapter.emit(ir, input.options)
  return { files, warnings: [...selectionWarnings, ...adapterWarnings] }
}

export function withDefaults(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
}
