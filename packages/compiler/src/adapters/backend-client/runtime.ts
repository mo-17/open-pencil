import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { buildBackendCommandRuntime } from './commands'

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
          policy.operations.includes('select')
      )
    )
    .map((resource) => resource.id)
  return `import { createNestJSClient${hasCommands ? ', BackendCommandError, commandError, normalizeCommandParameters, validCommandKey' : ''} } from './lowcode-backend-api'
${hasCommands ? "import { readCommandJournal, createCommandJournal, acknowledgeCommandJournal, withCommandJournalLock, type CommandJournalRecord } from './lowcode-backend-command-journal'" : ''}
import { initialize, getSession, subscribe, signIn, signOut, getAccessToken } from './lowcode-backend-auth'
import { setDocState${hasCommands ? ', ' + (stateModule === './lowcode-state' ? 'getDocState' : 'getDocStateSnapshot') + ' as readBackendState' : ''} } from ${JSON.stringify(stateModule)}
export { getSession, subscribe, signIn, signOut }
export interface BackendRequestInput {
  resourceId: keyof BackendResourceRows
  operation: 'list' | 'read' | 'create' | 'update' | 'delete'
  id?: string
  payload?: object
  limit?: number
  after?: string
  filter?: Record<string, string | number | boolean | null>
  q?: string
  sort?: string
  direction?: 'asc' | 'desc'
  /** Generated read-action destination scope, used only to cancel superseded local requests. */
  queryKey?: string
}
export interface BackendResourceRows { ${rowTypes} }
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
    const next = JSON.stringify([input.resourceId, input.limit ?? null,
      Object.entries(input.filter ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      input.q ?? null, input.sort ?? null, input.direction ?? null])
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
function publish(resource?: string): void { for (const listener of listeners) listener(resource) }
function syncSession(): void {
  for (const controller of requests) controller.abort()
  queryActions.clear()
  const session = getSession()
  if (session.signedIn) { initializationAlert?.remove(); initializationAlert = undefined }
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
      initializationAlert = document.createElement('p')
      initializationAlert.setAttribute('role', 'alert')
      initializationAlert.setAttribute('data-openpencil-auth-error', '')
      initializationAlert.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;margin:0;padding:12px;background:#fff3f3;color:#7f1d1d;font:16px sans-serif'
      initializationAlert.textContent = 'Sign-in could not be completed. Please try again.'
      document.body.prepend(initializationAlert)
    }
    syncSession()
  })()
}
async function dispatch(input: BackendRequestInput, signal: AbortSignal): Promise<unknown> {
  const client = createNestJSClient({
    baseUrl: ${JSON.stringify(client.apiBasePath)}, getAccessToken: async () => getSession().signedIn ? getAccessToken() : null,
    fetch: (url, init) => fetch(url, { ...init, signal })
  })
  ${dispatch ? `switch (input.resourceId) { ${dispatch} }` : ''}
  throw new Error('Backend operation is unavailable.')
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
  } catch {
    if (!current()) return { current: false }
    throw new Error('Backend request failed.')
  } finally {
    requests.delete(controller); signal?.removeEventListener('abort', abort)
    if (queryKey && queryActions.get(queryKey) === controller) queryActions.delete(queryKey)
  }
}
${buildBackendCommandRuntime(application)}
/** Each list has its own epoch; neither old queries nor old sessions may publish rows. */
export function watchBackendResource<K extends keyof BackendResourceRows>(input: BackendRequestInput & { resourceId: K; operation: 'list' }, rows: (value: BackendResourceRows[K][]) => void, cursor?: (value: string) => void, error?: (value: string) => void): () => void {
  let active = true
  let epoch = 0
  let request: AbortController | undefined
  const refresh: Listener = (resource) => {
    if (resource !== undefined && resource !== input.resourceId) return
    const current = ++epoch
    request?.abort()
    rows([]); cursor?.(''); error?.('')
    const session = getSession()
    if (!session.ready || (!session.signedIn && !isPublicRead(input))) return
    request = new AbortController()
    void backendRequest(input, request.signal).then((result) => {
      if (!active || current !== epoch || !result.current) return
      rows(result.data as BackendResourceRows[K][]); cursor?.(result.cursor)
    }).catch(() => {
      if (active && current === epoch) error?.('Backend request failed.')
    })
  }
  listeners.add(refresh)
  refresh()
  return () => { active = false; epoch++; request?.abort(); listeners.delete(refresh) }
}
`
}

function requestArguments(operation: string, method: string): string {
  if (operation === 'list')
    return `{ limit: input.limit, after: input.after, filter: input.filter, q: input.q, sort: input.sort, direction: input.direction } as Parameters<typeof ${method}>[0]`
  if (operation === 'read' || operation === 'delete') return 'input.id!'
  if (operation === 'create') return `input.payload as Parameters<typeof ${method}>[0]`
  return `input.id!, input.payload as Parameters<typeof ${method}>[1]`
}
