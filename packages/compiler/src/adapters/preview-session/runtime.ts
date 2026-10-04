/** Self-contained preview transport; generated exports keep their own session store. */
export function buildPreviewPageSessionValidation(): string {
  return `
interface PageSessionEntry {
  pageId: string
  pathname: string
  search: string
  values: Record<string, unknown>
  scroll: { x: number; y: number }
}
interface PageSessionSnapshot { version: 1; entries: PageSessionEntry[] }
declare global {
  interface OpenPencilPageSessionStore {
    getSnapshot(): unknown
    restore(snapshot: unknown): void
    subscribe(listener: (snapshot: unknown) => void): () => void
  }
}
interface InboundPageSession {
  source: typeof INBOUND_SOURCE
  channel: string
  type: 'pageSession'
  snapshot: PageSessionSnapshot
}

function pageSessionDataOnly(value: unknown): boolean {
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  let count = 0
  while (pending.length) {
    const current = pending.pop()
    if (++count > MAX_DOC_STATE_VALUES) return false
    if (current === null || typeof current !== 'object') continue
    if (seen.has(current) || Object.getOwnPropertySymbols(current).length) return false
    seen.add(current)
    const array = Array.isArray(current)
    const prototype = Object.getPrototypeOf(current)
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false
    const fields = Object.getOwnPropertyDescriptors(current)
    if (array && Object.keys(fields).length !== current.length + 1) return false
    for (const [key, field] of Object.entries(fields)) {
      if (array && key === 'length') continue
      if (!field.enumerable || !Object.hasOwn(field, 'value')) return false
      pending.push(field.value)
    }
    if (array) {
      for (let index = 0; index < current.length; index++) {
        if (!Object.hasOwn(fields, String(index))) return false
      }
    }
  }
  return validDocStateValue(value) && new TextEncoder().encode(JSON.stringify(value)).byteLength + 1024 <= MAX_PORTABLE_MESSAGE_BYTES
}

function validPageSessionSnapshot(value: unknown): value is PageSessionSnapshot {
  if (!pageSessionDataOnly(value) || !isRecord(value) || !hasExactKeys(value, ['version', 'entries'])) return false
  if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 64) return false
  const keys = new Set<string>()
  for (const entry of value.entries) {
    if (!isRecord(entry) || !hasExactKeys(entry, ['pageId', 'pathname', 'search', 'values', 'scroll'])) return false
    if (typeof entry.pageId !== 'string' || !entry.pageId.length || entry.pageId.length > MAX_NODE_ID_LENGTH) return false
    if (!validRoute(entry.pathname) || /[?#]/.test(entry.pathname)) return false
    if (typeof entry.search !== 'string' || entry.search.length + entry.pathname.length > MAX_ROUTE_LENGTH) return false
    if (entry.search && !entry.search.startsWith('?')) return false
    if (entry.search.includes('#') || /[\\u0000-\\u001f\\u007f]/.test(entry.search)) return false
    if (!isRecord(entry.values) || !isRecord(entry.scroll) || !hasExactKeys(entry.scroll, ['x', 'y'])) return false
    if (Object.keys(entry.values).some(name => !name.length || name.length > MAX_DOC_STATE_NAME_LENGTH)) return false
    if (typeof entry.scroll.x !== 'number' || !Number.isFinite(entry.scroll.x) || entry.scroll.x < 0) return false
    if (typeof entry.scroll.y !== 'number' || !Number.isFinite(entry.scroll.y) || entry.scroll.y < 0) return false
    const key = JSON.stringify([entry.pageId, entry.pathname, entry.search])
    if (keys.has(key)) return false
    keys.add(key)
  }
  return true
}

function parsePageSessionInbound(value: Record<string, unknown>): InboundPageSession | null {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const fields = Object.getOwnPropertyDescriptors(value)
  if (!hasExactKeys(fields, ['source', 'channel', 'type', 'snapshot'])) return null
  if (Object.values(fields).some(field => !field.enumerable || !Object.hasOwn(field, 'value'))) return null
  return validPageSessionSnapshot(value.snapshot) ? value as unknown as InboundPageSession : null
}
`
}

export function buildPreviewPageSessionTransport(): string {
  return `
  let pageSessionInitialized = false
  let pendingPageSession: PageSessionSnapshot | null = null
  let suppressPageSessionOutbound = false
  let wiredPageSession: OpenPencilPageSessionStore | null = null

  function applyPageSession(store: OpenPencilPageSessionStore, snapshot: PageSessionSnapshot): void {
    suppressPageSessionOutbound = true
    try { store.restore(snapshot) } finally { suppressPageSessionOutbound = false }
    pageSessionInitialized = true
  }

  function wirePageSession(store: OpenPencilPageSessionStore): void {
    if (!MIRROR_DOCUMENT_STATE || wiredPageSession === store) return
    wiredPageSession = store
    store.subscribe(snapshot => {
      if (!pageSessionInitialized || suppressPageSessionOutbound || !validPageSessionSnapshot(snapshot)) return
      postToParent({ type: 'pageSession', snapshot })
    })
    if (pendingPageSession) {
      applyPageSession(store, pendingPageSession)
      pendingPageSession = null
    }
  }

  function restorePageSession(snapshot: PageSessionSnapshot): void {
    if (!MIRROR_DOCUMENT_STATE) return
    const store = window.__opPageSessionStore
    if (store) {
      wirePageSession(store)
      applyPageSession(store, snapshot)
    } else pendingPageSession = snapshot
  }

  if (window.__opPageSessionStore) wirePageSession(window.__opPageSessionStore)
  window.addEventListener('op-pagesession-ready', () => {
    if (window.__opPageSessionStore) wirePageSession(window.__opPageSessionStore)
  })
`
}
