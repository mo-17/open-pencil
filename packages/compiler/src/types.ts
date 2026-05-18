import type { SceneGraph } from '@open-pencil/core/scene-graph'

export interface CompilerInput {
  graph: SceneGraph
  /** Page node IDs to compile. Phase 0 only emits the first entry. */
  pageIds: string[]
  options: CompilerOptions
}

export interface CompilerOptions {
  /** package.json `name` field of the output project */
  packageName: string
  /** React major version to target */
  reactVersion: '18' | '19'
  /** Router strategy. Phase 0 is single-page only (`none`). */
  router: 'react-router-v6' | 'none'
  /** Phase 0 always emits TypeScript */
  typescript: true
}

export interface CompileWarning {
  /** Stable code so callers can suppress / categorize */
  code: string
  message: string
  nodeId?: string
}

export interface CompilerOutput {
  /** Relative path → file content. Text files use string; binary use Uint8Array. */
  files: Map<string, string | Uint8Array>
  warnings: CompileWarning[]
}
