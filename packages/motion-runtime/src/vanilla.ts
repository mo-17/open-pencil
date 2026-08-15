import type { MotionSamplingSelection } from '@open-pencil/motion'
import type { MotionSpec, MotionTrigger } from '@open-pencil/scene-graph'

import { runMotionCleanup } from './cleanup'
import { createDOMMotionTarget, type DOMMotionTargetOptions, type MotionStyleTarget } from './dom'
import { createOwnedMotionRuntime } from './owned-runtime'
import { type MotionRuntime, type MotionRuntimeHandle, type MotionRuntimeOptions } from './runtime'

export { createVanillaMotionDrivers } from './drivers'
export type { DOMMotionDriversController, DOMMotionDriversOptions } from './drivers'

export interface VanillaMotionElement extends MotionStyleTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void
}

export interface VanillaMotionOptions extends DOMMotionTargetOptions {
  readonly id?: string
  readonly element: VanillaMotionElement
  readonly motion: MotionSpec
  readonly trigger?: MotionTrigger
  readonly selection?: MotionSamplingSelection
  readonly runtime?: MotionRuntime
  readonly runtimeOptions?: MotionRuntimeOptions
  readonly autoplay?: boolean
}

export interface VanillaMotionController {
  readonly runtime: MotionRuntime
  readonly handle: MotionRuntimeHandle
  play(): void
  stop(): void
  dispose(): void
}

let nextVanillaMotionId = 0

function selectionContainsSuppressedTrack(
  selection: MotionSamplingSelection,
  motion: MotionSpec,
  suppressedTracks: ReadonlySet<string>
): boolean {
  if (selection.mode === 'trackIds') {
    return selection.trackIds.some((trackId) => suppressedTracks.has(trackId))
  }
  if (selection.mode === 'trigger') {
    return motion.tracks.some(
      (track) => track.trigger === selection.trigger && suppressedTracks.has(track.id)
    )
  }
  return motion.tracks.some((track) => suppressedTracks.has(track.id))
}

/** Mounts a MotionSpec on a DOM-like element with bounded trigger listeners and cleanup. */
export function createVanillaMotion(options: VanillaMotionOptions): VanillaMotionController {
  const ownsRuntime = options.runtime === undefined
  const ownedRuntime = ownsRuntime ? createOwnedMotionRuntime(options.runtimeOptions) : undefined
  const runtime = options.runtime ?? ownedRuntime?.runtime
  if (!runtime) throw new Error('Vanilla Motion runtime ownership could not be resolved')
  const dom = createDOMMotionTarget(options.element, options)
  const trigger = options.trigger ?? 'mount'
  const selection = options.selection ?? { mode: 'trigger' as const, trigger }
  const id = options.id ?? `vanilla-motion-${++nextVanillaMotionId}`
  const handle = runtime.register({
    id,
    motion: options.motion,
    selection,
    apply: ({ sample }) => {
      if (sample.hasTracks) dom.apply(sample.visual)
      else dom.restore()
    },
    clear: () => dom.restore()
  })
  const listeners: Array<{ type: string; listener: EventListener }> = []
  let disposed = false
  const suppressedTracks = new Set(
    ('getAttribute' in options.element
      ? ((
          options.element as VanillaMotionElement & { getAttribute(name: string): string | null }
        ).getAttribute('data-op-motion-driver-tracks') ?? '')
      : ''
    )
      .split(' ')
      .filter(Boolean)
  )
  const automaticTriggerSuppressed = selectionContainsSuppressedTrack(
    selection,
    options.motion,
    suppressedTracks
  )

  const listen = (type: string, listener: EventListener) => {
    options.element.addEventListener(type, listener)
    listeners.push({ type, listener })
  }
  const play = () => handle.play()
  const stop = () => handle.stop()

  switch (automaticTriggerSuppressed ? 'suppressed' : trigger) {
    case 'hover':
      listen('pointerenter', play)
      listen('pointerleave', stop)
      break
    case 'press':
      listen('pointerdown', play)
      listen('pointerup', stop)
      listen('pointercancel', stop)
      break
    case 'focus':
      listen('focusin', play)
      listen('focusout', stop)
      break
    case 'click':
      listen('click', play)
      break
  }

  const autoplay =
    !automaticTriggerSuppressed &&
    (options.autoplay ?? (trigger === 'mount' || trigger === 'pageEnter' || trigger === 'loop'))
  if (autoplay) {
    play()
  }

  return Object.freeze({
    runtime,
    handle,
    play,
    stop,
    dispose() {
      if (disposed) return
      disposed = true
      runMotionCleanup(
        [
          ...listeners.map(
            ({ type, listener }) =>
              () =>
                options.element.removeEventListener(type, listener)
          ),
          () => ownedRuntime?.disposePreferenceListener(),
          () => handle.dispose(),
          () => {
            if (ownsRuntime) runtime.dispose()
          }
        ],
        `Vanilla Motion cleanup failed: ${id}`
      )
    }
  })
}
