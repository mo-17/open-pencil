import { ref, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleEditorDraft } from '@/app/lowcode/module-editor/draft'

import {
  editTimelineItems,
  timelineItems,
  validTimelineItems,
  type TimelineEdit,
  type TimelineEditorCommit,
  type TimelineTextField
} from './index'

export function useTimelineDraft(
  owner: () => SceneNode | undefined,
  config: () => JSONObject,
  submit: (request: TimelineEditorCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  const generation = ref(0)
  watch(
    () => [owner(), config(), active?.value],
    () => {
      generation.value++
    },
    { flush: 'sync' }
  )
  const draft = useModuleEditorDraft(
    owner,
    config,
    submit,
    {
      read: timelineItems,
      copy: (items) => structuredClone(items),
      edit: editTimelineItems,
      valid: validTimelineItems,
      inputEdit: (index: number, field: TimelineTextField, value: string): TimelineEdit => ({
        kind: 'text',
        index,
        field,
        value
      })
    },
    active
  )
  return { ...draft, generation }
}
