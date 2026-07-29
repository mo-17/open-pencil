import type { IRMotion } from '#compiler/ir/motion'

export interface ReactMotionEntry {
  token: string
  motion: IRMotion
}

export interface ReactMotionPlan {
  css?: string
  runtime?: string
  animatedComponentNames: ReadonlySet<string>
  /** Reusable component boundaries that receive authored root events from at
   * least one reachable usage. Kept separate so event-free components remain
   * byte-identical and do not import React event types unnecessarily. */
  eventComponentNames: ReadonlySet<string>
  /** Reusable components whose root or body contains a programmatic Motion
   * action. Their generated root bounds current-instance target resolution. */
  motionScopeComponentNames: ReadonlySet<string>
}
