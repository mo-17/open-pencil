import { parseColor } from '@open-pencil/core/color'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'

export const COMMERCE_PALETTE = {
  background: '#F4F6FA',
  surface: '#FFFFFF',
  text: '#1E2A3C',
  muted: '#68768A',
  border: '#DDE4ED',
  primary: '#274C8F',
  tint: '#EAF0FA'
} as const

export function commerceSurface(
  fill: string = COMMERCE_PALETTE.surface,
  border = false
): Partial<SceneNode> {
  return {
    fills: [{ type: 'SOLID', color: parseColor(fill), opacity: 1, visible: true }],
    strokes: border
      ? [
          {
            color: parseColor(COMMERCE_PALETTE.border),
            weight: 1,
            opacity: 1,
            visible: true,
            align: 'INSIDE'
          }
        ]
      : [],
    cornerRadius: 16
  }
}

export function commerceSecondaryButton(active = false): Partial<SceneNode> {
  return {
    ...commerceSurface(active ? COMMERCE_PALETTE.tint : COMMERCE_PALETTE.surface, true),
    cornerRadius: 10,
    interactiveProps: { textColor: active ? COMMERCE_PALETTE.primary : COMMERCE_PALETTE.text }
  }
}

/** Every visual is a normal scene property and can be edited independently. */
export function createCommercePresentation(editor: NotesTemplateEditor) {
  return (
    type: SceneNode['type'],
    name: string,
    parent: string,
    x: number,
    y: number,
    width: number,
    height: number,
    props: Partial<SceneNode> = {}
  ) => {
    let base: Partial<SceneNode> = {}
    if (type === 'CANVAS') base = commerceSurface(COMMERCE_PALETTE.background)
    if (type === 'FRAME') base = commerceSurface(COMMERCE_PALETTE.surface, true)
    if (type === 'FORM') base = { fills: [] }
    if (type === 'TEXT') base = { ...commerceSurface(COMMERCE_PALETTE.text), cornerRadius: 0 }
    if (type === 'BUTTON')
      base = {
        ...commerceSurface(COMMERCE_PALETTE.primary),
        cornerRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        interactiveProps: { textColor: COMMERCE_PALETTE.surface }
      }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(type))
      base = {
        ...commerceSurface(COMMERCE_PALETTE.surface, true),
        cornerRadius: 10,
        interactiveProps: { textColor: COMMERCE_PALETTE.text }
      }
    return editor.createShape(type, x, y, width, height, parent, name, {
      ...base,
      ...props,
      interactiveProps: { ...base.interactiveProps, ...props.interactiveProps }
    })
  }
}
