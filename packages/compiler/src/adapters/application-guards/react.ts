import type { IRTree } from '#compiler/ir/types'

import { guardDocumentNames } from './emit'

export function reactApplicationGuardsSource(
  pages: readonly IRTree[],
  navigation: boolean,
  analytics: boolean
): string {
  const names = guardDocumentNames(pages)
  const docImport = names.length
    ? "import { useDocState, getDocStateSnapshot } from '../_lowcode_state'\n"
    : ''
  const entries = (hook: string) =>
    names.map((name) => `${JSON.stringify(name)}: ${hook}(${JSON.stringify(name)})`).join(', ')
  const trackerImports =
    (navigation
      ? "import { ApplicationNavigationTracker, releaseApplicationBack } from '../_application_navigation'\n"
      : '') +
    (analytics ? "import { LowcodeAnalyticsRouteTracker } from '../_lowcode_analytics'\n" : '')
  return `import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { Navigate, Outlet, matchRoutes, useBlocker, useLocation, useNavigate, type To, type NavigateOptions } from 'react-router-dom'
${docImport}${trackerImports}import { policies, routeScope, entryOutcome, registerLeave, allowLeave, leaveRequirement, dismissLeaveConfirmation, installUnloadGuard, subscribeGuardInputs, guardRevision, notifyGuardInputs, guardPreviewBootPending, releaseGuardPreviewBoot, type GuardScope } from '../lib/open-pencil-application-guards'
const useCommit = typeof window === 'undefined' ? useEffect : useLayoutEffect
function readDocuments(): GuardScope { return { ${entries('getDocStateSnapshot')} } }
function useDocuments(): GuardScope { return { ${entries('useDocState')} } }
function href(location: { pathname: string; search: string; hash: string }): string { return location.pathname + location.search + location.hash }
function currentRouteScope(value: string, pageId: string): GuardScope {
  const policy = policies.find((candidate) => candidate.pageId === pageId)
  return routeScope(value, policy ? matchRoutes([{ path: policy.route }], value)?.[0]?.params : {})
}
export function useApplicationGuardNavigate() {
  const navigate = useNavigate(), location = useLocation(), origin = href(location)
  const active = useRef(false), latest = useRef(origin)
  latest.current = origin
  useCommit(() => { active.current = true; return () => { active.current = false } }, [])
  return useCallback((to: To | number, options?: NavigateOptions) => {
    if (!active.current || latest.current !== origin) return
    return typeof to === 'number' ? navigate(to) : navigate(to, options)
  }, [navigate, origin])
}
function resolveEntry(value: string, documents: GuardScope): { href: string; allowed: boolean; waiting?: boolean } {
  const visited = new Set<string>()
  let next = value
  for (let count = 0; count < 64; count++) {
    const match = matchRoutes(policies.map((policy) => ({ path: policy.route, handle: policy })), next)?.[0]
    if (!match) return { href: next, allowed: false }
    if (visited.has(match.route.handle.pageId)) return { href: next, allowed: false }
    visited.add(match.route.handle.pageId)
    const result = entryOutcome(match.route.handle, { ...documents, ...routeScope(next, match.params) })
    if (result.allowed || result.waiting) return { href: next, ...result }
    if (!result.fallback) return { href: next, allowed: false }
    next = result.fallback
  }
  return { href: next, allowed: false }
}
export function ApplicationGuardPage({ pageId, children }: { pageId: string; children: ReactNode }) {
  const location = useLocation(), documents = useDocuments()
  useSyncExternalStore(subscribeGuardInputs, guardRevision, guardRevision)
  const current = href(location), result = resolveEntry(current, documents)
  const policy = policies.find((candidate) => candidate.pageId === pageId)
  const direct = policy && entryOutcome(policy, { ...documents, ...routeScope(current, matchRoutes([{ path: policy.route }], current)?.[0]?.params) })
  if (guardPreviewBootPending() || direct?.waiting) return <section aria-busy="true">Authentication required.</section>
  if (!direct?.allowed) {
    if (result.href !== current) return <Navigate to={result.href} replace />
    return <section data-openpencil-guard-unavailable>Page unavailable.</section>
  }
  return children
}
export function useApplicationLeave(pageId: string, read: () => GuardScope) {
  const location = useLocation(), latest = useRef(read), active = useRef(true), latestRoute = useRef(href(location))
  latest.current = read
  latestRoute.current = href(location)
  const owner = href(location).split('#')[0]
  useCommit(() => {
    active.current = true
    const remove = registerLeave(pageId, owner, () => ({ ...readDocuments(), ...currentRouteScope(latestRoute.current, pageId), ...latest.current() }), () => active.current)
    return () => { active.current = false; remove() }
  }, [pageId, owner])
  useCommit(() => { notifyGuardInputs() }, Object.values(read()))
}
export function ApplicationGuardLayout() {
  const location = useLocation(), navigate = useNavigate(), current = href(location)
  const latest = useRef(current), permit = useRef<string | undefined>(undefined)
  const committed = useRef<(() => void) | undefined>(undefined)
  const blockedConfirmation = useRef<AbortController | undefined>(undefined), blockVersion = useRef(0)
  latest.current = current
  useCommit(() => { committed.current?.(); committed.current = undefined }, [current])
  const documents = useDocuments()
  const revision = useSyncExternalStore(subscribeGuardInputs, guardRevision, guardRevision)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    blockVersion.current++
    blockedConfirmation.current?.abort()
    blockedConfirmation.current = undefined
    const from = href(currentLocation), to = href(nextLocation)
    if (permit.current === from + '\\n' + to) { permit.current = undefined; return false }
    const owner = resolveEntry(from, readDocuments())
    return owner.allowed && owner.href === from && Boolean(leaveRequirement(from, to))
  })
  const latestBlocker = useRef(blocker), blockedVersion = blockVersion.current
  useCommit(() => { latestBlocker.current = blocker }, [blocker])
  const target = blocker.state === 'blocked' ? href(blocker.location) : undefined
  useEffect(() => {
    if (blocker.state !== 'blocked' || !target || latestBlocker.current !== blocker || blockVersion.current !== blockedVersion || latest.current !== current) return
    const documents = readDocuments(), owner = resolveEntry(current, documents), entry = resolveEntry(target, documents)
    if (!owner.allowed || owner.href !== current || (!entry.allowed && !entry.waiting) || entry.href !== target) { blocker.reset(); ${navigation ? 'releaseApplicationBack()' : ''}; return }
    const controller = new AbortController(), origin = current
    blockedConfirmation.current = controller
    void allowLeave(origin, target, controller.signal).then((accepted) => {
      if (controller.signal.aborted || latest.current !== origin || latestBlocker.current !== blocker || blockVersion.current !== blockedVersion) return
      const documents = readDocuments(), owner = resolveEntry(origin, documents), fresh = resolveEntry(target, documents)
      if (accepted && owner.allowed && owner.href === origin && (fresh.allowed || fresh.waiting) && fresh.href === target) blocker.proceed()
      else { blocker.reset(); ${navigation ? 'releaseApplicationBack()' : ''} }
    })
    return () => { controller.abort(); if (blockedConfirmation.current === controller) blockedConfirmation.current = undefined }
  }, [blocker, blockedVersion, target, current, revision, ...Object.values(documents)])
  useEffect(() => installUnloadGuard(() => latest.current), [])
  useCommit(() => {
    let pending = false, confirmation: AbortController | undefined
    const guard: OpenPencilApplicationNavigationGuard = { cancelPending() { confirmation?.abort(); committed.current?.(); dismissLeaveConfirmation() }, async requestRoute(route, replace = false) {
      if (pending || !route.startsWith('/') || route.startsWith('//')) return false
      pending = true
      const abort = new AbortController()
      confirmation = abort
      const origin = latest.current
      try {
        releaseGuardPreviewBoot()
        const entry = resolveEntry(route, readDocuments())
        if (!entry.allowed && !entry.waiting) return false
        const target = entry.href
        if (origin === target) return target === route
        const owner = resolveEntry(origin, readDocuments())
        if (owner.allowed && owner.href === origin && !await allowLeave(origin, target, abort.signal)) return false
        if (latest.current !== origin || abort.signal.aborted) return false
        const fresh = resolveEntry(target, readDocuments())
        if ((!fresh.allowed && !fresh.waiting) || fresh.href !== target) return false
        permit.current = origin + '\\n' + target
        const commit = new Promise<void>((resolve) => { committed.current = resolve })
        await navigate(target, { replace })
        if (latest.current === origin) await commit
        return !abort.signal.aborted && latest.current === route
      } finally { pending = false; permit.current = undefined; committed.current = undefined; confirmation = undefined }
    } }
    window.__opApplicationNavigationGuard = guard
    window.dispatchEvent(new Event('op-application-guards-ready'))
    return () => { confirmation?.abort(); committed.current?.(); if (window.__opApplicationNavigationGuard === guard) delete window.__opApplicationNavigationGuard; dismissLeaveConfirmation() }
  }, [navigate])
  return <>{${navigation ? '<ApplicationNavigationTracker />' : 'null'}}{${analytics ? '<LowcodeAnalyticsRouteTracker />' : 'null'}}<Outlet /></>
}
`
}
