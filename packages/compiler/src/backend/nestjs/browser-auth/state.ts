export const STATE_SOURCE = String.raw`
export interface AuthenticationSession {
  readonly ready: boolean
  readonly signedIn: boolean
  readonly id: string | null
  readonly email: string | null
  readonly generation: number
}

const listeners = new Set<() => void>()
let session: AuthenticationSession = Object.freeze({
  ready: false, signedIn: false, id: null, email: null, generation: 0,
})
let accessToken: string | undefined
let expiresAt = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let operation = new AbortController()
let initialization: Promise<void> | undefined

function failure(): Error { return new Error('Sign-in could not be completed. Please try again.') }

function publish(next: Omit<AuthenticationSession, 'generation'>): void {
  session = Object.freeze({ ...next, generation: session.generation + 1 })
  for (const listener of [...listeners]) {
    try { listener() } catch { /* A subscriber cannot change authentication results. */ }
  }
}

function clearSession(ready = true): void {
  operation.abort()
  operation = new AbortController()
  accessToken = undefined
  expiresAt = 0
  if (expiryTimer !== undefined) clearTimeout(expiryTimer)
  expiryTimer = undefined
  publish({ ready, signedIn: false, id: null, email: null })
}

function assertCurrent(generation: number): void {
  if (generation !== session.generation || operation.signal.aborted) throw failure()
}

function expire(): void {
  if (session.signedIn && Date.now() >= expiresAt) clearSession()
}

export function getSession(): AuthenticationSession { expire(); return session }
export const getSnapshot = getSession

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export async function getAccessToken(): Promise<string> {
  expire()
  if (!session.ready || !session.signedIn || !accessToken) throw failure()
  return accessToken
}

export async function signOut(): Promise<void> {
  clearSession()
  try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { throw failure() }
}

function localReturnPath(value: string | undefined): string {
  const input = value ?? '/'
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\') ||
      input.length > 2048 || /[\u0000-\u0020\u007f]/u.test(input)) throw failure()
  const url = new URL(input, window.location.origin)
  if (url.origin !== window.location.origin || url.pathname === CONFIG.authentication.callbackPath ||
      url.hash || url.username || url.password) throw failure()
  return url.pathname + url.search
}

function redirectURI(): string {
  return new URL(CONFIG.authentication.callbackPath, window.location.origin).href
}

interface LoginTransaction {
  readonly version: 1
  readonly binding: string
  readonly state: string
  readonly nonce: string
  readonly verifier: string
  readonly redirectURI: string
  readonly returnPath: string
  readonly createdAt: number
  readonly expiresAt: number
}

function storeTransaction(value: LoginTransaction): void {
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).byteLength > 8192) throw failure()
  window.sessionStorage.setItem(STORAGE_KEY, text)
}

function consumeTransaction(): LoginTransaction {
  const text = window.sessionStorage.getItem(STORAGE_KEY)
  window.sessionStorage.removeItem(STORAGE_KEY)
  if (!text || text.length > 8192 || new TextEncoder().encode(text).byteLength > 8192) throw failure()
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure()
  const keys = ['version', 'binding', 'state', 'nonce', 'verifier', 'redirectURI', 'returnPath', 'createdAt', 'expiresAt']
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw failure()
  const item = value as LoginTransaction
  const now = Date.now()
  if (item.version !== 1 || item.binding !== BINDING || item.redirectURI !== redirectURI() ||
      ![item.state, item.nonce, item.verifier].every((entry) => typeof entry === 'string' && /^[A-Za-z0-9_-]{43,128}$/u.test(entry)) ||
      !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.expiresAt) ||
      item.createdAt > now || item.expiresAt - item.createdAt !== TRANSACTION_AGE || now >= item.expiresAt ||
      typeof item.returnPath !== 'string' || localReturnPath(item.returnPath) !== item.returnPath) throw failure()
  return item
}
`
