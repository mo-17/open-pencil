import { copyFills, copyStrokes, type SceneNode } from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'
import { groupTemplateNodes } from './structure'

function contains(surface: SceneNode, child: SceneNode): boolean {
  return (
    child.x >= surface.x &&
    child.y >= surface.y &&
    child.x + child.width <= surface.x + surface.width + 1 &&
    child.y + child.height <= surface.y + surface.height + 1
  )
}

/** Give authored background cards a real content boundary without moving their desktop content. */
export function groupTemplateSurfaces(
  editor: NotesTemplateEditor,
  parentId: string,
  surfaces: readonly string[]
): Map<string, string> {
  const groups = new Map<string, string>()
  const ordered = surfaces
    .map((id) => editor.graph.getNode(id))
    .filter((node): node is SceneNode => node !== undefined)
    .sort((left, right) => left.width * left.height - right.width * right.height)
  for (const surface of ordered) {
    if (surface.parentId !== parentId || surface.childIds.length) continue
    const children = editor.graph
      .getChildren(parentId)
      .filter((child) => child.id !== surface.id && contains(surface, child))
    if (!children.length) continue
    const group = groupTemplateNodes(
      editor,
      parentId,
      [surface.id, ...children.map((child) => child.id)],
      surface.name + ' content'
    )
    editor.updateNodeWithUndo(
      group,
      {
        fills: copyFills(surface.fills),
        strokes: copyStrokes(surface.strokes),
        cornerRadius: surface.cornerRadius,
        ...(surface.renderCondition ? { renderCondition: surface.renderCondition } : {})
      },
      'Keep template card appearance'
    )
    groups.set(surface.id, group)
  }
  return groups
}

const FIELDS = new Set<SceneNode['type']>(['INPUT', 'TEXTAREA', 'SELECT', 'CHECKBOX'])

/** Labels, nullable toggles and controls flow together while remaining inside their original FORM. */
export function groupTemplateFormFields(editor: NotesTemplateEditor, rootId: string): void {
  const visit = (id: string) => {
    const node = editor.graph.getNode(id)
    if (!node) return
    if (node.type === 'FORM') {
      const children = editor.graph.getChildren(id)
      const used = new Set<string>()
      for (const control of children.filter((child) => FIELDS.has(child.type))) {
        const label = children
          .filter(
            (child) =>
              !used.has(child.id) &&
              child.type === 'TEXT' &&
              child.x === control.x &&
              child.y < control.y &&
              control.y - child.y <= 42
          )
          .sort((left, right) => right.y - left.y)
          .at(0)
        if (!label) continue
        const toggles = children.filter(
          (child) =>
            child.type === 'BUTTON' &&
            child.y === label.y &&
            child.x > label.x &&
            child.x + child.width <= control.x + control.width
        )
        const ids = [label.id, ...toggles.map((child) => child.id), control.id]
        ids.forEach((child) => used.add(child))
        groupTemplateNodes(editor, id, ids, control.name + ' field')
      }
    }
    for (const child of editor.graph.getChildren(id)) visit(child.id)
  }
  visit(rootId)
}
