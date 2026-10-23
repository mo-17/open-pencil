/** Event-driven and bounded; included only in the existing dev preview bridge. */
export function buildPreviewDebugRuntime(): string {
  return `
  type RuntimeDebugKind = 'event' | 'action' | 'expression' | 'request' | 'state' | 'error'
  type RuntimeDebugStatus = 'start' | 'success' | 'error' | 'changed'
  interface RuntimeDebugEntry {
    sequence: number
    trace: number
    nodeId: string | null
    kind: RuntimeDebugKind
    label: string
    status: RuntimeDebugStatus
    durationMs: number | null
  }
  let runtimeDebugEnabled = false
  let runtimeDebugSequence = 0
  let runtimeDebugTrace = 0
  let runtimeDebugCurrent = 0
  let runtimeDebugDropped = 0
  let runtimeDebugFrame: number | null = null
  const runtimeDebugNodes = new Map<number, string | null>()
  let runtimeDebugQueue: RuntimeDebugEntry[] = []
  let runtimeDebugPreviousFetch: typeof fetch | undefined
  let runtimeDebugFetch: typeof fetch | undefined

  function activateRuntimeDebug(trace: number): void {
    runtimeDebugCurrent = trace
    queueMicrotask(() => { if (runtimeDebugCurrent === trace) runtimeDebugCurrent = 0 })
  }

  function flushRuntimeDebug(): void {
    runtimeDebugFrame = null
    if (!runtimeDebugEnabled || !runtimeDebugQueue.length) return
    const entries = runtimeDebugQueue
    runtimeDebugQueue = []
    postToParent({ type: 'runtimeDebug', entries, dropped: runtimeDebugDropped })
  }
  function runtimeDebugRecord(trace: number, kind: RuntimeDebugKind, label: string, status: RuntimeDebugStatus, durationMs: number | null = null): void {
    if (!runtimeDebugEnabled || trace === 0 || !runtimeDebugNodes.has(trace)) return
    if (runtimeDebugQueue.length >= 32) { runtimeDebugQueue.shift(); runtimeDebugDropped += 1 }
    runtimeDebugQueue.push({ sequence: ++runtimeDebugSequence, trace, nodeId: runtimeDebugNodes.get(trace) ?? null, kind, label: label.slice(0, 128), status, durationMs })
    if (runtimeDebugFrame === null) runtimeDebugFrame = requestAnimationFrame(flushRuntimeDebug)
  }
  function beginRuntimeDebug(nodeId: string | null, label: string): number {
    if (!runtimeDebugEnabled) return 0
    const trace = ++runtimeDebugTrace
    activateRuntimeDebug(trace)
    runtimeDebugNodes.set(trace, nodeId && nodeId.length <= MAX_NODE_ID_LENGTH ? nodeId : null)
    if (runtimeDebugNodes.size > 200) {
      const oldest = runtimeDebugNodes.keys().next().value
      if (oldest !== undefined) runtimeDebugNodes.delete(oldest)
    }
    runtimeDebugRecord(trace, 'event', label, 'start')
    return trace
  }
  const runtimeDebugAPI: NonNullable<Window['__opLowcodeDebug']> = {
    begin: (nodeId, label) => beginRuntimeDebug(nodeId, label),
    step: (trace, kind, label, status) => {
      if (trace !== 0 && runtimeDebugNodes.has(trace)) activateRuntimeDebug(trace)
      runtimeDebugRecord(trace, kind, label, status)
    },
    expression: (trace, compute) => {
      runtimeDebugRecord(trace, 'expression', 'evaluate', 'start')
      try {
        const value = compute()
        runtimeDebugRecord(trace, 'expression', 'evaluate', 'success')
        return value
      } catch (error) {
        runtimeDebugRecord(trace, 'expression', 'evaluate', 'error')
        throw error
      }
    }
  }
  window.__opLowcodeDebug = runtimeDebugAPI

  function setRuntimeDebugEnabled(enabled: boolean): void {
    runtimeDebugEnabled = enabled
    runtimeDebugQueue = []
    runtimeDebugNodes.clear()
    runtimeDebugCurrent = 0
    runtimeDebugDropped = 0
    if (runtimeDebugFrame !== null) cancelAnimationFrame(runtimeDebugFrame)
    runtimeDebugFrame = null
    if (!enabled) {
      if (runtimeDebugFetch && runtimeDebugPreviousFetch && window.fetch === runtimeDebugFetch) window.fetch = runtimeDebugPreviousFetch
      runtimeDebugFetch = undefined
      runtimeDebugPreviousFetch = undefined
      return
    }
    // Request bodies, URLs, headers and response contents never cross this channel.
    if (!runtimeDebugFetch) {
      const previousFetch = window.fetch
      runtimeDebugPreviousFetch = previousFetch
      const nextFetch: typeof fetch = async (input, init) => {
        const trace = runtimeDebugCurrent || beginRuntimeDebug(null, 'background')
        const rawMethod = init?.method ?? (input instanceof Request ? input.method : 'GET')
        const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(rawMethod.toUpperCase()) ? rawMethod.toUpperCase() : 'OTHER'
        const started = performance.now()
        runtimeDebugRecord(trace, 'request', method, 'start')
        try {
          const response = await previousFetch.call(window, input, init)
          runtimeDebugRecord(trace, 'request', method + ' ' + response.status, response.ok ? 'success' : 'error', Math.max(0, Math.round(performance.now() - started)))
          return response
        } catch (error) {
          runtimeDebugRecord(trace, 'request', method, 'error', Math.max(0, Math.round(performance.now() - started)))
          throw error
        }
      }
      runtimeDebugFetch = nextFetch
      window.fetch = nextFetch
    }
    postToParent({ type: 'runtimeDebug', entries: [], dropped: 0 })
  }
  function runtimeDebugState(name: string): void {
    const trace = runtimeDebugCurrent || beginRuntimeDebug(null, 'background')
    runtimeDebugRecord(trace, 'state', name, 'changed')
  }
  function runtimeDebugEvent(event: Event): void {
    if (!runtimeDebugEnabled || (event instanceof MouseEvent && event.altKey)) return
    const host = event.target instanceof Element ? event.target.closest('[data-node-id]') : null
    const nodeId = host?.getAttribute('data-node-id') ?? null
    if (nodeId) beginRuntimeDebug(nodeId, event.type)
  }
  for (const type of ['click', 'input', 'change', 'submit']) document.addEventListener(type, runtimeDebugEvent, true)
  function runtimeDebugFailure(): void {
    const trace = runtimeDebugCurrent || beginRuntimeDebug(null, 'background')
    runtimeDebugRecord(trace, 'error', 'runtime', 'error')
  }
  window.addEventListener('error', runtimeDebugFailure)
  window.addEventListener('unhandledrejection', runtimeDebugFailure)
  window.addEventListener('pagehide', () => {
    setRuntimeDebugEnabled(false)
    for (const type of ['click', 'input', 'change', 'submit']) document.removeEventListener(type, runtimeDebugEvent, true)
    window.removeEventListener('error', runtimeDebugFailure)
    window.removeEventListener('unhandledrejection', runtimeDebugFailure)
    if (window.__opLowcodeDebug === runtimeDebugAPI) delete window.__opLowcodeDebug
  }, { once: true })
`
}
