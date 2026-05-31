import {
  attachInstruction,
  extractInstruction,
  type ItemMode
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { onScopeDispose, ref, watchEffect, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'

import type { LayerDragInstruction } from '#vue/primitives/LayerTree/context'

interface DragItem {
  id: string
  level: number
  hasChildren: boolean
  parentId: string | null
}

type TreeInstruction = LayerDragInstruction

function pickItemMode(isContainer: boolean, isLastSibling: boolean): ItemMode {
  if (!isContainer) return 'standard'
  return isLastSibling ? 'last-in-group' : 'expanded'
}

export function useLayerDrag(
  editor: Editor,
  indentPerLevel = 16,
  onMakeChildDrop?: (targetId: string) => void
) {
  const draggingId = ref<string | null>(null)
  const instruction = ref<TreeInstruction | null>(null)
  const instructionTargetId = ref<string | null>(null)

  function setupItem(el: Ref<HTMLElement | null>, item: () => DragItem) {
    watchEffect((onCleanup) => {
      const element = el.value
      if (!element) return

      const data = item()

      const isContainer = editor.graph.isContainer(data.id)
      // Atlaskit's tree-item modes:
      //   standard      → top¼ above, mid½ make-child, bottom¼ below
      //   expanded      → top¼ above, rest make-child  (no reorder-below!)
      //   last-in-group → standard hitbox + reparent zone in the indent gutter
      //
      // An expanded container that's the LAST sibling at its level has no way
      // to drop a node BELOW it (the bottom is always make-child), trapping
      // anything dragged past it. `last-in-group` restores reorder-below for
      // these tail-position containers. Leaves stay on `standard`; containers
      // that aren't last stay on `expanded` so their middle band still grabs
      // make-child.
      const owningNode = editor.graph.getNode(data.id)
      const parentId = owningNode?.parentId ?? editor.state.currentPageId
      const parent = editor.graph.getNode(parentId)
      const isLastSibling = parent
        ? parent.childIds[parent.childIds.length - 1] === data.id
        : false
      const mode: ItemMode = pickItemMode(isContainer, isLastSibling)

      const cleanup = combine(
        draggable({
          element,
          getInitialData: () => ({ id: data.id }),
          onDragStart: () => {
            draggingId.value = data.id
          },
          onDrop: () => {
            draggingId.value = null
          }
        }),
        dropTargetForElements({
          element,
          getData: ({ input, element: el }) =>
            attachInstruction(
              { id: data.id },
              {
                input,
                element: el,
                indentPerLevel,
                currentLevel: data.level,
                mode,
                block: isContainer ? ['reparent'] : ['make-child', 'reparent']
              }
            ),
          canDrop: ({ source }) => source.data.id !== data.id,
          onDrag: ({ self }) => {
            const inst = extractInstruction(self.data)
            if (!inst || inst.type === 'instruction-blocked') {
              instruction.value = null
              instructionTargetId.value = null
              return
            }
            instruction.value = inst as TreeInstruction
            instructionTargetId.value = data.id
          },
          onDragLeave: () => {
            instruction.value = null
            instructionTargetId.value = null
          },
          onDrop: () => {
            instruction.value = null
            instructionTargetId.value = null
          },
          getIsSticky: () => true
        })
      )

      onCleanup(cleanup)
    })
  }

  const cleanupMonitor = monitorForElements({
    onDrop: ({ source, location }) => {
      const target = location.current.dropTargets.at(0)
      if (!target) return

      const sourceId = source.data.id as string
      const targetId = target.data.id as string
      const rawInstruction = extractInstruction(target.data)
      if (!rawInstruction || rawInstruction.type === 'instruction-blocked') return
      const inst = rawInstruction as TreeInstruction
      if (!sourceId || !targetId) return

      if (editor.graph.isDescendant(targetId, sourceId)) return

      const targetNode = editor.graph.getNode(targetId)
      if (!targetNode) return
      const targetParentId = targetNode.parentId ?? editor.state.currentPageId
      const targetParent = editor.graph.getNode(targetParentId)
      if (!targetParent) return
      const targetIndex = targetParent.childIds.indexOf(targetId)

      if (inst.type === 'reorder-above') {
        editor.reorderChildWithUndo(sourceId, targetParentId, targetIndex)
      } else if (inst.type === 'reorder-below') {
        editor.reorderChildWithUndo(sourceId, targetParentId, targetIndex + 1)
      } else if (inst.type === 'make-child') {
        const container = editor.graph.getNode(targetId)
        if (!container || !editor.graph.isContainer(targetId)) return
        editor.reorderChildWithUndo(sourceId, targetId, container.childIds.length)
        onMakeChildDrop?.(targetId)
      }
      // `reparent` (indent-gutter drop): no-op for now. Falling through to
      // make-child would silently drop the source INTO `targetId`, which is
      // the opposite of what the user is asking for when they drag past a
      // last-in-group container.

      draggingId.value = null
      instruction.value = null
      instructionTargetId.value = null
    }
  })
  onScopeDispose(cleanupMonitor)

  return {
    draggingId,
    instruction,
    instructionTargetId,
    setupItem
  }
}
