import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { getTransformedNodeBounds, getWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import Matrix, { type Mat3 } from '@open-pencil/scene-graph/matrix'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { GuideRedline } from './types'

function axisGap(axis: 'x' | 'y', position: number, bounds: Rect) {
  const start = axis === 'x' ? bounds.x : bounds.y
  const end = start + (axis === 'x' ? bounds.width : bounds.height)
  if (position < start) return { from: position, to: start, value: start - position }
  if (position > end) return { from: end, to: position, value: position - end }
  return null
}

function projectSegment(
  matrix: Mat3,
  segment: GuideRedline['segment']
): GuideRedline['segment'] | null {
  const points =
    segment.axis === 'x'
      ? Matrix.mapPoints(matrix, [segment.from, segment.cross, segment.to, segment.cross])
      : Matrix.mapPoints(matrix, [segment.cross, segment.from, segment.cross, segment.to])
  const [x1, y1, x2, y2] = points
  const tolerance = 1e-6 * Math.max(1, Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2))
  if (Math.abs(y2 - y1) <= tolerance) {
    return { axis: 'x', from: x1, to: x2, cross: (y1 + y2) / 2, value: segment.value }
  }
  if (Math.abs(x2 - x1) <= tolerance) {
    return { axis: 'y', from: y1, to: y2, cross: (x1 + x2) / 2, value: segment.value }
  }
  // MeasurementSegment is axis-aligned. Suppress a misleading redline when the frame's
  // world transform would make the local measurement diagonal.
  return null
}

function boundsInFrame(node: SceneNode, graph: SceneGraph, inverseFrame: Mat3): Rect {
  const matrix = Matrix.multiply(inverseFrame, getWorldMatrix(node, graph))
  return getTransformedNodeBounds(node, matrix)
}

function frameRedline(
  axis: 'x' | 'y',
  position: number,
  frame: SceneNode,
  frameMatrix: Mat3
): GuideRedline | null {
  const bounds = { x: 0, y: 0, width: frame.width, height: frame.height }
  const gap = axisGap(axis, position, bounds)
  if (!gap) return null
  const segment = projectSegment(frameMatrix, {
    axis,
    ...gap,
    cross: axis === 'x' ? frame.height / 2 : frame.width / 2
  })
  if (!segment) return null
  return {
    segment,
    targetId: frame.id
  } satisfies GuideRedline
}

function objectRedline(
  axis: 'x' | 'y',
  position: number,
  frame: SceneNode,
  graph: SceneGraph,
  frameMatrix: Mat3,
  inverseFrame: Mat3,
  deep: boolean
): GuideRedline | null {
  const frameBounds = { x: 0, y: 0, width: frame.width, height: frame.height }
  let closest: GuideRedline | null = null
  const visit = (owner: SceneNode) => {
    for (const childId of owner.childIds) {
      const child = graph.getNode(childId)
      if (!child || !child.visible) continue
      const bounds = boundsInFrame(child, graph, inverseFrame)
      const gap = axisGap(axis, position, bounds)
      if (gap) {
        const localSegment = {
          axis,
          ...gap,
          cross:
            axis === 'x'
              ? Math.max(
                  frameBounds.y,
                  Math.min(frameBounds.y + frameBounds.height, bounds.y + bounds.height / 2)
                )
              : Math.max(
                  frameBounds.x,
                  Math.min(frameBounds.x + frameBounds.width, bounds.x + bounds.width / 2)
                )
        } satisfies GuideRedline['segment']
        const segment = projectSegment(frameMatrix, localSegment)
        if (segment) {
          const candidate = { segment, targetId: child.id } satisfies GuideRedline
          if (!closest || candidate.segment.value < closest.segment.value) closest = candidate
        }
      }
      if (deep) visit(child)
    }
  }
  visit(frame)
  return closest
}

export function computeGuideRedline(
  graph: SceneGraph,
  pageId: string,
  frameId: string,
  axis: 'x' | 'y',
  position: number,
  deep = false
): GuideRedline | null {
  const frame = graph.getNode(frameId)
  if (!frame || frame.parentId !== pageId) return null
  const frameMatrix = getWorldMatrix(frame, graph)
  const inverseFrame = Matrix.invert(frameMatrix)
  if (!inverseFrame) return null
  const size = axis === 'x' ? frame.width : frame.height
  return position >= 0 && position <= size
    ? objectRedline(axis, position, frame, graph, frameMatrix, inverseFrame, deep)
    : frameRedline(axis, position, frame, frameMatrix)
}
