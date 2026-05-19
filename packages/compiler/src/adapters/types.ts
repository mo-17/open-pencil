import type { IRTree } from '../ir/types'
import type { CompileWarning, CompilerOptions } from '../types'

/**
 * Adapter contract. Each target framework (React in Phase 0, Vue/Solid/Svelte
 * in later phases) implements this and registers itself in `select-adapter.ts`.
 *
 * Adapter modules MUST NOT import from `ir/collect/**` or
 * `@open-pencil/core/scene-graph` directly — adapters only consume the IR
 * types from `ir/types.ts`.
 */
export interface FrameworkAdapter {
  /**
   * Emit the full project file map for the given page IRs. A single-entry
   * input keeps the legacy single-`App.tsx` shape; multi-entry input emits
   * a router shell plus per-page modules (Phase 1 §11).
   */
  emit(irs: readonly IRTree[], options: CompilerOptions): AdapterEmission
}

export interface AdapterEmission {
  files: Map<string, string | Uint8Array>
  warnings: CompileWarning[]
}
