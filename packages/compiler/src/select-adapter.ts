import { expoAdapter } from './adapters/expo'
import { flutterAdapter } from './adapters/flutter'
import { reactAdapter } from './adapters/react'
import type { FrameworkAdapter } from './adapters/types'
import { vueAdapter } from './adapters/vue'
import type { CompileWarning, CompilerOptions } from './types'

export interface AdapterSelection {
  /** Resolved adapter, or null when the target is not implemented. */
  adapter: FrameworkAdapter | null
  /** Warnings to surface to the caller (e.g. unsupported target). */
  warnings: CompileWarning[]
}

/**
 * Pick an adapter for the requested target. Reserved targets remain accepted
 * at the type level but fail closed at runtime, keeping the adapter seam open
 * without emitting a misleading partial project.
 */
export function selectAdapter(options: CompilerOptions): AdapterSelection {
  const target: unknown = options.target
  switch (target) {
    case 'react':
      return { adapter: reactAdapter, warnings: [] }
    case 'vue':
      return { adapter: vueAdapter, warnings: [] }
    case 'expo':
      return { adapter: expoAdapter, warnings: [] }
    case 'flutter':
      return { adapter: flutterAdapter, warnings: [] }
  }
  // Reserved targets reject at runtime so callers get an explicit diagnostic
  // instead of a silently empty or partially generated project.
  return {
    adapter: null,
    warnings: [
      {
        code: 'target-not-implemented',
        message: `target '${String(target)}' is not implemented; supported targets are 'react', 'vue', 'expo', and 'flutter'`
      }
    ]
  }
}
