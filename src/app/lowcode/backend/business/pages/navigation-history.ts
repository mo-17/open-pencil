import type { SceneNode } from '@open-pencil/scene-graph'

import type { BusinessTemplateEditor } from '../types'

/** Keep source provenance exact around the editor's normal geometry/plugin-data undo. */
export function updateBusinessNavigationNode(
  editor: BusinessTemplateEditor,
  id: string,
  changes: Pick<Partial<SceneNode>, 'height' | 'pluginData'>,
  label: string
): void {
  const node = editor.graph.getNode(id)
  if (!node) throw new Error('The existing navigation node is unavailable.')
  const before = structuredClone(node.source)
  const restore = (source: SceneNode['source']) => {
    editor.graph.preserveSourceMetadataDuring(() => {
      editor.graph.updateNode(id, { source: structuredClone(source) })
    })
  }
  // Source metadata is mutated indirectly by graph updates. Restore it after the
  // normal inverse, and after the normal forward, without suppressing real edits.
  editor.undo.push({ label, forward: () => undefined, inverse: () => restore(before) })
  editor.updateNodeWithUndo(id, changes, label)
  const after = structuredClone(node.source)
  editor.undo.push({ label, forward: () => restore(after), inverse: () => undefined })
}
