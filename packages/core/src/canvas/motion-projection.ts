import type { CanvasKit, Path } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

const MOTION_DASH_PHASE = Symbol('motionDashPhase')
const MOTION_DYNAMIC_STROKE = Symbol('motionDynamicStroke')
const MOTION_TRIM = Symbol('motionTrim')

export interface MotionTrimProjection {
  visibleFraction: number
  phase: number
}

type MotionProjectedNode = SceneNode & {
  [MOTION_DASH_PHASE]?: number
  [MOTION_DYNAMIC_STROKE]?: boolean
  [MOTION_TRIM]?: MotionTrimProjection
}

export function motionProjectionFlags(
  dashPhase: number | undefined,
  dynamicStroke: boolean,
  trim: MotionTrimProjection | undefined
): Partial<MotionProjectedNode> {
  return {
    ...(dashPhase === undefined ? {} : { [MOTION_DASH_PHASE]: dashPhase }),
    ...(dynamicStroke ? { [MOTION_DYNAMIC_STROKE]: true } : {}),
    ...(trim ? { [MOTION_TRIM]: trim } : {})
  }
}

export function motionDashPhase(node: SceneNode): number {
  return (node as MotionProjectedNode)[MOTION_DASH_PHASE] ?? 0
}

export function hasMotionDynamicStroke(node: SceneNode): boolean {
  return (node as MotionProjectedNode)[MOTION_DYNAMIC_STROKE] === true
}

export function motionTrimProjection(node: SceneNode): MotionTrimProjection | undefined {
  return (node as MotionProjectedNode)[MOTION_TRIM]
}

export function measurePathLength(ck: CanvasKit, paths: readonly Path[]): number {
  let total = 0
  for (const path of paths) {
    const iterator = new ck.ContourMeasureIter(path, false, 1)
    try {
      for (let contour = iterator.next(); contour; contour = iterator.next()) {
        total += contour.length()
        contour.delete()
      }
    } finally {
      iterator.delete()
    }
  }
  return Math.max(1, total)
}
