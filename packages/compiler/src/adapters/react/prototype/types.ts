import type { IRPrototypeTransitionDirection, IRPrototypeTrigger } from '#compiler/ir/prototype'
import type { CompileWarning } from '#compiler/types'

export type ReactPrototypeAction =
  | {
      kind: 'navigate'
      route: string
      targetNodeId: string
      targetPageId: string
      targetKind: 'page' | 'frame'
    }
  | { kind: 'back' }
  | {
      kind: 'openOverlay'
      targetNodeId: string
      placement: 'center' | 'top' | 'right' | 'bottom' | 'left'
      dismissOnOutside: boolean
    }
  | { kind: 'closeOverlay' }

export type ReactPrototypeTransition =
  | { kind: 'instant' }
  | { kind: 'dissolve'; durationMs: number; easing: string }
  | {
      kind: 'slide' | 'push'
      durationMs: number
      easing: string
      direction: IRPrototypeTransitionDirection
    }
  | {
      kind: 'smartMatch'
      durationMs: number
      easing: string
      fallback: 'dissolve' | 'instant'
    }

export interface ReactPrototypeConnection {
  id: string
  sourceNodeId: string
  sourcePageId: string
  trigger: IRPrototypeTrigger
  action: ReactPrototypeAction
  transition: ReactPrototypeTransition
  interruption: 'replace' | 'queue'
  playback: 'forward' | 'reverse'
}

export interface ReactPrototypeManifest {
  connections: ReactPrototypeConnection[]
  pageRoutes: Record<string, string>
  /** Duplicates are retained; runtime only Smart Matches keys occurring once
   * in both the old and new scope. */
  pageTransitionKeys: Record<string, string[]>
  overlayTransitionKeys: Record<string, string[]>
}

export interface ReactPrototypePlan {
  runtime?: string
  warnings: CompileWarning[]
  prototypeComponentNames: ReadonlySet<string>
}
