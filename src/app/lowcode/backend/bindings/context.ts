import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'

import { readBackendProviderDocumentRequest } from '../document'

export function readBackendBindingApplication(
  graph: SceneGraph
): BackendApplicationSpecV1 | undefined {
  try {
    const request = readBackendProviderDocumentRequest(graph)
    return request?.application.httpApi?.browserClient ? request.application : undefined
  } catch {
    return undefined
  }
}

export function useBackendBindingApplication() {
  const editor = useEditorStore()
  return useSceneComputed(() => readBackendBindingApplication(editor.graph))
}
