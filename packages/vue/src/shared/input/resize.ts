export { constrainToAspectRatio } from '#vue/shared/input/resize/rect'
export { tryStartResize } from '#vue/shared/input/resize/start'
import { toRaw } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import { calibratePathTextLayout, reflowPathTextGlyphs } from '@open-pencil/core/text'
import type { SceneNode } from '@open-pencil/scene-graph'
import { copyStrokes } from '@open-pencil/scene-graph/copy'
import {
  computeConstrainedResizeChanges,
  scaledGeometryChanges,
  type ResizeSnapshot
} from '@open-pencil/scene-graph/resize'

import { calculateResizeRect } from '#vue/shared/input/resize/rect'
import { limitResizeRect, resizeSizingPatch } from '#vue/shared/input/resize/sizing'
import { applyResizeSnap } from '#vue/shared/input/resize/snap'
import { resizedSource } from '#vue/shared/input/resize/source'
import { optionalEditorState } from '#vue/shared/input/snap'
import type { DragResize } from '#vue/shared/input/types'

/**
 * Resize path-text glyphs without baking anisotropic scale into fontSize.
 * commandsBlob stays in font units; paint multiplies by fontSize then scaleX/Y.
 * Accumulating scaleX/Y (not fontSize *= avg) keeps non-uniform stretch correct
 * under rotation — see drawDerivedText transform order.
 */
/**
 * Figma resize semantics for imported text-on-path: constant font size,
 * glyphs re-placed along the scaled path (see core/text/path). Used
 * instead of geometric glyph/silhouette scaling whenever the node still has
 * its layout path. Baked node-level silhouettes cannot follow re-placed
 * glyphs, so strokeGeometry is cleared — the renderer rebuilds silhouettes
 * per glyph — and stroke weight stays constant like the font size.
 */
function reflowedPathTextChanges(
  orig: Pick<ResizeSnapshot, 'textPathData' | 'textPathBox' | 'derivedTextGlyphs' | 'strokes'>,
  sx: number,
  sy: number
): Partial<SceneNode> | null {
  if (!orig.textPathData || !orig.textPathBox || !orig.derivedTextGlyphs?.length) return null
  const data = orig.textPathData
  const layout = calibratePathTextLayout(orig.derivedTextGlyphs, data, orig.textPathBox)
  if (!layout) return null
  const box = {
    x: orig.textPathBox.x * sx,
    y: orig.textPathBox.y * sy,
    width: orig.textPathBox.width * sx,
    height: orig.textPathBox.height * sy
  }
  const glyphs = reflowPathTextGlyphs(orig.derivedTextGlyphs, data, layout, box)
  if (!glyphs) return null
  return {
    derivedTextGlyphs: glyphs,
    textPathBox: box,
    strokeGeometry: [],
    strokes: copyStrokes(orig.strokes)
  }
}

function resizeChanges(
  d: DragResize,
  cx: number,
  cy: number,
  constrain: boolean,
  editor: Editor,
  disableSnapping: boolean
) {
  const { origRect } = d
  const calculatedRect = calculateResizeRect(
    d.handle,
    origRect,
    cx - d.startX,
    cy - d.startY,
    constrain
  )
  const requestedRect =
    constrain ||
    (calculatedRect.width === origRect.width && calculatedRect.height === origRect.height)
      ? calculatedRect
      : applyResizeSnap(d, calculatedRect, editor, disableSnapping)
  const node = editor.graph.getNode(d.nodeId)
  const newRect = node ? limitResizeRect(d, node, requestedRect, constrain) : requestedRect

  const changes: Partial<SceneNode> = {
    ...newRect,
    ...scaledGeometryChanges(
      {
        vectorNetwork: d.origVectorNetwork,
        fillGeometry: d.origFillGeometry,
        strokeGeometry: d.origStrokeGeometry,
        derivedTextGlyphs: d.origDerivedTextGlyphs,
        strokes: d.origStrokes,
        textPathData: d.origTextPathData,
        textPathBox: d.origTextPathBox
      },
      origRect.width,
      origRect.height,
      newRect.width,
      newRect.height
    )
  }
  return { changes, newRect }
}

/**
 * Re-apply the root resize to descendants through the constraint engine, then
 * layer path-text reflow on top: constrained children get their own before/after
 * box, and path text must re-place glyphs along its path rather than scale as a
 * blob (see reflowedPathTextChanges).
 */
function applyConstrainedChildren(
  d: DragResize,
  newRect: Pick<SceneNode, 'width' | 'height'>,
  editor: Editor
) {
  if (!d.origChildren || d.origRect.width <= 0 || d.origRect.height <= 0) return
  const changes = computeConstrainedResizeChanges(
    editor.graph,
    d.nodeId,
    d.origRect,
    newRect,
    d.origChildren
  )
  for (const [childId, childChanges] of changes) {
    const orig = d.origChildren.get(childId)
    if (orig && orig.width > 0 && orig.height > 0) {
      const width = childChanges.width ?? orig.width
      const height = childChanges.height ?? orig.height
      const reflow = reflowedPathTextChanges(orig, width / orig.width, height / orig.height)
      if (reflow) Object.assign(childChanges, reflow)
    }
    d.preview?.update(childId, childChanges, { deferLayout: true })
    editor.renderer?.invalidateVectorPath(childId)
  }
}

function applyRootPathReflow(
  d: DragResize,
  newRect: Pick<SceneNode, 'width' | 'height'>,
  changes: Partial<SceneNode>
) {
  if (d.origRect.width <= 0 || d.origRect.height <= 0) return
  const reflow = reflowedPathTextChanges(
    {
      textPathData: d.origTextPathData,
      textPathBox: d.origTextPathBox,
      derivedTextGlyphs: d.origDerivedTextGlyphs,
      strokes: d.origStrokes
    },
    newRect.width / d.origRect.width,
    newRect.height / d.origRect.height
  )
  if (reflow) Object.assign(changes, reflow)
}

export function applyResize(
  dragState: DragResize,
  cx: number,
  cy: number,
  constrain: boolean,
  editor: Editor,
  disableSnapping = false
) {
  // Drag state lives in Vue-reactive input state; nested arrays read through
  // it are reactive proxies. Writing those into the graph poisons it for
  // structuredClone consumers (export subgraph clone, undo snapshots) with
  // DataCloneError. Unwrap once — also keeps the drag hot path off proxies.
  const d = toRaw(dragState)
  if (d.preview?.closed) return
  const node = editor.graph.getNode(d.nodeId)
  if (!node) return
  // A click on a handle must not detach sizing or create an undo entry.
  d.preview ??= editor.beginNodePreview('Resize', { preserveSourceMetadata: true })
  const { changes, newRect } = resizeChanges(d, cx, cy, constrain, editor, disableSnapping)
  if (
    !d.resizeStarted &&
    (['x', 'y', 'width', 'height'] as const).every((key) => newRect[key] === d.origRect[key])
  )
    return
  d.resizeStarted = true
  d.appliedRect = { ...newRect }
  applyRootPathReflow(d, newRect, changes)
  const parent = node.parentId ? (editor.graph.getNode(node.parentId) ?? null) : null
  Object.assign(changes, resizeSizingPatch(d, node, parent, newRect))
  // Paragraph text retains its untouched auto-height; geometric/path resizes
  // are laid out after their constrained descendants have received the patch.
  d.preview.update(d.nodeId, changes, { deferLayout: node.type !== 'TEXT' || !!node.textPathData })
  if (changes.fillGeometry || changes.strokeGeometry || changes.vectorNetwork) {
    editor.renderer?.invalidateVectorPath(d.nodeId)
  }

  // Both passes include parents and ancestors, exactly as ordinary node edits
  // do. The same transaction captures every resulting sibling/ancestor change.
  for (let pass = 0; pass < 2; pass++) {
    applyConstrainedChildren(d, node, editor)
    d.preview.update(d.nodeId, {})
  }
  d.appliedRect = { x: node.x, y: node.y, width: node.width, height: node.height }
  editor.requestRepaint()
}

export function commitResizePreview(dragState: DragResize, editor: Editor) {
  const d = toRaw(dragState)
  optionalEditorState(editor)?.snapGuides.splice(0)
  if (!d.preview || d.preview.closed) return
  // Finalize every actual geometry change, including layout ancestors and
  // siblings. Metadata joins the same undo entry and keeps its layout provenance.
  d.preview.commit((node, before) => {
    const moved = (['x', 'y', 'width', 'height'] as const).some(
      (key) => before[key] !== undefined && before[key] !== node[key]
    )
    if (!moved) return undefined
    return {
      source: resizedSource(node, before, node.id === d.nodeId ? d.originalSizing : undefined)
    }
  })
}

export function cancelResizePreview(dragState: DragResize) {
  toRaw(dragState).preview?.cancel()
}
