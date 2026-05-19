import type { IRTree } from '../ir/types'
import type { CompileWarning, CompilerOptions } from '../types'

/**
 * Adapter contract. Each target framework (React in Phase 0, Vue/Solid/Svelte
 * in later phases) implements this and registers itself in `select-adapter.ts`.
 *
 * Adapter modules MUST NOT import from `ir/collect-tree.ts` or
 * `@open-pencil/core/scene-graph` directly — adapters only consume the IR
 * types from `ir/types.ts`.
 */
export interface FrameworkAdapter {
  /** Emit the full project file map for one page IR. */
  emit(ir: IRTree, options: CompilerOptions): AdapterEmission
}

export interface AdapterEmission {
  files: Map<string, string | Uint8Array>
  warnings: CompileWarning[]
}
