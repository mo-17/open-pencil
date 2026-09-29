import { isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

export interface ModuleEditorCommit<Value> {
  owner: SceneNode | undefined
  previousModule: unknown
  value: Value
}

export function currentModuleEditorOwner(
  editor: Pick<Editor, 'graph' | 'state'>,
  request: Pick<ModuleEditorCommit<unknown>, 'owner' | 'previousModule'>
): SceneNode | undefined {
  const { owner, previousModule } = request
  if (
    !owner ||
    editor.graph.getNode(owner.id) !== owner ||
    editor.state.selectedIds.size !== 1 ||
    !editor.state.selectedIds.has(owner.id) ||
    !isEqual(owner.interactiveProps?.module, previousModule)
  )
    return undefined
  let ancestor: SceneNode | undefined = owner
  while (ancestor && ancestor.id !== editor.state.currentPageId) {
    if (!ancestor.visible || ancestor.locked || ancestor.internalOnly) return undefined
    ancestor = ancestor.parentId ? editor.graph.getNode(ancestor.parentId) : undefined
  }
  return ancestor ? owner : undefined
}
