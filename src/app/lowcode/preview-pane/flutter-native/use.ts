import type { Ref } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'

import type { PreviewRefreshPolicy } from '../compile-scheduler'
import { createFlutterNativePreview } from './controller'

export function useFlutterNativePreview(policy: Ref<PreviewRefreshPolicy>) {
  const store = useEditorStore()
  return createFlutterNativePreview(policy, {
    get graph() {
      return store.graph
    },
    get sceneVersion() {
      return store.state.sceneVersion
    },
    get currentPageId() {
      return store.state.currentPageId
    },
    getSaveStatus: () => store.getSaveStatus()
  })
}
