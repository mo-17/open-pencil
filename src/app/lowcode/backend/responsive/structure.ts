import type { SceneNode } from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'

function reorder(editor: NotesTemplateEditor, parentId: string, ids: readonly string[]): void {
  ids.forEach((id, index) => editor.graph.insertChildAt(id, parentId, index))
}

/** Reorder existing siblings without changing node identities or their events. */
export function orderTemplateChildren(
  editor: NotesTemplateEditor,
  parentId: string,
  ids: readonly string[]
): void {
  const before = editor.graph.getChildren(parentId).map((node) => node.id)
  if (
    ids.length !== before.length ||
    new Set(ids).size !== before.length ||
    ids.some((id) => !before.includes(id))
  )
    throw new Error('Template order must include every existing child exactly once.')
  if (ids.every((id, index) => id === before[index])) return
  const after = [...ids]
  editor.undo.execute({
    label: 'Order template content',
    forward: () => reorder(editor, parentId, after),
    inverse: () => reorder(editor, parentId, before)
  })
}

/** Wrap siblings in an editable frame while preserving their desktop positions and form ancestry. */
export function groupTemplateNodes(
  editor: NotesTemplateEditor,
  parentId: string,
  childIds: readonly string[],
  name: string
): string {
  if (!childIds.length || new Set(childIds).size !== childIds.length)
    throw new Error('A template group requires distinct sibling nodes.')
  const nodes = childIds.map((id) => {
    const node = editor.graph.getNode(id)
    if (!node || node.parentId !== parentId)
      throw new Error('Template groups cannot cross parent or form boundaries.')
    return node
  })
  const x = Math.min(...nodes.map((node) => node.x))
  const y = Math.min(...nodes.map((node) => node.y))
  const width = Math.max(...nodes.map((node) => node.x + node.width)) - x
  const height = Math.max(...nodes.map((node) => node.y + node.height)) - y
  const positions = nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    source: structuredClone(node.source)
  }))
  const siblings = editor.graph.getChildren(parentId).map((node) => node.id)
  const first = Math.min(...childIds.map((id) => siblings.indexOf(id)))
  const group = editor.createShape('FRAME', x, y, width, height, parentId, name, {
    layoutMode: 'NONE',
    fills: [],
    strokes: [],
    clipsContent: false
  })
  const before = [...siblings, group]
  let groupedSources: { id: string; source: SceneNode['source'] }[] | undefined
  editor.undo.execute({
    label: 'Group template content',
    forward: () => {
      for (const node of positions) editor.graph.reparentNode(node.id, group)
      editor.graph.insertChildAt(group, parentId, first)
      if (groupedSources) {
        editor.graph.preserveSourceMetadataDuring(() => {
          for (const node of groupedSources ?? [])
            editor.graph.updateNode(node.id, { source: structuredClone(node.source) })
        })
      } else {
        groupedSources = nodes.map((node) => ({
          id: node.id,
          source: structuredClone(node.source)
        }))
      }
    },
    inverse: () => {
      for (const node of positions) {
        editor.graph.reparentNode(node.id, parentId)
        // History replay restores authored provenance; it is not a fresh position edit.
        editor.graph.preserveSourceMetadataDuring(() => {
          editor.graph.updateNode(node.id, {
            x: node.x,
            y: node.y,
            source: structuredClone(node.source)
          })
        })
      }
      reorder(editor, parentId, before)
    }
  })
  return group
}
