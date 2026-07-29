import type { MotionSpec } from '@open-pencil/scene-graph'

/** Shared node-local Motion resolution result used by scene and continuous-input runtimes. */
export interface MotionResolvedTarget {
  readonly nodeId: string
  readonly motion?: MotionSpec
}
