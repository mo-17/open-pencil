import type { IRTree } from '#compiler/ir/types'

import { emitStateDecl } from '../react/emit/state'
import { nodesHaveBackHandler } from '../react/ir-walk'

export const REACT_APPLICATION_SESSION_FILE = 'src/components/_open-pencil-application-session.tsx'

export function reactApplicationSessionSource(): string {
  return `import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useLocation } from 'react-router-dom'
import { applicationPageKey, applicationPageKeyId, mountApplicationScroll, observeApplicationRestore, readApplicationState, writeApplicationState } from '../lib/open-pencil-application-session'
const useSessionLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
export function OpenPencilApplicationPage({ pageId, retention, children }: { pageId: string; retention: 'reset' | 'preserve'; children: ReactNode }) {
  const location = useLocation()
  const key = applicationPageKey(pageId, location.pathname, location.search)
  const id = applicationPageKeyId(key)
  useSessionLayoutEffect(() => mountApplicationScroll(key, retention), [id, retention])
  return <Fragment key={id}>{children}</Fragment>
}
export function useApplicationPageState<T>(pageId: string, name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation()
  const key = applicationPageKey(pageId, location.pathname, location.search)
  const id = applicationPageKeyId(key)
  const [value, update] = useState<T>(() => readApplicationState(key, name, initial))
  const latest = useRef(value), active = useRef(true)
  latest.current = value
  useSessionLayoutEffect(() => {
    active.current = true
    const remove = observeApplicationRestore(() => { const next = readApplicationState(key, name, initial); latest.current = next; update(next) })
    return () => { active.current = false; remove() }
  }, [id, name])
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (!active.current) return
    const value = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next
    latest.current = value
    writeApplicationState(key, name, value)
    update(value)
  }, [id, name])
  return [value, setValue]
}
`
}

export function reactApplicationPageImports(ir: IRTree, prefix: string, router: boolean): string {
  const lines: string[] = []
  if (router && nodesHaveBackHandler(ir.children))
    lines.push(
      `import { useApplicationBack as __opUseApplicationBack } from '${prefix === './components/' ? './' : '../'}_application_navigation'\n`
    )
  if (ir.applicationStateRetention === 'preserve')
    lines.push(
      `import { useApplicationPageState as __opUseApplicationPageState } from '${prefix}_open-pencil-application-session'\n`
    )
  return lines.join('')
}

export function reactApplicationPageHooks(ir: IRTree, router: boolean): string {
  return router && nodesHaveBackHandler(ir.children)
    ? '  const __opBack = __opUseApplicationBack()'
    : ''
}

export function reactApplicationStateDeclarations(ir: IRTree): string {
  const pageId = ir.applicationStateRetention === 'preserve' ? ir.pageId : undefined
  return ir.states.map((state) => emitStateDecl(state, 1, pageId)).join('\n')
}
