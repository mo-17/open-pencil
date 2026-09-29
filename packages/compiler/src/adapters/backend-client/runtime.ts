import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { AUTH_NOTICE_SOURCE } from './auth-notice'
import { buildBackendCommandRuntime } from './commands'
import { BACKEND_LIST_RUNTIME_SOURCE } from './list-runtime'

/** One transport/session owner shared by generated React and Vue applications. */
export function buildBackendClientRuntime(
  application: BackendApplicationSpecV1,
  stateModule: string,
  loginPath = '/login'
): string {
  const client = application.httpApi?.browserClient
  const hasCommands = Boolean(application.commands?.commands.length)
  if (!client) throw new Error('Backend browser client is required.')
  const dispatch = (application.httpApi?.resources ?? [])
    .map((resource) => {
      const branch = resource.operations
        .map((operation) => {
          const method = `resource.${operation}`
          const args = requestArguments(operation, method)
          return `case ${JSON.stringify(operation)}: return ${method}(${args})`
        })
        .join('\n')
      return `case ${JSON.stringify(resource.id)}: { const resource = client[${JSON.stringify(resource.id)}]; switch (input.operation) { ${branch} } break }`
    })
    .join('\n')
  const rowTypes = (application.httpApi?.resources ?? [])
    .map(
      (resource, index) =>
        `${JSON.stringify(resource.id)}: import('./lowcode-backend-api').Resource${index}Row`
    )
    .join('; ')
  const publicResources = (application.httpApi?.resources ?? [])
    .filter((resource) =>
      application.auth.rowAccess.some(
        (policy) =>
          policy.entityId === resource.entityId &&
          policy.effect === 'allow' &&
          policy.principal.kind === 'anonymous' &&
          policy.operations.includes('select') &&
          (!resource.readPolicyIds || resource.readPolicyIds.includes(policy.id))
      )
    )
    .map((resource) => resource.id)
  return `import { createNestJSClient, NestJSAPIError${hasCommands ? ', BackendCommandError, commandError, normalizeCommandParameters, validCommandKey' : ''} } from './lowcode-backend-api'
${hasCommands ? "import { readCommandJournal, createCommandJournal, acknowledgeCommandJournal, withCommandJournalLock, type CommandJournalRecord } from './lowcode-backend-command-journal'" : ''}
import { initialize, getSession, subscribe, signIn, signOut, cancelSignIn, getAccessToken } from './lowcode-backend-auth'
import { setDocState${hasCommands ? ', ' + (stateModule === './lowcode-state' ? 'getDocState' : 'getDocStateSnapshot') + ' as readBackendState' : ''} } from ${JSON.stringify(stateModule)}
export { getSession, subscribe, signIn, signOut }
export interface BackendRequestInput {
  resourceId: keyof BackendResourceRows
  operation: 'list' | 'read' | 'create' | 'update' | 'delete'
  id?: string
  payload?: object
  limit?: number
  after?: string
  /** Document expressions are untrusted until the transport validates each filter value. */
  filter?: Record<string, unknown>
  q?: string
  sort?: string
  direction?: 'asc' | 'desc'
  /** Generated read-action destination scope, used only to cancel superseded local requests. */
  queryKey?: string
  /** Render snapshot for generated LIST subscriptions; never sent to the API. */
  sessionGeneration?: number
}
export interface BackendResourceRows { ${rowTypes} }
class BackendRequestFailure extends Error {
  constructor(readonly code: 'authentication-required' | 'forbidden' | 'request-failed') { super('Backend request failed.') }
}
export type BackendData<I extends BackendRequestInput> = I['operation'] extends 'list' ? BackendResourceRows[I['resourceId']][] : I['operation'] extends 'delete' ? { deleted: true } : BackendResourceRows[I['resourceId']]
export type BackendResult<T> = { current: false } | { current: true; data: T; cursor: string }
const publicResources: readonly string[] = ${JSON.stringify(publicResources)}
function isPublicRead(input: BackendRequestInput): boolean {
  return (input.operation === 'list' || input.operation === 'read') && publicResources.includes(input.resourceId)
}
/** A changed search/filter/sort starts at page one even before its old cursor state is cleared. */
export function createBackendQueryState(): <Input extends BackendRequestInput>(input: Input) => Input {
  let signature: string | undefined
  let discardedAfter: string | undefined
  let discarding = false
  return <Input extends BackendRequestInput>(input: Input): Input => {
    const next = listSignature({ ...input, after: undefined })
    if (signature !== undefined && signature !== next) {
      discardedAfter = input.after
      discarding = true
    } else if (discarding && input.after !== discardedAfter) discarding = false
    signature = next
    return discarding ? { ...input, after: undefined } : input
  }
}
type Listener = (resource?: string) => void
const listeners = new Set<Listener>()
const requests = new Set<AbortController>()
const queryActions = new Map<string, AbortController>()
type StateName = Parameters<typeof setDocState>[0]
type StateValue = Parameters<typeof setDocState>[1]
const privateState = new Map<StateName, StateValue>()
let stateGeneration = getSession().generation
let initialized = false
let initialization: Promise<void> | undefined
let initializationAlert: HTMLElement | undefined
${AUTH_NOTICE_SOURCE}
function publish(resource?: string): void { for (const listener of [...listeners]) listener(resource) }
function syncSession(): void {
  for (const controller of requests) controller.abort()
  queryActions.clear()
  const session = getSession()
  updateAuthenticationNotice(session.notice)
  if (stateGeneration !== session.generation) {
    stateGeneration = session.generation
    for (const [name, empty] of privateState) setDocState(name, structuredClone(empty))
    privateState.clear()
    ${hasCommands ? 'clearBackendCommands()' : ''}
  }
  setDocState('$currentUser', { id: session.id, email: session.email, signedIn: session.signedIn, ready: session.ready, generation: session.generation })
  publish()
}
export function isCurrentGeneration(generation: number): boolean { return getSession().generation === generation }
export function setBackendState(generation: number, name: StateName, value: StateValue, empty: StateValue): void {
  if (!isCurrentGeneration(generation)) return
  privateState.set(name, empty)
  setDocState(name, value)
}
export function initializeBackendClient(): Promise<void> {
  return initialization ??= (async () => {
    if (!initialized) { initialized = true; subscribe(syncSession) }
    try { await initialize() } catch {
      history.replaceState(null, '', ${JSON.stringify(loginPath)})
      updateAuthenticationNotice(getSession().notice ?? 'failed')
    }
    syncSession()
  })()
}
async function dispatch(input: BackendRequestInput, signal: AbortSignal): Promise<unknown> {
  const filter = input.operation === 'list' ? requestFilter(input.filter) : undefined
  const client = createNestJSClient({
    baseUrl: ${JSON.stringify(client.apiBasePath)}, getAccessToken: async () => getSession().signedIn ? getAccessToken() : null,
    fetch: (url, init) => fetch(url, { ...init, signal })
  })
  ${dispatch ? `switch (input.resourceId) { ${dispatch} }` : ''}
  throw new Error('Backend operation is unavailable.')
}
function requestFilter(value: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid Backend filter.')
  const result: Record<string, string | number | boolean | null> = Object.create(null)
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry !== 'string' && typeof entry !== 'boolean' &&
        !(typeof entry === 'number' && Number.isFinite(entry))) throw new Error('Invalid Backend filter.')
    result[key] = entry
  }
  return result
}
export async function backendRequest<I extends BackendRequestInput>(input: I, signal?: AbortSignal): Promise<BackendResult<BackendData<I>>> {
  const session = getSession()
  if (!session.ready || (!session.signedIn && !isPublicRead(input))) throw new Error('Authentication required.')
  const generation = session.generation
  const controller = new AbortController()
  if (signal?.aborted) return { current: false }
  const queryKey = (input.operation === 'list' || input.operation === 'read') ? input.queryKey : undefined
  if (queryKey) { queryActions.get(queryKey)?.abort(); queryActions.set(queryKey, controller) }
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  requests.add(controller)
  const current = () => !controller.signal.aborted && getSession().generation === generation && (getSession().signedIn || isPublicRead(input))
  try {
    const result = await dispatch(input, controller.signal)
    if (!current()) return { current: false }
    if (input.operation === 'create' || input.operation === 'update' || input.operation === 'delete') publish(input.resourceId)
    if (input.operation === 'list') {
      const page = result as { data?: unknown; nextCursor?: unknown }
      if (!Array.isArray(page?.data) || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new Error('Invalid Backend response.')
      return { current: true, data: page.data as BackendData<I>, cursor: page.nextCursor ?? '' }
    }
    return { current: true, data: result as BackendData<I>, cursor: '' }
  } catch (cause) {
    if (!current()) return { current: false }
    const code = cause instanceof NestJSAPIError && cause.status === 401 ? 'authentication-required'
      : cause instanceof NestJSAPIError && cause.status === 403 ? 'forbidden' : 'request-failed'
    throw new BackendRequestFailure(code)
  } finally {
    requests.delete(controller); signal?.removeEventListener('abort', abort)
    if (queryKey && queryActions.get(queryKey) === controller) queryActions.delete(queryKey)
  }
}
${buildBackendCommandRuntime(application)}
${BACKEND_LIST_RUNTIME_SOURCE}
`
}

function requestArguments(operation: string, method: string): string {
  if (operation === 'list')
    return `{ limit: input.limit, after: input.after, filter, q: input.q, sort: input.sort, direction: input.direction } as Parameters<typeof ${method}>[0]`
  if (operation === 'read' || operation === 'delete') return 'input.id!'
  if (operation === 'create') return `input.payload as Parameters<typeof ${method}>[0]`
  return `input.id!, input.payload as Parameters<typeof ${method}>[1]`
}
