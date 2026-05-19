import { reactAdapter } from './adapters/react'
import type { FrameworkAdapter } from './adapters/types'
import type { CompileWarning, CompilerOptions } from './types'

export interface AdapterSelection {
  /** Resolved adapter, or null when the target is not implemented. */
  adapter: FrameworkAdapter | null
  /** Warnings to surface to the caller (e.g. unsupported target). */
  warnings: CompileWarning[]
}

/**
 * Pick a framework adapter for the requested target. Vue is reserved for
 * Phase 5 — accepting it at the type level but rejecting at runtime is the
 * "keep the architecture seam open without shipping it" contract from
 * docs/lowcode-phase-0.md §4.2.
 */
export function selectAdapter(options: CompilerOptions): AdapterSelection {
  if (options.target === 'react') {
    return { adapter: reactAdapter, warnings: [] }
  }
  // target === 'vue' — the only other value the type allows. Vue support is
  // a Phase 5 deliverable; we reject at runtime so callers see a warning
  // instead of a silently empty project.
  return {
    adapter: null,
    warnings: [
      {
        code: 'target-not-implemented',
        message: "target 'vue' is reserved for Phase 5; only 'react' is implemented in Phase 0"
      }
    ]
  }
}
