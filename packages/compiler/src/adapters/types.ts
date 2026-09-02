import type { ComponentDef, IRTree } from '../ir/types'
import type { CompileWarning, CompilerOptions } from '../types'

/**
 * Adapter contract. Each implemented output target registers itself in
 * `select-adapter.ts`; reserved targets fail closed until an adapter exists.
 *
 * Adapter modules MUST NOT import from `ir/collect/**` or
 * `@open-pencil/scene-graph` directly — adapters only consume the IR
 * types from `ir/types.ts`.
 */
export interface FrameworkAdapter {
  /**
   * Emit the full project file map for the given page IRs. A single-entry
   * input keeps the legacy single-`App.tsx` shape; multi-entry input emits
   * a router shell plus per-page modules (Phase 1 §11).
   *
   * `components` (Phase 3 §8) are the reusable component definitions referenced
   * by `IRComponentRef` nodes; the adapter emits one file per referenced one
   * and wires the page imports. Defaults to empty for callers that pre-date §8.
   */
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components?: readonly ComponentDef[]
  ): AdapterEmission
}

export interface AdapterEmission {
  files: Map<string, string | Uint8Array>
  warnings: CompileWarning[]
  /** Explicit adapter-owned server workflow sources, excluding browser clients. */
  executableServerWorkflowFiles?: readonly string[]
}
