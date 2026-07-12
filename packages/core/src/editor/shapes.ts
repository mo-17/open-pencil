import type { Fill, NodeType, SceneNode } from '@open-pencil/scene-graph'

import {
  BLACK,
  DEFAULT_FRAME_FILL,
  DEFAULT_SHAPE_FILL,
  SECTION_DEFAULT_FILL,
  SECTION_DEFAULT_STROKE
} from '#core/constants'

import { createPenActions } from './shapes/pen'
import { adoptNodesIntoSection as adoptNodesIntoSectionImpl } from './shapes/section-adopt'
import type { EditorContext } from './types'
export type { PenDragOptions } from './shapes/pen'

const BLACK_FILL: Fill = {
  type: 'SOLID',
  color: BLACK,
  opacity: 1,
  visible: true
}

const DEFAULT_FILLS: Record<string, Fill> = {
  FRAME: DEFAULT_FRAME_FILL,
  SECTION: SECTION_DEFAULT_FILL,
  RECTANGLE: DEFAULT_SHAPE_FILL,
  ELLIPSE: DEFAULT_SHAPE_FILL,
  POLYGON: DEFAULT_SHAPE_FILL,
  STAR: DEFAULT_SHAPE_FILL,
  LINE: BLACK_FILL,
  TEXT: BLACK_FILL
}

// Interactive node types own their visual defaults via node-defaults.ts —
// createShape must not stamp a generic fill over the type-specific defaults.
const INTERACTIVE_TYPES = new Set<NodeType>([
  'INPUT',
  'BUTTON',
  'SELECT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'RADIO',
  'TEXTAREA',
  'DATEPICKER',
  'SWITCH'
])

export function createShapeActions(ctx: EditorContext) {
  function createShape(
    type: NodeType,
    x: number,
    y: number,
    w: number,
    h: number,
    parentId?: string
  ): string {
    const pid = parentId ?? ctx.state.currentPageId
    const overrides: Partial<SceneNode> = { x, y, width: w, height: h }
    if (!INTERACTIVE_TYPES.has(type)) {
      const fill = DEFAULT_FILLS[type] ?? DEFAULT_FILLS.RECTANGLE
      overrides.fills = [{ ...fill }]
    }
    if (type === 'SECTION') {
      overrides.strokes = [{ ...SECTION_DEFAULT_STROKE }]
      overrides.cornerRadius = 5
    }
    if (type === 'POLYGON') {
      overrides.pointCount = 3
    }
    if (type === 'STAR') {
      overrides.pointCount = 5
      overrides.starInnerRadius = 0.38
    }
    const node = ctx.graph.createNode(type, pid, overrides)
    const id = node.id
    const snapshot = { ...node }
    ctx.undo.push({
      label: `Create ${type.toLowerCase()}`,
      forward: () => {
        ctx.graph.createNode(snapshot.type, pid, snapshot)
      },
      inverse: () => {
        ctx.graph.deleteNode(id)
        const next = new Set(ctx.state.selectedIds)
        next.delete(id)
        ctx.setSelectedIds(next)
      }
    })
    return id
  }

  const penActions = createPenActions(ctx, createShape)

  function setTool(tool: typeof ctx.state.activeTool) {
    ctx.setActiveTool(tool)
  }

  return {
    createShape,
    ...penActions,
    adoptNodesIntoSection: (sectionId: string) => adoptNodesIntoSectionImpl(ctx, sectionId),
    setTool
  }
}
