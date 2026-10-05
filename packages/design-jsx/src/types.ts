import type { SceneNode } from '@open-pencil/scene-graph'

import type { TreeNode } from './tree'

export interface RenderOptions {
  x?: number
  y?: number
  parentId?: string
  signal?: AbortSignal
  layout?: boolean
  /** Called for every layer created from an element, so callers can map source to layers. */
  onNode?: (tree: TreeNode, node: SceneNode) => void
}
