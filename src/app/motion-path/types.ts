import type { MotionPathPoint } from '@open-pencil/scene-graph'

export type MotionPathHandle =
  | { kind: 'start' }
  | { kind: 'control1' | 'control2' | 'end'; segmentIndex: number }

export interface MotionPathEditSelection {
  nodeId: string
  trackId: string
  keyframeIndex: number
  keyframeId?: string
  focusedHandle?: MotionPathHandle
}

export interface MotionPathHandlePoint {
  handle: MotionPathHandle
  point: MotionPathPoint
}

export interface MotionPathControlLine {
  from: MotionPathPoint
  to: MotionPathPoint
}
