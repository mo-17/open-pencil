import type { NodeType, SceneNode } from '@open-pencil/scene-graph'

import { createSceneGeometry } from '#core/geometry/scene'

import { prepareSlotEdits } from './components/slots'
import { contentEditInsertionParent } from './content-edit'
import { adoptCoveredLayers } from './shapes/adopt'
import { newLayerDefaults } from './shapes/defaults'
import { createFramePresetActions } from './shapes/frame-presets'
import { createPenActions } from './shapes/pen'
import { createPencilActions } from './shapes/pencil'
import { defaultNodeName, nextNumberedName } from './structure/rename'
import type { EditorContext } from './types'
export type { PenDragOptions } from './shapes/pen'

/** Layers Figma numbers when drawn, as "Rectangle 1"; others keep their type's name. */
const NUMBERED_WHEN_DRAWN: ReadonlySet<NodeType> = new Set([
  'FRAME',
  'SECTION',
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'POLYGON',
  'STAR'
])

export function createShapeActions(ctx: EditorContext) {
  function drawnLayerName(type: NodeType, parentId: string): string {
    const base = defaultNodeName(type)
    return NUMBERED_WHEN_DRAWN.has(type) ? nextNumberedName(ctx.graph, parentId, base) : base
  }

  function createShape(
    type: NodeType,
    x: number,
    y: number,
    w: number,
    h: number,
    parentId?: string,
    name?: string,
    initialOverrides: Partial<SceneNode> = {}
  ): string {
    const pid = parentId ?? contentEditInsertionParent(ctx)
    if (!pid) throw new Error('Content root cannot contain child nodes')
    if (!prepareSlotEdits(ctx, [pid]))
      throw new Error('Cannot add a layer to the locked part of an instance')
    if (!parentId && ctx.state.contentEdit) {
      const parent = ctx.graph.getNode(pid)
      const local = parent ? createSceneGeometry(ctx.graph).toLocal(parent, { x, y }) : null
      if (local) ({ x, y } = local)
    }
    const overrides: Partial<SceneNode> = {
      ...newLayerDefaults(type, ctx.state.theme),
      x,
      y,
      width: w,
      height: h,
      name: name ?? drawnLayerName(type, pid)
    }
    Object.assign(overrides, initialOverrides)
    const node = ctx.graph.createNode(type, pid, overrides)
    const id = node.id
    // Save the finished layer when it is undone, with its creation-time child edges copied.
    let snapshot = { ...node, childIds: [...node.childIds] }
    ctx.undo.push({
      label: `Create ${type.toLowerCase()}`,
      forward: () => {
        ctx.graph.createNode(snapshot.type, pid, {
          ...snapshot,
          childIds: [...snapshot.childIds]
        })
      },
      inverse: () => {
        const current = ctx.graph.getNode(id)
        if (current) snapshot = { ...current, childIds: [...current.childIds] }
        ctx.graph.deleteNode(id)
        const next = new Set(ctx.state.selectedIds)
        next.delete(id)
        ctx.setSelectedIds(next)
      }
    })
    return id
  }

  const penActions = createPenActions(ctx, createShape)
  const pencilActions = createPencilActions(ctx, createShape)
  const framePresetActions = createFramePresetActions(ctx, createShape)

  function setTool(tool: typeof ctx.state.activeTool) {
    ctx.setActiveTool(tool)
  }

  return {
    createShape,
    ...penActions,
    ...pencilActions,
    ...framePresetActions,
    adoptCoveredLayers: (containerId: string) => adoptCoveredLayers(ctx, containerId),
    setTool
  }
}
