import type { Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleEditorDraft } from '@/app/lowcode/module-editor/draft'

import {
  navigationEditorValue,
  editNavigationEditor,
  validNavigationEditor,
  type NavigationEditorCommit,
  type NavigationEditorEdit,
  type NavigationItemField
} from './index'

export function useNavigationEditorDraft(
  getOwner: () => SceneNode | undefined,
  getConfig: () => JSONObject,
  commit: (request: NavigationEditorCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  return useModuleEditorDraft(
    getOwner,
    getConfig,
    commit,
    {
      read: navigationEditorValue,
      copy: (value) => structuredClone(value),
      edit: editNavigationEditor,
      valid: validNavigationEditor,
      inputEdit: (
        index: number,
        field: NavigationItemField,
        value: string
      ): NavigationEditorEdit => ({ kind: 'update', index, field, value })
    },
    active
  )
}
