import { createMotionRuntime, type MotionRuntime, type MotionRuntimeOptions } from './runtime'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export interface OwnedMotionRuntime {
  readonly runtime: MotionRuntime
  disposePreferenceListener(): void
}

/** Creates an adapter-owned runtime and, unless explicitly configured, follows the host query. */
export function createOwnedMotionRuntime(options: MotionRuntimeOptions = {}): OwnedMotionRuntime {
  const followsSystemPreference = options.prefersReducedMotion === undefined
  let mediaQuery: MediaQueryList | undefined
  if (followsSystemPreference && typeof globalThis.matchMedia === 'function') {
    mediaQuery = globalThis.matchMedia(REDUCED_MOTION_QUERY)
  }
  const runtime = createMotionRuntime({
    ...options,
    ...(followsSystemPreference ? { prefersReducedMotion: mediaQuery?.matches ?? false } : {})
  })
  if (!mediaQuery) {
    return { runtime, disposePreferenceListener: () => undefined }
  }

  const onChange = (event: MediaQueryListEvent) => runtime.setPrefersReducedMotion(event.matches)
  mediaQuery.addEventListener('change', onChange)
  let listening = true
  return {
    runtime,
    disposePreferenceListener() {
      if (!listening) return
      listening = false
      mediaQuery.removeEventListener('change', onChange)
    }
  }
}
