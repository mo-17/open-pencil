import type { IRTree } from '#compiler/ir/types'

import { applicationSessionPages } from './emit'

export const APPLICATION_SESSION_FILE = 'src/lib/open-pencil-application-session.ts'

/** Session memory only. No persistence or DOM/form-value collection. */
export function applicationSessionRuntimeSource(
  irs: readonly IRTree[],
  expose = false,
  protectScrollIntent = false
): string {
  return `export type ApplicationPageKey = { pageId: string; pathname: string; search: string }
export type ApplicationPageSnapshot = { version: 1; entries: Array<ApplicationPageKey & { values: Record<string, unknown>; scroll: { x: number; y: number } }> }
type Entry = ApplicationPageSnapshot['entries'][number]
const declarations: Record<string, { retention?: string; states: Record<string, string> }> = ${JSON.stringify(Object.fromEntries(applicationSessionPages(irs).map((page) => [page.pageId, { retention: page.retention, states: page.states }])))}
const MAX_ENTRIES = 64, MAX_BYTES = 256 * 1024, MAX_VALUES = 4096
const entries = new Map<string, Entry>()
const listeners = new Set<(snapshot: ApplicationPageSnapshot) => void>()
const restored = new Set<() => void>()
let notifying = false, restoring = false, queued = false
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const field = Object.getOwnPropertyDescriptor(value, key)
    if (!field?.enumerable) return false
    return 'value' in field
  })
}
function portable(value: unknown, seen = new Set<object>(), budget = { count: 0 }, depth = 0): boolean {
  if (++budget.count > MAX_VALUES || depth > 32) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return value.length <= 65536
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  let valid = false
  if (Array.isArray(value)) {
    valid = Object.getPrototypeOf(value) === Array.prototype && Reflect.ownKeys(value).length === value.length + 1
    for (let index = 0; valid && index < value.length; index++) {
      const field = Object.getOwnPropertyDescriptor(value, String(index))
      valid = !!field?.enumerable && 'value' in field && portable(field.value, seen, budget, depth + 1)
    }
  } else if (record(value)) {
    valid = Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, field]) => key.length <= 128 && portable(field.value, seen, budget, depth + 1))
  }
  seen.delete(value)
  return valid
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
function estimatedBytes(value: unknown): number {
  const pending: unknown[] = [value]
  let total = 0
  while (pending.length) {
    const current = pending.pop()
    if (typeof current === 'string') total += current.length * 2
    else if (current === null || typeof current === 'boolean' || typeof current === 'number') total += 8
    else if (Array.isArray(current)) { total += current.length * 8; pending.push(...current) }
    else if (record(current)) {
      for (const [key, field] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
        total += key.length * 2 + 8
        pending.push(field.value)
      }
    } else return Infinity
    if (total + 1024 > MAX_BYTES) return total
  }
  return total
}
function withinPortableBudget(value: unknown): boolean {
  return portable(value) && estimatedBytes(value) + 1024 <= MAX_BYTES && bytes(value) + 1024 <= MAX_BYTES
}
function matches(type: string | undefined, value: unknown): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return record(value)
  return typeof value === type
}
function validKey(value: unknown): value is ApplicationPageKey & Record<string, unknown> {
  if (!record(value)) return false
  const { pageId, pathname, search } = value
  return typeof pageId === 'string' && Object.hasOwn(declarations, pageId) && declarations[pageId].retention === 'preserve' && typeof pathname === 'string' && pathname.startsWith('/') && !pathname.startsWith('//') && !/[?#\\\\\\s]/.test(pathname) && pathname.length <= 2048 && typeof search === 'string' && (search === '' || search.startsWith('?')) && !/[#\\r\\n]/.test(search) && pathname.length + search.length <= 2048
}
export function applicationPageKey(pageId: string, pathname: string, search: string): ApplicationPageKey { return { pageId, pathname, search } }
export function applicationPageKeyId(key: ApplicationPageKey): string { return JSON.stringify([key.pageId, key.pathname, key.search]) }
function ensure(key: ApplicationPageKey): Entry | null {
  if (!validKey(key)) return null
  const id = applicationPageKeyId(key)
  let entry = entries.get(id)
  if (!entry) entry = { ...key, values: {}, scroll: { x: 0, y: 0 } }
  entries.delete(id)
  entries.set(id, entry)
  return entry
}
function bound(): void {
  while (entries.size > MAX_ENTRIES || !withinPortableBudget(getSnapshot())) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}
function emit(): void {
  if (notifying || restoring) return
  notifying = true
  try { const snapshot = getSnapshot(); for (const listener of listeners) listener(snapshot) } finally { notifying = false }
}
function changed(): void {
  bound()
  if (queued) return
  queued = true
  queueMicrotask(() => { queued = false; emit() })
}
export function readApplicationState<T>(key: ApplicationPageKey, name: string, initial: T): T {
  const value = entries.get(applicationPageKeyId(key))?.values[name]
  return matches(declarations[key.pageId]?.states[name], value) ? value as T : initial
}
export function writeApplicationState(key: ApplicationPageKey, name: string, value: unknown): void {
  if (restoring) return
  const entry = ensure(key)
  if (!entry || !Object.hasOwn(declarations[key.pageId].states, name)) return
  if (matches(declarations[key.pageId].states[name], value) && withinPortableBudget(value)) {
    entry.values[name] = clone(value)
    // A single value can fit while its complete entry/envelope exceeds the wire budget.
    if (!withinPortableBudget({ version: 1, entries: [entry] })) delete entry.values[name]
  } else delete entry.values[name]
  changed()
}
export function observeApplicationRestore(listener: () => void): () => void {
  restored.add(listener)
  return () => { restored.delete(listener) }
}
export function getSnapshot(): ApplicationPageSnapshot {
  return { version: 1, entries: clone([...entries.values()]) }
}
export function restore(snapshot: unknown): void {
  if (!record(snapshot) || snapshot.version !== 1 || Object.keys(snapshot).sort().join(',') !== 'entries,version' || !withinPortableBudget(snapshot) || !Array.isArray(snapshot.entries) || snapshot.entries.length > MAX_ENTRIES) return
  const next = new Map<string, Entry>()
  for (const candidate of snapshot.entries) {
    if (!validKey(candidate) || Object.keys(candidate).sort().join(',') !== 'pageId,pathname,scroll,search,values' || !record(candidate.values) || !record(candidate.scroll) || Object.keys(candidate.scroll).sort().join(',') !== 'x,y') continue
    const x = candidate.scroll.x, y = candidate.scroll.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 10000000 || y > 10000000) continue
    const values: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(candidate.values)) if (Object.hasOwn(declarations[candidate.pageId].states, name) && matches(declarations[candidate.pageId].states[name], value)) values[name] = clone(value)
    const id = applicationPageKeyId(candidate)
    if (next.has(id)) return
    next.set(id, { pageId: candidate.pageId, pathname: candidate.pathname, search: candidate.search, values, scroll: { x, y } })
  }
  restoring = true
  try {
    entries.clear()
    for (const [id, entry] of next) entries.set(id, entry)
    for (const listener of restored) listener()
  } finally { restoring = false }
  emit()
}
export function subscribe(listener: (snapshot: ApplicationPageSnapshot) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function mountApplicationScroll(key: ApplicationPageKey, retention: 'preserve' | 'reset'): () => void {
  if (typeof window === 'undefined') return () => {}
  let frame = 0, active = true, applying = true${protectScrollIntent ? '\n  let initialX = window.scrollX, initialY = window.scrollY' : ''}
  const apply = () => {
    applying = true${protectScrollIntent ? '\n    initialX = window.scrollX; initialY = window.scrollY' : ''}
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (!active) return${protectScrollIntent ? '\n        if (window.scrollX !== initialX || window.scrollY !== initialY) { applying = false; save(); return }' : ''}
        const scroll = retention === 'preserve' ? entries.get(applicationPageKeyId(key))?.scroll : undefined
        window.scrollTo({ left: scroll?.x ?? 0, top: scroll?.y ?? 0, behavior: 'instant' })
        applying = false
      })
    })
  }
  const save = () => {
    if (applying || !active || retention !== 'preserve') return
    const entry = ensure(key)
    if (!entry) return
    entry.scroll = { x: Math.max(0, window.scrollX), y: Math.max(0, window.scrollY) }
    changed()
  }
  const remove = observeApplicationRestore(apply)
  const previous = window.history.scrollRestoration
  window.history.scrollRestoration = 'manual'
  window.addEventListener('scroll', save, { passive: true })
  apply()
  return () => { ${protectScrollIntent ? 'if (!applying || window.scrollX !== initialX || window.scrollY !== initialY) { applying = false; save() }; ' : ''}active = false; window.cancelAnimationFrame(frame); window.removeEventListener('scroll', save); remove(); window.history.scrollRestoration = previous }
}
${expose ? "declare global { interface OpenPencilPageSessionStore { getSnapshot(): unknown; restore(snapshot: unknown): void; subscribe(listener: (snapshot: unknown) => void): () => void } interface Window { __opPageSessionStore?: OpenPencilPageSessionStore } }\nif (typeof window !== 'undefined') { window.__opPageSessionStore = { getSnapshot, restore, subscribe }; window.dispatchEvent(new Event('op-pagesession-ready')) }\n" : ''}`
}
