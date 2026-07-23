import { type ComputedRef, type InjectionKey, type Ref, inject, provide } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { LayoutMode } from '@open-pencil/scene-graph'

export interface LayerNode {
  id: string
  name: string
  type: string
  // Phase 2 §6 — tightened from `string` to `LayoutMode` so consumers using
  // `nodeIcon()` (and any other `isAutoLayoutMode`-based dispatch) type-check
  // against the FREE variant. Population sites already feed real LayoutMode
  // values from `SceneNode.layoutMode`.
  layoutMode: LayoutMode
  visible: boolean
  locked: boolean
  children?: LayerNode[]
}

export interface LayerRow {
  node: LayerNode
  level: number
  hasChildren: boolean
}

export interface LayerSelectionMode {
  additive: boolean
  range: boolean
}

export interface LayerTreeVirtualizer {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'center' | 'end' | 'start' }) => void
}

export interface LayerDragInstruction {
  // `reparent` only fires in `last-in-group` mode and only when the cursor is
  // in the indent gutter to the left of the row icon — useLayerDrag currently
  // treats it as a no-op so the user can keep using on-row drops for their
  // intended level. A future pass can map it to a parent-level reorder.
  type: 'reorder-above' | 'reorder-below' | 'make-child' | 'reparent'
}

export interface LayerTreeContext {
  editor: Editor
  items: Ref<LayerNode[]>
  expanded: Ref<string[]>
  visibleRows: ComputedRef<LayerRow[]>
  treeVersion: Ref<number>
  selectedIds: ComputedRef<Set<string>>
  focused: Ref<boolean>
  indentPerLevel: number
  draggingId: Ref<string | null>
  instruction: Ref<LayerDragInstruction | null>
  instructionTargetId: Ref<string | null>
  setupDrag: (
    el: Ref<HTMLElement | null>,
    item: () => { id: string; level: number; hasChildren: boolean; parentId: string | null }
  ) => void
  select: (id: string, selection: boolean | LayerSelectionMode) => void
  toggleExpand: (id: string) => void
  setFocused: (focused: boolean) => void
  setVirtualizer: (virtualizer: LayerTreeVirtualizer) => void
  toggleVisibility: (id: string) => void
  toggleLock: (id: string) => void
  rename: (id: string, name: string) => void
  setRowRef: (id: string, el: HTMLElement | null) => void
}

export const LAYER_TREE_KEY: InjectionKey<LayerTreeContext> = Symbol('layer-tree')

export function provideLayerTree(ctx: LayerTreeContext) {
  provide(LAYER_TREE_KEY, ctx)
}

export function useLayerTree(): LayerTreeContext {
  const ctx = inject(LAYER_TREE_KEY)
  if (!ctx) throw new Error('[open-pencil] useLayerTree() called outside <LayerTreeRoot>')
  return ctx
}
