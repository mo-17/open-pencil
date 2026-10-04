export const applicationNavigationFile = 'src/_application_navigation.ts'

const trackerSource = `
const markerKey = '__openpencil_application_nav'
type Entry = { session: string; position: number; href: string; key: string }
function internalFallback(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !/[\\\\\\x00-\\x1f\\x7f]/.test(value)
    && !value.split(/[?#]/, 1)[0].split('/').some(segment => segment.startsWith(':') || segment.includes('*'))
}
function createTracker() {
  const session = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : String(Date.now()) + ':' + String(Math.random())
  const entries = new Map<number, Entry>()
  let current: Entry | undefined
  let backPending = false
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
    if (current && mode === 'POP' && (!previous || !marked || marked.position !== index
      || previous.href !== href || previous.key !== key || marked.href !== href || marked.key !== key)) {
      entries.clear()
    }
    if (mode === 'PUSH') for (const indexKey of entries.keys()) if (indexKey >= index) entries.delete(indexKey)
    const entry = { session, position: index, href, key }
    entries.set(index, entry)
    current = entry
    backPending = false
    if (!marked || marked.position !== index || marked.href !== href || marked.key !== key)
      window.history.replaceState({ ...window.history.state, [markerKey]: entry }, '', window.location.href)
  }
  function snapshot(): Entry | undefined {
    const value = marker()
    return current && value && value.position === current.position && value.href === current.href
      && value.key === current.key ? current : undefined
  }
  function canBack(entry: Entry): boolean {
    return snapshot() === entry && entries.has(entry.position - 1)
  }
  function claimBack(): boolean {
    if (backPending) return false
    backPending = true
    return true
  }
  function releaseBack(): void { backPending = false }
  return { commit, snapshot, canBack, claimBack, releaseBack, hasMarker: () => marker() !== undefined }
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
    const entry = tracker.snapshot()
    await (window as Window & { __OPENPENCIL_MOTION_RUNTIME__?: { pageExit?: () => Promise<void> } }).__OPENPENCIL_MOTION_RUNTIME__?.pageExit?.()
${guards ? '    if (!active.current || latest.current !== origin) return\n' : ''}    if (tracker.snapshot() !== entry || !tracker.claimBack()) return
    try {
      if (entry && tracker.canBack(entry)) navigate(-1)
      else navigate(fallback, { replace: true })
    } catch (error) { tracker.releaseBack(); throw error }
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
