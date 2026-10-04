import type { SceneNode } from '@open-pencil/scene-graph'
import { useI18n, useRetainedActivity, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'

import { useModuleValueSession } from './form/session'

/** All state-binding panels capture the same live owner and immutable write authority. */
export function useModuleBindingContext(accept: (node: SceneNode) => boolean) {
  const editor = useEditorStore()
  const { panels } = useI18n()
  const { selectedNode } = useSelectionState()
  const owner = useSceneComputed(() => {
    const node = selectedNode.value ? editor.graph.getNode(selectedNode.value.id) : undefined
    return node && accept(node) ? node : undefined
  })
  const source = useSceneComputed(() => ({
    bindings: owner.value?.bindings,
    props: owner.value?.interactiveProps,
    states: editor.graph.getNode(editor.state.currentPageId)?.state,
    docStates: editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState
  }))
  const session = useModuleValueSession(
    () => owner.value,
    () => source.value,
    useRetainedActivity()
  )
  return { editor, panels, owner, source, session }
}
