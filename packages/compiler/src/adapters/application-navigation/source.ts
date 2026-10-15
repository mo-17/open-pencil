export const applicationNavigationFile = 'src/_application_navigation.ts'

const trackerSource = `
const markerKey = '__openpencil_application_nav'
type Entry = { session: string; position: number; href: string; key: string }
type BackSnapshot = { entry: Entry | undefined; cancelled: boolean }
function internalFallback(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !/[\\\\\\x00-\\x1f\\x7f]/.test(value)
    && !value.split(/[?#]/, 1)[0].split('/').some(segment => segment.startsWith(':') || segment.includes('*'))
}
function createTracker() {
  const session = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : String(Date.now()) + ':' + String(Math.random())
  const entries = new Map<number, Entry>()
  let current: Entry | undefined
  let backPending: number | undefined
  let backSequence = 0
  let pendingCommit: { position: number; key: string; href: string; resolve: (snapshot: BackSnapshot) => void } | undefined
  function marker(): Entry | undefined {
    if (typeof window === 'undefined') return undefined
    const value = window.history.state?.[markerKey]
    return value && value.session === session && Number.isSafeInteger(value.position)
      && typeof value.href === 'string' && typeof value.key === 'string' ? value : undefined
  }
  function commit(position: unknown, href: string, key: string, mode: string): void {
    if (typeof window === 'undefined' || !Number.isSafeInteger(position)) return
    const index = position as number
    const previous = entries.get(index)
    const marked = marker()
    // A repeated layout effect is not a new navigation and must not release an active Back.
    if (current && marked && previous === current && current.position === index
      && current.href === href && current.key === key && marked.position === index
      && marked.href === href && marked.key === key) return
    if (current && mode === 'POP' && (!previous || !marked || marked.position !== index
      || previous.href !== href || previous.key !== key || marked.href !== href || marked.key !== key)) {
      entries.clear()
    }
    if (mode === 'PUSH') for (const indexKey of entries.keys()) if (indexKey >= index) entries.delete(indexKey)
    const entry = { session, position: index, href, key }
    entries.set(index, entry)
    current = entry
    const waiting = pendingCommit
    pendingCommit = undefined
    if (!waiting) backPending = undefined
    if (!marked || marked.position !== index || marked.href !== href || marked.key !== key)
      window.history.replaceState({ ...window.history.state, [markerKey]: entry }, '', window.location.href)
    if (waiting) {
      const matches = waiting.position === index && waiting.key === key && waiting.href === window.location.href
      waiting.resolve({ entry: matches ? entry : undefined, cancelled: !matches })
    }
  }
  function snapshot(): Entry | undefined {
    const value = marker()
    return current && value && value.position === current.position && value.href === current.href
      && value.key === current.key ? current : undefined
  }
  function canBack(entry: Entry): boolean {
    return snapshot() === entry && entries.has(entry.position - 1)
  }
  function snapshotWhenCommitted(position: unknown, key: unknown, href: string): Promise<BackSnapshot> {
    const entry = snapshot()
    if (entry || !current || !Number.isSafeInteger(position) || typeof key !== 'string'
      || (position === current.position && key === current.key)) {
      return Promise.resolve({ entry, cancelled: false })
    }
    // React Router has written its native entry but its layout effect has not committed it.
    // Only that later commit can grant history authority; native idx/length alone never do.
    return new Promise(resolve => { pendingCommit = { position: position as number, key, href, resolve } })
  }
  function claimBack(): number | undefined {
    if (backPending !== undefined) return undefined
    backPending = ++backSequence
    return backPending
  }
  function releaseBack(claim?: number): void {
    if (claim !== undefined && backPending !== claim) return
    backPending = undefined
    const waiting = pendingCommit
    pendingCommit = undefined
    waiting?.resolve({ entry: undefined, cancelled: true })
  }
  return { commit, snapshot, snapshotWhenCommitted, canBack, claimBack, releaseBack, hasMarker: () => marker() !== undefined }
}
`

export function buildReactApplicationNavigation(guards = false): string {
  return `import { useCallback, useEffect, useLayoutEffect${guards ? ', useRef' : ''} } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
${trackerSource}
const tracker = createTracker()
const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
export function ApplicationNavigationTracker() {
  const location = useLocation()
  const mode = useNavigationType()
  useCommitEffect(() => {
    tracker.commit(window.history.state?.idx, location.pathname + location.search + location.hash, location.key, mode)
  }, [location, mode])
  useCommitEffect(() => () => { tracker.releaseBack() }, [])
  return null
}
export function useApplicationBack() {
  const navigate = useNavigate()
${
  guards
    ? `  const location = useLocation(), origin = location.pathname + location.search + location.hash
  const active = useRef(false), latest = useRef(origin)
  latest.current = origin
  useCommitEffect(() => { active.current = true; return () => { active.current = false } }, [])
`
    : ''
}  return useCallback(async (fallback: string): Promise<void> => {
${guards ? '    if (!active.current || latest.current !== origin) return\n' : ''}    if (typeof window === 'undefined' || !internalFallback(fallback)) return
    const claim = tracker.claimBack()
    if (claim === undefined) return
    let dispatched = false
    try {
      let entry = tracker.snapshot()
      if (!entry) {
        const state = window.history.state
        const settled = await tracker.snapshotWhenCommitted(state?.idx, state?.key, window.location.href)
        if (settled.cancelled) return
        entry = settled.entry
      }
      await (window as Window & { __OPENPENCIL_MOTION_RUNTIME__?: { pageExit?: () => Promise<void> } }).__OPENPENCIL_MOTION_RUNTIME__?.pageExit?.()
${guards ? '      if (!active.current || latest.current !== origin) return\n' : ''}      if (tracker.snapshot() !== entry) return
      if (entry && tracker.canBack(entry)) navigate(-1)
      else navigate(fallback, { replace: true })
      dispatched = true
    } finally { if (!dispatched) tracker.releaseBack(claim) }
  }, [navigate${guards ? ', origin' : ''}])
}
${guards ? 'export function releaseApplicationBack(): void { tracker.releaseBack() }\n' : ''}`
}

export function buildVueApplicationNavigation(guards = false): string {
  return `import type { Router } from 'vue-router'
${trackerSource}
const trackers = new WeakMap<Router, ReturnType<typeof createTracker>>()
export function installApplicationNavigation(router: Router): () => void {
  const tracker = createTracker()
  trackers.set(router, tracker)
  let position: number | undefined
  const commit = () => {
    if (typeof window === 'undefined') return
    const state = window.history.state
    const next = state?.position
    const mode = position === undefined ? 'POP' : next === position ? 'REPLACE'
      : tracker.hasMarker() ? 'POP' : next > position ? 'PUSH' : 'POP'
    tracker.commit(next, router.currentRoute.value.fullPath, '', mode)
    if (Number.isSafeInteger(next)) position = next
  }
  const remove = router.afterEach((_to, _from, failure) => { if (!failure) commit() })
  void router.isReady().then(commit)
  return () => { remove(); if (trackers.get(router) === tracker) trackers.delete(router) }
}
export function createApplicationBack(router: Router) {
  return async (fallback: string): Promise<void> => {
    if (typeof window === 'undefined' || !internalFallback(fallback)) return
    const tracker = trackers.get(router)
    const entry = tracker?.snapshot()
    if (tracker && !tracker.claimBack()) return
    try {
      if (entry && tracker?.canBack(entry)) router.back()
      else await router.replace(fallback)
    } catch (error) { tracker?.releaseBack(); throw error }
  }
}
${guards ? 'export function releaseApplicationBack(router: Router): void { trackers.get(router)?.releaseBack() }\n' : ''}`
}
