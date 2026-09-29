import { isEqual } from 'es-toolkit'

import { isAutoLayoutMode, type LayoutMode, type SceneNode } from '@open-pencil/scene-graph'

import type { createNodePreviewActions } from './node-preview'
import type { EditorContext } from './types'

export function createLayoutModeActions(
  ctx: EditorContext,
  previews: ReturnType<typeof createNodePreviewActions>
) {
  function setLayoutMode(id: string, mode: LayoutMode) {
    // A panel change supersedes any unfinished numeric edit. Read its baseline
    // only after cancellation has restored the authored geometry.
    previews.cancelNodePreviews()
    const node = ctx.graph.getNode(id)
    if (!node || node.layoutMode === mode) return

    const preview = previews.beginNodePreview(
      isAutoLayoutMode(mode) ? 'Set auto layout' : 'Remove auto layout',
      { preserveSourceMetadata: true }
    )
    const source = structuredClone(node.source)
    source.editedFields = [...new Set([...source.editedFields, 'layoutMode'])]
    preview.update(id, {
      ...layoutModeUpdates(ctx, node, mode),
      source,
      // Imported Hug measurements describe the previous flow. An explicit
      // activation must measure the current flow; undo keeps the original cache.
      ...(isAutoLayoutMode(mode) ? { derivedLayout: null } : {})
    })
    // Capture the full layout delta, including children, Hug ancestors and siblings.
    preview.commit(layoutModeSource)
  }

  return { setLayoutMode }
}

function layoutModeUpdates(
  ctx: EditorContext,
  node: SceneNode,
  mode: LayoutMode
): Partial<SceneNode> {
  const updates: Partial<SceneNode> = { layoutMode: mode }
  // Layout preferences belong to the document, even while freeform is active.
  // Initialize only absent grid axes; switching mode never resets authored values.
  if (mode === 'GRID') {
    const count = ctx.graph.getChildren(node.id).length
    const cols = node.gridTemplateColumns.length || Math.max(2, Math.ceil(Math.sqrt(count)))
    if (node.gridTemplateColumns.length === 0) {
      updates.gridTemplateColumns = Array.from({ length: cols }, () => ({
        sizing: 'FR' as const,
        value: 1
      }))
    }
    if (node.gridTemplateRows.length === 0) {
      updates.gridTemplateRows = Array.from(
        { length: Math.max(1, Math.ceil(count / cols)) },
        () => ({
          sizing: 'FR' as const,
          value: 1
        })
      )
    }
  }
  return updates
}

/** Keep imported metadata consistent with the complete, undoable layout delta. */
function layoutModeSource(
  node: SceneNode,
  before: Readonly<Partial<SceneNode>>
): Partial<SceneNode> {
  const changed = (Object.keys(before) as (keyof SceneNode)[]).filter(
    (key) => key !== 'source' && !isEqual(before[key], node[key])
  )
  const source = structuredClone(node.source)
  source.editedFields = [...new Set([...source.editedFields, ...changed])]
  if (changed.includes('layoutMode') && source.fig.layout) {
    source.fig.layout.stackMode =
      node.layoutMode === 'VERTICAL' || node.layoutMode === 'HORIZONTAL' ? node.layoutMode : 'NONE'
  }
  if (changed.includes('width') || changed.includes('height')) {
    source.fig.rawSize = null
    delete source.fig.rawNodeFields.fillGeometry
    delete source.fig.rawNodeFields.strokeGeometry
    delete source.fig.rawNodeFields.strokeWeight
    // Imported TEXT vectorData can be its authored layout path.
    if (node.type !== 'TEXT') delete source.fig.rawNodeFields.vectorData
  }
  if (changed.some((key) => key === 'x' || key === 'y' || key === 'width' || key === 'height')) {
    source.fig.rawTransform = null
  }
  return { source }
}
