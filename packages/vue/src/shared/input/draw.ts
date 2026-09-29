import { DEFAULT_TEXT_HEIGHT, DEFAULT_TEXT_WIDTH } from '@open-pencil/core/constants'
import type { Editor } from '@open-pencil/core/editor'
import { createSceneGeometry } from '@open-pencil/core/geometry'
import {
  createMapModuleFrameOverrides,
  MAP_MODULE_DEFAULT_SIZE,
  resolveMapModule
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import { TOOL_TO_NODE } from '#vue/shared/input/types'
import type { DragDraw, DragState } from '#vue/shared/input/types'

export function startTextDraw(
  cx: number,
  cy: number,
  editor: Editor,
  setDrag: (d: DragState) => void
) {
  if (!editor.getContentEditInsertionParent()) return
  editor.undo.beginBatch('Create text')
  const nodeId = editor.createShape('TEXT', cx, cy, 0, 0)
  editor.graph.updateNode(nodeId, { text: '' })
  editor.select([nodeId])
  setDrag(createDraw(editor, nodeId, cx, cy))
}

export function startShapeDraw(
  cx: number,
  cy: number,
  editor: Editor,
  setDrag: (d: DragState) => void
) {
  if (!editor.getContentEditInsertionParent()) return
  const nodeType = TOOL_TO_NODE[editor.state.activeTool]
  if (!nodeType) return

  editor.undo.beginBatch('Create shape')
  let initialOverrides: Partial<SceneNode> | undefined
  let name: string | undefined
  if (editor.state.activeTool === 'MAP') {
    initialOverrides = { ...createMapModuleFrameOverrides() }
    name = initialOverrides.name
    delete initialOverrides.x
    delete initialOverrides.y
    delete initialOverrides.width
    delete initialOverrides.height
    delete initialOverrides.name
  }
  const nodeId = editor.createShape(nodeType, cx, cy, 0, 0, undefined, name, initialOverrides)
  editor.select([nodeId])
  setDrag(createDraw(editor, nodeId, cx, cy))
}

export function handleDrawMove(d: DragDraw, cx: number, cy: number, shiftKey: boolean) {
  if (d.toLocal) ({ x: cx, y: cy } = d.toLocal(cx, cy))
  let w = cx - d.startX
  let h = cy - d.startY

  if (shiftKey) {
    const size = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w) * size
    h = Math.sign(h) * size
  }

  d.update({
    x: w < 0 ? d.startX + w : d.startX,
    y: h < 0 ? d.startY + h : d.startY,
    width: Math.abs(w),
    height: Math.abs(h)
  })
}

function finalDrawDimensions(node: SceneNode | undefined): Partial<SceneNode> | null {
  if (node?.type === 'TEXT') {
    const isPointText = node.width < 2 && node.height < 2
    return {
      width: isPointText ? DEFAULT_TEXT_WIDTH : node.width,
      height: isPointText ? DEFAULT_TEXT_HEIGHT : node.height,
      textAutoResize: isPointText ? 'WIDTH_AND_HEIGHT' : 'NONE'
    }
  }
  if (!node || node.width >= 2 || node.height >= 2) return null
  const map = resolveMapModule(node.interactiveProps?.module)
  return map?.ok
    ? { width: MAP_MODULE_DEFAULT_SIZE.width, height: MAP_MODULE_DEFAULT_SIZE.height }
    : { width: 100, height: 100 }
}

function createDraw(editor: Editor, nodeId: string, startX: number, startY: number): DragDraw {
  const graph = editor.graph
  const parentId = editor.state.contentEdit ? graph.getNode(nodeId)?.parentId : undefined
  const parent = parentId ? graph.getNode(parentId) : undefined
  const geometry = createSceneGeometry(graph)
  const toLocal = parent
    ? (x: number, y: number) => geometry.toLocal(parent, { x, y }) ?? { x, y }
    : undefined
  if (toLocal) ({ x: startX, y: startY } = toLocal(startX, startY))
  const preview = editor.beginNodePreview('Draw dimensions')
  let finished = false

  function cancel() {
    if (finished) return
    finished = true
    preview.cancel()
    // Never replay an old document's creation undo against a replacement graph.
    if (editor.graph === graph) editor.undo.rollbackBatch()
  }

  function commit() {
    if (finished) return
    if (preview.closed || editor.graph !== graph) {
      cancel()
      return
    }
    finished = true
    const node = graph.getNode(nodeId)
    try {
      const dimensions = finalDrawDimensions(node)
      if (dimensions) preview.update(nodeId, dimensions)
      preview.commit()
      if (node?.type === 'SECTION') editor.adoptNodesIntoSection(node.id)
      editor.undo.commitBatch()
    } catch (error) {
      preview.cancel()
      editor.undo.rollbackBatch()
      throw error
    }
    editor.setTool('SELECT')
    if (node?.type === 'TEXT') editor.startTextEditing(node.id)
  }

  // Creation itself is already an edit: avoid rebuilding the backing on the first held frame.
  try {
    preview.update(nodeId, { x: startX, y: startY })
  } catch (error) {
    cancel()
    throw error
  }

  return {
    type: 'draw',
    toLocal,
    startX,
    startY,
    nodeId,
    update: (changes) => {
      if (!finished) preview.update(nodeId, changes)
    },
    commit,
    cancel
  }
}
