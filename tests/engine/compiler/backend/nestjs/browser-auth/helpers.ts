import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { emitBrowserAuthentication } from '#compiler/backend/nestjs/browser-auth'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSApplication } from '../helpers'

export function authenticationApplication() {
  const value = structuredClone(nestJSApplication())
  if (!value.httpApi) throw new Error('Expected HTTP application')
  value.httpApi.browserClient = {
    version: 1,
    apiBasePath: '/api',
    authentication: {
      kind: 'oidc-pkce',
      issuer: 'http://127.0.0.1:4010',
      clientId: 'notes-public-client',
      scopes: ['openid', 'email'],
      callbackPath: '/_openpencil/auth/callback'
    }
  }
  const result = parseBackendApplicationSpecV1(value)
  if (!result.ok) throw new Error('Expected normalized browser application')
  return result.value
}

export interface AuthenticationSnapshot {
  ready: boolean
  signedIn: boolean
  id: string | null
  email: string | null
  generation: number
}
interface AuthenticationRuntime {
  requestBodyForTest(value: Uint8Array | URLSearchParams): BodyInit | null | undefined
  initialize(): Promise<void>
  getSession(): AuthenticationSnapshot
  getSnapshot(): AuthenticationSnapshot
  subscribe(listener: () => void): () => void
  signIn(returnPath?: string): Promise<void>
  signOut(): Promise<void>
  getAccessToken(): Promise<string>
}
interface BrowserControl {
  storage: Map<string, string>
  navigate(value: string): void
  address(): string
  assigned(): string
  failStorage(): void
}
interface LibraryControl {
  calls: { discovery: number; grant: number }
  exchange: { subject: string; accessToken: string }
}

const BROWSER_SOURCE = String.raw`
export const storage = new Map()
let current = new URL('http://127.0.0.1:4173/login')
let target = ''
let broken = false
export function navigate(value) { current = new URL(value) }
export function address() { return current.href }
export function assigned() { return target }
export function failStorage() { broken = true }
export const window = {
  sessionStorage: {
    getItem(key) { if (broken) throw new Error('Private storage detail'); return storage.get(key) ?? null },
    setItem(key, value) { if (broken) throw new Error('Private storage detail'); storage.set(key, value) },
    removeItem(key) { if (broken) throw new Error('Private storage detail'); storage.delete(key) },
  },
  location: {
    get href() { return current.href }, get origin() { return current.origin },
    get hostname() { return current.hostname }, get pathname() { return current.pathname },
    assign(value) { target = value },
  },
  history: { replaceState(_state, _title, path) { current = new URL(path, current) } },
}
`

// Protocol crypto is deliberately absent in these lifetime tests. The separate isolated
// protocol suite runs the fixed real openid-client package and a signed local identity provider.
const LIBRARY_SOURCE = String.raw`
export const calls = { discovery: 0, grant: 0 }
export const exchange = { subject: '11111111-1111-4111-8111-111111111111', accessToken: 'header.payload.signature' }
export const customFetch = Symbol('customFetch')
export function None() {}
export function enableNonRepudiationChecks() {}
export function allowInsecureRequests() {}
export function randomPKCECodeVerifier() { return 'V'.repeat(43) }
export async function calculatePKCECodeChallenge() { return 'C'.repeat(43) }
export function randomState() { return 'S'.repeat(43) }
export function randomNonce() { return 'N'.repeat(43) }
export async function discovery(issuer) {
  calls.discovery++
  return { serverMetadata: () => ({ issuer: issuer.href.replace(/\/$/u, ''),
    authorization_endpoint: issuer.origin + '/authorize', token_endpoint: issuer.origin + '/token',
    jwks_uri: issuer.origin + '/jwks', code_challenge_methods_supported: ['S256'] }) }
}
export function buildAuthorizationUrl(config, parameters) {
  const url = new URL(config.serverMetadata().authorization_endpoint)
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
  return url
}
export async function authorizationCodeGrant() {
  calls.grant++
  return { token_type: 'Bearer', access_token: exchange.accessToken, id_token: 'different.identity.signature', expires_in: 3600,
    claims: () => ({ sub: exchange.subject, exp: Math.floor(Date.now() / 1000) + 3600, email: 'alice@example.test' }) }
}
`

export async function authenticationRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-auth-lifetime-'))
  const write = (name: string, content: string) =>
    writeFileSync(join(directory, name + '.ts'), content)
  const load = (name: string) => import(pathToFileURL(join(directory, name + '.ts')).href)
  write('browser', BROWSER_SOURCE)
  write('library', LIBRARY_SOURCE)
  const source = emitBrowserAuthentication(authenticationApplication()).replace(
    "import * as oidc from 'openid-client'",
    "import * as oidc from './library'\nimport { window } from './browser'"
  )
  write('initial', source + '\nexport const requestBodyForTest = requestBody\n')
  write('callback', source)
  try {
    const initial = (await load('initial')) as AuthenticationRuntime
    const callback = (await load('callback')) as AuthenticationRuntime
    const browser = (await load('browser')) as BrowserControl
    const library = (await load('library')) as LibraryControl
    return {
      initial,
      callback,
      browser,
      library,
      async start() {
        await initial.initialize()
        await initial.signIn('/notes?view=mine')
        const state = new URL(browser.assigned()).searchParams.get('state')
        browser.navigate(
          'http://127.0.0.1:4173/_openpencil/auth/callback?code=one-use&state=' + state
        )
      },
      async dispose() {
        await Promise.allSettled([initial.signOut(), callback.signOut()])
        rmSync(directory, { recursive: true, force: true })
      }
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
