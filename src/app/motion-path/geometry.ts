import type { EditorState } from '@open-pencil/core/editor'
import { sampleMotionPath } from '@open-pencil/motion'
import {
  getWorldMatrix,
  TransformMatrix,
  type Mat3,
  type MotionCubicPath,
  type MotionKeyframe,
  type MotionPathPoint,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import { motionPathHandlePoints } from './spec'
import type { MotionPathControlLine, MotionPathHandlePoint } from './types'

export type MotionPathViewport = Pick<EditorState, 'panX' | 'panY' | 'zoom'>

export interface MotionPathCoordinateTransform {
  pathToScreen: Mat3
  screenToPath: Mat3
}

function parentWorldMatrix(graph: SceneGraph, node: SceneNode): Mat3 {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  return parent ? getWorldMatrix(parent, graph) : TransformMatrix.identity()
}

/** Path coordinates are translation deltas in the node parent's local space. */
export function motionPathCoordinateTransform(
  graph: SceneGraph,
  node: SceneNode,
  viewport: Readonly<MotionPathViewport>
): MotionPathCoordinateTransform | undefined {
  const view = TransformMatrix.multiply(
    TransformMatrix.translated(viewport.panX, viewport.panY),
    TransformMatrix.scaled(viewport.zoom, viewport.zoom)
  )
  const pathToScreen = TransformMatrix.multiply(
    view,
    parentWorldMatrix(graph, node),
    TransformMatrix.translated(node.x, node.y)
  )
  const screenToPath = TransformMatrix.invert(pathToScreen)
  return screenToPath ? { pathToScreen, screenToPath } : undefined
}

export function pathPointToScreen(
  transform: Readonly<MotionPathCoordinateTransform>,
  point: Readonly<MotionPathPoint>
): MotionPathPoint {
  return TransformMatrix.mapPoint(transform.pathToScreen, point)
}

export function screenPointToPath(
  transform: Readonly<MotionPathCoordinateTransform>,
  point: Readonly<MotionPathPoint>
): MotionPathPoint {
  return TransformMatrix.mapPoint(transform.screenToPath, point)
}

export function motionPathScreenHandles(
  path: Readonly<MotionCubicPath>,
  transform: Readonly<MotionPathCoordinateTransform>
): MotionPathHandlePoint[] {
  return motionPathHandlePoints(path).map(({ handle, point }) => ({
    handle,
    point: pathPointToScreen(transform, point)
  }))
}

export function motionPathControlLines(path: Readonly<MotionCubicPath>): MotionPathControlLine[] {
  return path.segments.flatMap((segment, index) => {
    const start = path.segments.at(index - 1)?.end ?? path.start
    return [
      { from: { ...start }, to: { ...segment.control1 } },
      { from: { ...segment.end }, to: { ...segment.control2 } }
    ]
  })
}

export function motionPathMarkerPoint(
  path: Readonly<MotionCubicPath>,
  keyframe: Readonly<MotionKeyframe>
): MotionPathPoint {
  const sample = sampleMotionPath(path, keyframe.pathProgress ?? keyframe.offset)
  return { x: sample.x, y: sample.y }
}
