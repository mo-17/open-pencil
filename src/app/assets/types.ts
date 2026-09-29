import type { SceneNode } from '@open-pencil/scene-graph'

export type LocalAsset = {
  id: string
  name: string
  node: SceneNode
  componentId: string | null
  variants: Array<{ name: string; values: string[] }>
  variantCount: number
  hasConflicts: boolean
  sourceLibraryKey: string | null
  description: string
  docsURL: string | null
  libraryId: string | null
  revisionId: string | null
  assetKey: string | null
  libraryName: string | null
  pageId: string
  pageName: string
}
