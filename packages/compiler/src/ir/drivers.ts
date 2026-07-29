/** Framework-neutral continuous Motion input IR. */

export type IRMotionDriverAxis = 'x' | 'y'

export type IRMotionDriverSource =
  | {
      kind: 'scroll'
      sourceNodeId?: string
      axis: IRMotionDriverAxis
      metric: 'progress' | 'offset'
    }
  | {
      kind: 'pointer'
      sourceNodeId?: string
      axis: IRMotionDriverAxis
      space: 'local' | 'viewport'
    }
  | { kind: 'drag'; handleNodeId: string; axis: IRMotionDriverAxis; distance: number }
  | { kind: 'visibility'; sourceNodeId: string }
  | { kind: 'pageState'; stateId: string }
  | { kind: 'documentState'; stateId: string }
  | { kind: 'variable'; variableId: string }

export interface IRMotionDriver {
  id: string
  source: IRMotionDriverSource
  target: { targetNodeId: string; trackId: string }
  mapping: {
    inputMin: number
    inputMax: number
    clamp: boolean
    reverse: boolean
    deadZone: number
  }
}

export interface IRMotionDriverSpec {
  version: 1
  drivers: IRMotionDriver[]
}
