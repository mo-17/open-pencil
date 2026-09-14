import type { ActionDef, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { backendTemplateShape } from '@/app/lowcode/backend/notes-template-style'

import type { BusinessTemplateEditor } from '../types'

export const BUSINESS_CONTENT_X = 272
export const BUSINESS_CONTENT_WIDTH = 880
export const BUSINESS_PAGE_WIDTH = 1200

export type BusinessRect = Readonly<Rect>

export function createBusinessLayout(editor: BusinessTemplateEditor) {
  const shape = backendTemplateShape(editor)
  const text = (
    parent: string,
    label: string,
    rect: BusinessRect,
    properties: Partial<SceneNode> = {}
  ) =>
    shape('TEXT', label || 'Bound text', parent, rect.x, rect.y, rect.width, rect.height, {
      text: label,
      fontSize: 16,
      ...properties
    })
  const button = (
    parent: string,
    label: string,
    rect: BusinessRect,
    actions: ActionDef[],
    properties: Partial<SceneNode> = {}
  ) =>
    shape('BUTTON', label, parent, rect.x, rect.y, rect.width, rect.height, {
      interactiveProps: { text: label },
      events: { onClick: actions },
      ...properties
    })
  return { shape, text, button }
}

export type BusinessLayout = ReturnType<typeof createBusinessLayout>
