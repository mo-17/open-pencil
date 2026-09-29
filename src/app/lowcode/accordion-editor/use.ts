import type { Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleEditorDraft } from '@/app/lowcode/module-editor/draft'

import {
  accordionEditorValue,
  copyAccordionEditor,
  editAccordionEditor,
  validAccordionEditor,
  type AccordionItemField,
  type AccordionEditorEdit,
  type AccordionEditorCommit
} from './index'

export function useAccordionEditorDraft(
  getOwner: () => SceneNode | undefined,
  getConfig: () => JSONObject,
  commitRequest: (request: AccordionEditorCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  return useModuleEditorDraft(
    getOwner,
    getConfig,
    commitRequest,
    {
      read: accordionEditorValue,
      copy: copyAccordionEditor,
      edit: editAccordionEditor,
      valid: validAccordionEditor,
      inputEdit: (
        index: number,
        field: AccordionItemField,
        value: string
      ): AccordionEditorEdit => ({
        kind: 'update',
        index,
        field,
        value
      })
    },
    active
  )
}
