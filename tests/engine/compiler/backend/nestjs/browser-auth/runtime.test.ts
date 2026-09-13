import { afterEach, describe, expect, test } from 'bun:test'

import {
  emitBrowserAuthentication,
  OPENID_CLIENT_VERSION
} from '#compiler/backend/nestjs/browser-auth'
import { Transpiler } from 'bun'

import { nestJSApplication } from '../helpers'
import { authenticationApplication, authenticationRuntime } from './helpers'

const fixtures: Awaited<ReturnType<typeof authenticationRuntime>>[] = []
const safeError = 'Sign-in could not be completed. Please try again.'
async function runtime() {
  const fixture = await authenticationRuntime()
  fixtures.push(fixture)
  return fixture
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})

describe('generated browser authentication boundary', () => {
  test('requires explicit browser configuration and emits deterministic valid TypeScript', () => {
    expect(() => emitBrowserAuthentication(nestJSApplication())).toThrow('reviewed browser client')
    const application = authenticationApplication()
    const source = emitBrowserAuthentication(application)
    expect(source).toBe(emitBrowserAuthentication(structuredClone(application)))
    expect(OPENID_CLIENT_VERSION).toBe('6.8.8')
    const scanned = new Transpiler({ loader: 'ts' }).scan(source)
    expect(scanned.imports).toEqual([{ path: 'openid-client', kind: 'import-statement' }])
    expect(scanned.exports).toEqual(
      expect.arrayContaining([
        'initialize',
        'getSession',
        'getSnapshot',
        'subscribe',
        'signIn',
        'signOut',
        'getAccessToken'
      ])
    )
    expect(source).not.toContain('DATABASE_URL')
    expect(source).not.toContain('process.env')
  })

  test('copies bounded shared-backed request bytes into a DOM-compatible ArrayBuffer', async () => {
    const { initial } = await runtime()
    const bytes = new Uint8Array(new SharedArrayBuffer(32768))
    bytes[0] = 17
    const body = initial.requestBodyForTest(bytes)
    expect(body).toBeInstanceOf(ArrayBuffer)
    if (!(body instanceof ArrayBuffer)) throw new Error('Expected detached request byte storage')
    expect(new Uint8Array(body)[0]).toBe(17)
    bytes[0] = 99
    expect(new Uint8Array(body)[0]).toBe(17)
    expect(() => initial.requestBodyForTest(new Uint8Array(32769))).toThrow(safeError)
    const form = new URLSearchParams({ code: 'synthetic' })
    expect(initial.requestBodyForTest(form)).toBe(form)
  })

  test('initialization is idempotent and signed-out startup performs no discovery', async () => {
    const { initial, library } = await runtime()
    const first = initial.initialize()
    expect(initial.initialize()).toBe(first)
    await first
    expect(library.calls).toEqual({ discovery: 0, grant: 0 })
    expect(initial.getSnapshot()).toBe(initial.getSession())
    expect(initial.getSession()).toMatchObject({ ready: true, signedIn: false, id: null })
    await expect(initial.getAccessToken()).rejects.toThrow(safeError)
  })

  test('callback consumes its pending transaction and removes protocol parameters', async () => {
    const fixture = await runtime()
    await fixture.start()
    const stored = [...fixture.browser.storage.values()][0]
    expect(stored).toContain('verifier')
    expect(stored).not.toContain('access_token')
    await fixture.callback.initialize()
    expect(fixture.browser.address()).toBe('http://127.0.0.1:4173/notes?view=mine')
    expect(fixture.browser.storage.size).toBe(0)
    const session = fixture.callback.getSession()
    expect(session).toMatchObject({
      ready: true,
      signedIn: true,
      id: '11111111-1111-4111-8111-111111111111'
    })
    expect(Object.isFrozen(session)).toBe(true)
    expect(JSON.stringify(session)).not.toContain(await fixture.callback.getAccessToken())
  })

  test.each(['extra-key', 'wrong-binding', 'oversized', 'expired', 'duplicate-state'])(
    'rejects %s before invoking the code exchange',
    async (kind) => {
      const fixture = await runtime()
      await fixture.start()
      const [key, text] = [...fixture.browser.storage][0]
      const value = JSON.parse(text)
      if (kind === 'extra-key') value.unreviewed = true
      if (kind === 'wrong-binding') value.binding += '-changed'
      if (kind === 'expired') {
        value.createdAt -= 600001
        value.expiresAt -= 600001
      }
      fixture.browser.storage.set(
        key,
        kind === 'oversized' ? 'x'.repeat(8193) : JSON.stringify(value)
      )
      if (kind === 'duplicate-state')
        fixture.browser.navigate(fixture.browser.address() + '&state=another')
      await expect(fixture.callback.initialize()).rejects.toThrow(safeError)
      expect(fixture.library.calls.grant).toBe(0)
      expect(fixture.browser.storage.size).toBe(0)
      expect(fixture.browser.address()).toBe('http://127.0.0.1:4173/_openpencil/auth/callback')
      expect(fixture.callback.getSession()).toMatchObject({ ready: true, signedIn: false })
    }
  )

  test.each(['subject', 'accessToken'] as const)(
    'validates %s before restoring the return path',
    async (field) => {
      const fixture = await runtime()
      await fixture.start()
      fixture.library.exchange[field] = 'invalid'
      await expect(fixture.callback.initialize()).rejects.toThrow(safeError)
      expect(fixture.browser.address()).toBe('http://127.0.0.1:4173/_openpencil/auth/callback')
      expect(fixture.callback.getSession().signedIn).toBe(false)
      await expect(fixture.callback.getAccessToken()).rejects.toThrow(safeError)
    }
  )

  test('a subscriber that signs out cannot leave a token installed after publication', async () => {
    const fixture = await runtime()
    await fixture.start()
    fixture.callback.subscribe(() => {
      if (fixture.callback.getSession().signedIn) void fixture.callback.signOut()
    })
    await fixture.callback.initialize()
    expect(fixture.callback.getSession().signedIn).toBe(false)
    await expect(fixture.callback.getAccessToken()).rejects.toThrow(safeError)
  })

  test('HTTP loopback issuers cannot be used from a public frontend origin', async () => {
    const fixture = await runtime()
    fixture.browser.navigate('https://notes.example/login')
    await expect(fixture.initial.signIn('/notes')).rejects.toThrow(safeError)
    expect(fixture.library.calls).toEqual({ discovery: 0, grant: 0 })
    expect(fixture.browser.storage.size).toBe(0)
  })

  test('a storage failure returns a fixed diagnostic without exposing private details', async () => {
    const fixture = await runtime()
    fixture.browser.failStorage()
    await expect(fixture.initial.signIn('/notes')).rejects.toThrow(safeError)
    expect(fixture.library.calls).toEqual({ discovery: 0, grant: 0 })
    expect(fixture.initial.getSession().signedIn).toBe(false)
  })
})
