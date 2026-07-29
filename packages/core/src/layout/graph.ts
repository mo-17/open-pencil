import type { SceneNode } from '@open-pencil/scene-graph'

/** Minimal mutable graph surface required by Yoga layout computation. */
export interface LayoutGraph {
  getNode(id: string): SceneNode | undefined
  getChildren(id: string): SceneNode[]
  updateNode(id: string, changes: Partial<SceneNode>): void
}
