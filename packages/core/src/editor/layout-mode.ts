import { isEqual, uniq } from 'es-toolkit'

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
    source.editedFields = uniq([...source.editedFields, 'layoutMode'])
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

  /**
   * Takes layers out of their parent's auto layout or puts them back, as Figma's Ignore auto
   * layout toggle does. A layer taken out stays where it is and keeps its sizing, which applies
   * again when it returns; its siblings close the gap in the same undo step.
   */
  function setLayoutPositioning(ids: string[], positioning: SceneNode['layoutPositioning']) {
    // Read every place first: taking one layer out moves the siblings after it.
    const targets = ids.flatMap((id) => {
      const node = ctx.graph.getNode(id)
      const parent = node?.parentId ? ctx.graph.getNode(node.parentId) : undefined
      if (!node || !parent || !isAutoLayoutMode(parent.layoutMode)) return []
      if (node.layoutPositioning === positioning) return []
      return [{ id, x: node.x, y: node.y }]
    })
    if (targets.length === 0) return
    const preview = previews.beginNodePreview(
      positioning === 'ABSOLUTE' ? 'Ignore auto layout' : 'Use auto layout'
    )
    for (const { id, x, y } of targets) {
      preview.update(
        id,
        positioning === 'ABSOLUTE'
          ? { layoutPositioning: positioning, x, y }
          : { layoutPositioning: positioning }
      )
    }
    preview.commit()
  }

  return { setLayoutMode, setLayoutPositioning }
}

function layoutModeUpdates(
  ctx: EditorContext,
  node: SceneNode,
  mode: LayoutMode
): Partial<SceneNode> {
  const updates: Partial<SceneNode> = { layoutMode: mode }
  // A freshly imported freeform frame has no remembered flow sizing: its first flow hugs
  // its children. Authored fork preferences, including dormant axes, keep their sizing.
  if (
    node.source.format === 'fig' &&
    node.source.fig.layout === null &&
    !isAutoLayoutMode(node.layoutMode) &&
    (mode === 'HORIZONTAL' || mode === 'VERTICAL')
  ) {
    updates.primaryAxisSizing = 'HUG'
    updates.counterAxisSizing = 'HUG'
  }

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
  source.editedFields = uniq([...source.editedFields, ...changed])
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
