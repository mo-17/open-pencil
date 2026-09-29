/** Shared React/Vue LIST lifetime. Caches belong to one mounted list, never document state. */
export const BACKEND_LIST_RUNTIME_SOURCE = `export interface BackendResourceState {
  phase: 'idle' | 'loading' | 'refreshing' | 'ready' | 'empty' | 'error'
  hasRows: boolean
  errorCode?: 'authentication-required' | 'forbidden' | 'request-failed'
}
interface BackendResourceCache<K extends keyof BackendResourceRows> {
  signature?: string
  generation?: number
  ready: boolean
  rows: BackendResourceRows[K][]
  cursor: string
}
export function createBackendResourceCache<K extends keyof BackendResourceRows>(): BackendResourceCache<K> {
  return { ready: false, rows: [], cursor: '' }
}
export interface BackendResourceSubscription { (): void; retry(): void }
function listSignature(input: BackendRequestInput): string | undefined {
  try {
    return JSON.stringify([input.resourceId, input.limit ?? null, input.after ?? null, input.sessionGeneration ?? null,
      Object.entries(requestFilter(input.filter) ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      input.q ?? null, input.sort ?? null, input.direction ?? null])
  } catch { return undefined }
}
/** An instance cache survives same-query effect rebinding, but not page unmount or identity changes. */
export function watchBackendResource<K extends keyof BackendResourceRows>(
  input: BackendRequestInput & { resourceId: K; operation: 'list' },
  rows: (value: BackendResourceRows[K][]) => void,
  cursor?: (value: string) => void,
  error?: (value: string) => void,
  state?: (value: BackendResourceState) => void,
  cache = createBackendResourceCache<K>()
): BackendResourceSubscription {
  let active = true
  let epoch = 0
  let request: AbortController | undefined
  const signature = listSignature(input)
  const clear = () => { cache.ready = false; cache.rows = []; cache.cursor = '' }
  const refresh: Listener = (resource) => {
    if (!active || (resource !== undefined && resource !== input.resourceId)) return
    const current = ++epoch
    request?.abort()
    const session = getSession()
    const valid = () => active && current === epoch && getSession().generation === session.generation
    const unavailable = !session.ready || (!session.signedIn && !isPublicRead(input))
    if (signature === undefined || cache.signature !== signature || cache.generation !== session.generation || unavailable) clear()
    cache.signature = signature; cache.generation = session.generation
    rows(cache.rows)
    if (!valid()) return
    cursor?.(cache.cursor)
    if (!valid()) return
    error?.('')
    if (!valid()) return
    // Generated inputs wait for the consumer to rebind its cleared identity-dependent expressions.
    if ((input.sessionGeneration !== undefined && input.sessionGeneration !== session.generation) ||
        unavailable) {
      state?.({ phase: 'idle', hasRows: false })
      return
    }
    state?.({ phase: cache.ready ? 'refreshing' : 'loading', hasRows: cache.rows.length > 0 })
    if (!valid()) return
    request = new AbortController()
    void backendRequest(input, request.signal).then((result) => {
      if (!valid() || !result.current) return
      cache.ready = true; cache.rows = result.data as BackendResourceRows[K][]; cache.cursor = result.cursor
      rows(cache.rows)
      if (!valid()) return
      cursor?.(cache.cursor)
      if (!valid()) return
      state?.({ phase: cache.rows.length ? 'ready' : 'empty', hasRows: cache.rows.length > 0 })
    }).catch((cause: unknown) => {
      if (!valid()) return
      const errorCode = cause instanceof BackendRequestFailure ? cause.code : 'request-failed'
      if (errorCode !== 'request-failed') {
        clear(); rows([])
        if (!valid()) return
        cursor?.('')
        if (!valid()) return
      }
      error?.('Backend request failed.')
      if (!valid()) return
      state?.({ phase: 'error', hasRows: cache.rows.length > 0, errorCode })
    })
  }
  listeners.add(refresh)
  refresh()
  const stop = () => { active = false; epoch++; request?.abort(); listeners.delete(refresh) }
  return Object.assign(stop, { retry: () => refresh() })
}
/** Fixed localized copy contains no server details, queries or identity values. */
export function backendResourceText(state: BackendResourceState): string {
  const zh = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh')
  if (state.phase === 'loading') return zh ? '正在加载…' : 'Loading…'
  if (state.phase === 'refreshing') return zh ? '正在刷新…' : 'Refreshing…'
  if (state.phase === 'empty') return zh ? '暂无数据' : 'No results'
  if (state.phase !== 'error') return ''
  if (state.errorCode === 'authentication-required') return zh ? '登录已失效，请重新登录后重试。' : 'Sign in again, then retry.'
  if (state.errorCode === 'forbidden') return zh ? '当前没有访问权限，请确认权限后重试。' : 'Access denied. Check your permissions, then retry.'
  if (state.hasRows) return zh ? '刷新失败，当前显示上次加载的数据。' : 'Refresh failed. Showing previously loaded data.'
  return zh ? '加载失败，请重试。' : 'Loading failed. Please retry.'
}
export function backendResourceRetryText(): string {
  return typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh') ? '重试' : 'Retry'
}
`
