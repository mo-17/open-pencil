import type { Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleEditorDraft } from '@/app/lowcode/module-editor/draft'

import {
  carouselSlidesValue,
  copyCarouselSlides,
  editCarouselSlides,
  validCarouselSlides,
  type CarouselSlideField,
  type CarouselSlidesEdit,
  type CarouselSlidesCommit
} from './index'

export function useCarouselSlidesDraft(
  getOwner: () => SceneNode | undefined,
  getConfig: () => JSONObject,
  commitRequest: (request: CarouselSlidesCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  return useModuleEditorDraft(
    getOwner,
    getConfig,
    commitRequest,
    {
      read: carouselSlidesValue,
      copy: copyCarouselSlides,
      edit: editCarouselSlides,
      valid: validCarouselSlides,
      inputEdit: (index: number, field: CarouselSlideField, value: string): CarouselSlidesEdit => ({
        kind: 'update',
        index,
        field,
        value
      })
    },
    active
  )
}
