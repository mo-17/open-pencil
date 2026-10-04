import type { BackAction, NavigateAction } from '@open-pencil/scene-graph'

type NavigationAction = NavigateAction | BackAction

/** Switching history behavior preserves the existing route and expression bindings. */
export function navigationOperation(
  action: NavigationAction,
  operation: string
): NavigationAction | undefined {
  if (operation === 'back') {
    return { id: action.id, kind: 'back', fallback: action.kind === 'back' ? action.fallback : '/' }
  }
  if (operation !== 'push' && operation !== 'replace') return undefined
  const next: NavigateAction =
    action.kind === 'navigate'
      ? structuredClone(action)
      : { id: action.id, kind: 'navigate', to: action.fallback }
  if (operation === 'replace') next.history = 'replace'
  else delete next.history
  return next
}

export function navigationTarget(action: NavigationAction, target: string): NavigationAction {
  const next = structuredClone(action)
  if (next.kind === 'back') next.fallback = target
  else next.to = target
  return next
}
