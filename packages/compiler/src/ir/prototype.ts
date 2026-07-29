/**
 * Framework-neutral prototype IR. SceneGraph ids are resolved during collect;
 * adapters only see deterministic page/frame destinations and validated data.
 */

import type { IRMotionEasing } from './motion'

export type IRPrototypeTrigger = { kind: 'click' } | { kind: 'afterDelay'; delayMs: number }

interface IRPrototypeTargetBase {
  /** Authored SceneNode id of the destination. */
  nodeId: string
  /** Owning CANVAS id used by adapters to resolve a route. */
  pageId: string
  /**
   * Runtime path through one or more reusable component boundaries. Each path
   * segment is a component-body source id. Adapters fold the path onto either
   * `componentRootNodeId` (an authored page instance/master) or the active
   * component-instance scope when the root is omitted.
   */
  componentPath?: string[]
  /** Absolute authored component usage anchoring `componentPath`. Omitted for
   * a target local to the reusable component body that owns the connection. */
  componentRootNodeId?: string
}

export type IRPrototypeTarget =
  | (IRPrototypeTargetBase & { kind: 'page' })
  | (IRPrototypeTargetBase & { kind: 'frame' })

export type IRPrototypeAction =
  | { kind: 'navigate'; target: IRPrototypeTarget }
  | { kind: 'back' }
  | {
      kind: 'openOverlay'
      target: Extract<IRPrototypeTarget, { kind: 'frame' }>
      placement: 'center' | 'top' | 'right' | 'bottom' | 'left'
      dismissOnOutside: boolean
    }
  | { kind: 'closeOverlay' }

export type IRPrototypeTransitionDirection = 'left' | 'right' | 'up' | 'down'

interface IRTimedPrototypeTransition {
  durationMs: number
  easing: IRMotionEasing
}

export type IRPrototypeTransition =
  | { kind: 'instant' }
  | ({ kind: 'dissolve' } & IRTimedPrototypeTransition)
  | ({ kind: 'slide'; direction: IRPrototypeTransitionDirection } & IRTimedPrototypeTransition)
  | ({ kind: 'push'; direction: IRPrototypeTransitionDirection } & IRTimedPrototypeTransition)
  | ({ kind: 'smartMatch'; fallback: 'dissolve' | 'instant' } & IRTimedPrototypeTransition)

export interface IRPrototypeConnection {
  id: string
  trigger: IRPrototypeTrigger
  action: IRPrototypeAction
  transition: IRPrototypeTransition
  interruption: 'replace' | 'queue'
  playback: 'forward' | 'reverse'
}

export interface IRPrototypeNode {
  connections: IRPrototypeConnection[]
}

/** Runtime-only DOM decoration retained on elements/component boundaries. */
export interface IRPrototypeDecoration {
  prototype?: IRPrototypeNode
  transitionKey?: string
  prototypeTarget?: true
  prototypeOverlayTarget?: true
  /** Runtime identity is relative to the generated component's instance scope
   * instead of the reusable master id. Adapter-only DOM projection consumes
   * this marker; it is never serialized back into the design document. */
  prototypeScope?: true
}
