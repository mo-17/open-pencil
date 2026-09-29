import { parseColor } from '@open-pencil/core/color'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'

export const NOTES_PALETTE = {
  background: '#F4F6F1',
  paper: '#FFFFFF',
  ink: '#243C33',
  muted: '#69776F',
  line: '#DCE4DB',
  accent: '#285C49',
  tint: '#E7EEE2'
} as const

export function notesSurface(
  fill: string = NOTES_PALETTE.paper,
  bordered = false
): Partial<SceneNode> {
  return {
    fills: [{ type: 'SOLID', color: parseColor(fill), opacity: 1, visible: true }],
    strokes: bordered
      ? [
          {
            color: parseColor(NOTES_PALETTE.line),
            weight: 1,
            opacity: 1,
            visible: true,
            align: 'INSIDE'
          }
        ]
      : [],
    cornerRadius: 18
  }
}

export function notesSecondaryButton(): Partial<SceneNode> {
  return {
    ...notesSurface(NOTES_PALETTE.paper, true),
    cornerRadius: 10,
    interactiveProps: { textColor: NOTES_PALETTE.ink }
  }
}

/** Notes keep their own visual language; no application-wide theme is changed. */
export function createNotesPresentation(editor: NotesTemplateEditor) {
  return (
    type: SceneNode['type'],
    name: string,
    parent: string,
    x: number,
    y: number,
    width: number,
    height: number,
    properties: Partial<SceneNode> = {}
  ) => {
    let base: Partial<SceneNode> = {}
    if (type === 'CANVAS') base = notesSurface(NOTES_PALETTE.background)
    if (type === 'FRAME') base = notesSurface(NOTES_PALETTE.paper, true)
    if (type === 'FORM') base = { fills: [] }
    if (type === 'TEXT') base = { ...notesSurface(NOTES_PALETTE.ink), cornerRadius: 0 }
    if (type === 'BUTTON')
      base = {
        ...notesSurface(NOTES_PALETTE.accent),
        cornerRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        interactiveProps: { textColor: NOTES_PALETTE.paper }
      }
    if (['INPUT', 'TEXTAREA', 'CHECKBOX'].includes(type))
      base = {
        ...notesSurface(NOTES_PALETTE.paper, true),
        cornerRadius: 10,
        interactiveProps: { textColor: NOTES_PALETTE.ink }
      }
    return editor.createShape(type, x, y, width, height, parent, name, {
      ...base,
      ...properties,
      interactiveProps: { ...base.interactiveProps, ...properties.interactiveProps }
    })
  }
}
