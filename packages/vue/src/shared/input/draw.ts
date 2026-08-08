import { DEFAULT_TEXT_HEIGHT, DEFAULT_TEXT_WIDTH } from '@open-pencil/core/constants'
import type { Editor } from '@open-pencil/core/editor'
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
  editor.undo.beginBatch('Create text')
  const nodeId = editor.createShape('TEXT', cx, cy, 0, 0)
  editor.graph.updateNode(nodeId, { text: '' })
  editor.select([nodeId])
  setDrag({ type: 'draw', startX: cx, startY: cy, nodeId })
}

export function startShapeDraw(
  cx: number,
  cy: number,
  editor: Editor,
  setDrag: (d: DragState) => void
) {
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
  setDrag({ type: 'draw', startX: cx, startY: cy, nodeId })
}

export function handleDrawMove(
  d: DragDraw,
  cx: number,
  cy: number,
  shiftKey: boolean,
  editor: Editor
) {
  let w = cx - d.startX
  let h = cy - d.startY

  if (shiftKey) {
    const size = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w) * size
    h = Math.sign(h) * size
  }

  editor.updateNode(d.nodeId, {
    x: w < 0 ? d.startX + w : d.startX,
    y: h < 0 ? d.startY + h : d.startY,
    width: Math.abs(w),
    height: Math.abs(h)
  })
}

export function handleDrawUp(d: DragDraw, editor: Editor) {
  const node = editor.graph.getNode(d.nodeId)
  if (node?.type === 'TEXT') {
    const isPointText = node.width < 2 && node.height < 2
    editor.updateNode(d.nodeId, {
      width: isPointText ? DEFAULT_TEXT_WIDTH : node.width,
      height: isPointText ? DEFAULT_TEXT_HEIGHT : node.height,
      textAutoResize: isPointText ? 'WIDTH_AND_HEIGHT' : 'NONE'
    })
  } else if (node && node.width < 2 && node.height < 2) {
    const map = resolveMapModule(node.interactiveProps?.module)
    editor.updateNode(
      d.nodeId,
      map?.ok
        ? { width: MAP_MODULE_DEFAULT_SIZE.width, height: MAP_MODULE_DEFAULT_SIZE.height }
        : { width: 100, height: 100 }
    )
  }
  if (node?.type === 'SECTION') {
    editor.adoptNodesIntoSection(node.id)
  }
  editor.commitResize(d.nodeId, { x: d.startX, y: d.startY, width: 0, height: 0 })
  editor.undo.commitBatch()
  editor.setTool('SELECT')
  if (node?.type === 'TEXT') editor.startTextEditing(node.id)
}
