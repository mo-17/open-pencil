import type { ActionDef, StateDef } from '@open-pencil/scene-graph'

import type { FormSubmissionOverview } from './types'

const REQUESTS: ReadonlySet<ActionDef['kind']> = new Set([
  'apiCall',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'backendRequest',
  'backendCommand',
  'backendCommandRecovery',
  'backendAuth',
  'invokeServerWorkflow',
  'stripeCheckout',
  'stripeCustomerPortal'
])

/** Reports authored branches only. It does not infer request success or safe error-side effects. */
export function inspectFormSubmission(
  actions: readonly ActionDef[],
  documentStates: readonly StateDef[]
): FormSubmissionOverview {
  const result: FormSubmissionOverview = {
    actions: actions.length,
    requests: 0,
    handled: 0,
    invalidTargets: 0,
    customFailure: false,
    workflow: false,
    truncated: false
  }
  const pending = actions.map((action, index) => ({ action, path: `onSubmit[${index}]` })).reverse()
  let visited = 0
  while (pending.length && visited++ < 200) {
    const item = pending.pop()
    if (!item) break
    const { action, path } = item
    if (action.kind === 'callWorkflow') result.workflow = true
    if (REQUESTS.has(action.kind)) inspectRequest(action, path, documentStates, result)
    for (const { key, branch } of actionBranches(action)) {
      for (let index = branch.length - 1; index >= 0; index--) {
        pending.push({ action: branch[index], path: `${path}/${key}[${index}]` })
      }
    }
  }
  result.truncated = pending.length > 0
  return result
}

function actionBranches(action: ActionDef): { key: string; branch: readonly ActionDef[] }[] {
  const branches: { key: string; branch: readonly ActionDef[] }[] = []
  if ('consequent' in action) branches.push({ key: 'consequent', branch: action.consequent })
  if ('alternate' in action && action.alternate)
    branches.push({ key: 'alternate', branch: action.alternate })
  if ('onSuccess' in action && action.onSuccess)
    branches.push({ key: 'onSuccess', branch: action.onSuccess })
  if ('onError' in action && action.onError)
    branches.push({ key: 'onError', branch: action.onError })
  return branches
}

function inspectRequest(
  action: ActionDef,
  path: string,
  documentStates: readonly StateDef[],
  result: FormSubmissionOverview
): void {
  result.requests++
  const branch = 'onError' in action && !!action.onError?.length
  const target = 'errorTarget' in action ? action.errorTarget : undefined
  const state = documentStates.find((entry) => entry.name === target)
  // Authenticated backend results have stricter non-persistent string targets.
  // Legacy request actions accept declared document state of any type.
  const backend = [
    'backendRequest',
    'backendCommand',
    'backendCommandRecovery',
    'backendAuth'
  ].includes(action.kind)
  const validTarget =
    !!state &&
    state.computedExpr === undefined &&
    (!backend || (state.type === 'string' && !state.persist))
  if (target && !validTarget) result.invalidTargets++
  if (branch || validTarget) result.handled++
  else setAttention(action, path, result)
  result.customFailure ||= branch
  if (target && !validTarget) setAttention(action, path, result)
}

function setAttention(action: ActionDef, path: string, result: FormSubmissionOverview): void {
  if (result.attentionPath) return
  result.attentionPath = path
  result.attentionActionId = action.id
}
