export const REQUEST_THROTTLE_MS = 300
export const REQUEST_DEBOUNCE_MS = 250

/**
 * Emit the page/component-local request gate used by generated React event
 * handlers. Activation starts immediately, then a leading-edge throttle closes
 * the fast-response re-click window. The ref-backed single-flight lock remains
 * authoritative until the promise settles; no mutation is queued or replayed.
 *
 * When `debounce` is active, onChange request chains use a trailing latest-wins
 * queue keyed by the actual DOM control. Distinct list/component instances do
 * not cancel one another, and a running request is followed by at most the
 * newest queued value.
 */
export function buildRequestGateHookLines(active = true, debounce = false): string {
  if (!active) return ''
  return `  const __opRequestsInFlight = useRef(new Set<string>())
  const __opRequestThrottleUntil = useRef(new Map<string, number>())${debounce ? changeDebounceRefLines() : ''}
  const [__opPendingRequests, __opSetPendingRequests] = useState<ReadonlySet<string>>(() => new Set())
  const __opRunRequest = async (key: string, operation: () => Promise<void>): Promise<void> => {
    const now = Date.now()
    if (__opRequestsInFlight.current.has(key) || now < (__opRequestThrottleUntil.current.get(key) ?? 0)) return
    __opRequestsInFlight.current.add(key)
    __opRequestThrottleUntil.current.set(key, now + ${REQUEST_THROTTLE_MS})
    __opSetPendingRequests((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
    try {
      await operation()
    } finally {
      __opRequestsInFlight.current.delete(key)
      if (Date.now() >= (__opRequestThrottleUntil.current.get(key) ?? 0)) {
        __opRequestThrottleUntil.current.delete(key)
      }
      __opSetPendingRequests((current) => {
        if (!current.has(key)) return current
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }${debounce ? changeDebounceHookLines() : ''}`
}

export function buildRequestGatePageAttrs(active: boolean): string {
  return active
    ? ' aria-busy={__opPendingRequests.size > 0} data-op-request-pending={__opPendingRequests.size > 0 ? "true" : undefined}'
    : ''
}

function changeDebounceRefLines(): string {
  return `
  type __OpDebouncedChange = { generation: number; operation: () => Promise<void> }
  const __opChangeDebounceTimers = useRef(new Map<EventTarget, ReturnType<typeof setTimeout>>())
  const __opChangeDebounceGenerations = useRef(new Map<EventTarget, number>())
  const __opChangesInFlight = useRef(new Set<EventTarget>())
  const __opQueuedChanges = useRef(new Map<EventTarget, __OpDebouncedChange>())
  const __opChangeDebounceMounted = useRef(true)`
}

function changeDebounceHookLines(): string {
  return `
  const __opRunDebouncedChange = async (
    target: EventTarget,
    change: __OpDebouncedChange
  ): Promise<void> => {
    if (!__opChangeDebounceMounted.current || __opChangeDebounceGenerations.current.get(target) !== change.generation) return
    if (__opChangesInFlight.current.has(target)) {
      __opQueuedChanges.current.set(target, change)
      return
    }
    __opChangesInFlight.current.add(target)
    try {
      await change.operation()
    } catch (error) {
      console.error('Debounced change request failed:', error)
    } finally {
      __opChangesInFlight.current.delete(target)
      if (!__opChangeDebounceMounted.current) return
      const next = __opQueuedChanges.current.get(target)
      __opQueuedChanges.current.delete(target)
      if (next && __opChangeDebounceGenerations.current.get(target) === next.generation) {
        void __opRunDebouncedChange(target, next)
      } else if (!__opChangeDebounceTimers.current.has(target)) {
        __opChangeDebounceGenerations.current.delete(target)
      }
    }
  }
  const __opDebounceChange = (target: EventTarget, operation: () => Promise<void>): void => {
    const generation = (__opChangeDebounceGenerations.current.get(target) ?? 0) + 1
    __opChangeDebounceGenerations.current.set(target, generation)
    __opQueuedChanges.current.delete(target)
    const previous = __opChangeDebounceTimers.current.get(target)
    if (previous !== undefined) clearTimeout(previous)
    const timer = setTimeout(() => {
      __opChangeDebounceTimers.current.delete(target)
      void __opRunDebouncedChange(target, { generation, operation })
    }, ${REQUEST_DEBOUNCE_MS})
    __opChangeDebounceTimers.current.set(target, timer)
  }
  useEffect(() => {
    __opChangeDebounceMounted.current = true
    return () => {
      __opChangeDebounceMounted.current = false
      for (const timer of __opChangeDebounceTimers.current.values()) clearTimeout(timer)
      __opChangeDebounceTimers.current.clear()
      __opChangeDebounceGenerations.current.clear()
      __opQueuedChanges.current.clear()
    }
  }, [])`
}
