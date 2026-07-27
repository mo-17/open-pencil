import type { IRMotion } from '#compiler/ir/motion'

export interface ReactMotionEntry {
  token: string
  motion: IRMotion
}

export interface ReactMotionPlan {
  css?: string
  runtime?: string
  animatedComponentNames: ReadonlySet<string>
}
