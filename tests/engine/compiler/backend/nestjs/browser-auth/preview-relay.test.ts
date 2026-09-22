import { afterEach, describe, expect, test } from 'bun:test'

import { emitBrowserAuthentication } from '#compiler/backend/nestjs/browser-auth'
import { Transpiler } from 'bun'

import { authenticationApplication, authenticationRuntime } from './helpers'

const fixtures: Awaited<ReturnType<typeof authenticationRuntime>>[] = []
const requestId = 'R'.repeat(43)
const pollToken = 'P'.repeat(43)
const callback =
  'http://127.0.0.1:5181/_openpencil/auth/callback?code=one-use&state=' + 'S'.repeat(43)
const safeError = 'Sign-in could not be completed. Please try again.'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })

async function runtime() {
  const fixture = await authenticationRuntime(true)
  fixtures.push(fixture)
  fixture.browser.embed()
  fixture.browser.setFetch(async (_url, init) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 })
    if (init.body) return json({ requestId, pollToken }, 201)
    return json({ callbackURL: callback })
  })
  return fixture
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})

describe('embedded connected-preview authentication', () => {
  test('standalone output has no relay while connected output remains valid TypeScript', () => {
    const application = authenticationApplication()
    expect(emitBrowserAuthentication(application)).not.toContain('/_openpencil/preview-auth')
    const source = emitBrowserAuthentication(application, { previewRelay: true })
    expect(new Transpiler({ loader: 'ts' }).scan(source).imports).toEqual([
      { path: 'openid-client', kind: 'import-statement' }
    ])
  })

  test('returns browser authentication to the iframe without exposing protocol material to its parent', async () => {
    const { initial, browser, library } = await runtime()
    await initial.signIn('/notes?view=mine')
    expect(initial.getSession().signedIn).toBe(true)
    expect(await initial.getAccessToken()).toBe('header.payload.signature')
    expect(browser.assigned()).toBe('')
    expect(browser.address()).toBe('http://127.0.0.1:5181/notes?view=mine')
    expect(browser.events.filter((event) => event === 'popstate')).toHaveLength(1)
    expect(browser.storage.size).toBe(0)
    expect(browser.messages).toEqual([
      {
        origin: 'tauri://localhost',
        value: {
          type: 'openpencil:local-backend-sign-in',
          version: 1,
          channel: 'channel-1234567890',
          requestId
        }
      }
    ])
    expect(library.calls.grant).toBe(1)
    expect(browser.requests.at(-1)?.init.method).toBe('DELETE')
    expect(browser.requests[0].init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store'
    })
    expect(JSON.parse(String(browser.requests[0].init.body))).toEqual({
      authorizationURL: expect.stringContaining('code_challenge=')
    })
    expect(browser.requests[1].init.headers).toEqual({ authorization: 'Bearer ' + pollToken })
  })

  test('uses the regular full-page flow when a connected preview is opened directly', async () => {
    const fixture = await authenticationRuntime(true)
    fixtures.push(fixture)
    await fixture.initial.signIn('/notes')
    expect(fixture.browser.assigned()).toStartWith('http://127.0.0.1:4010/authorize?')
    expect(fixture.browser.requests).toHaveLength(0)
  })

  test('an explicit browser-open failure revokes the relay and its pending transaction', async () => {
    const { initial, browser, library } = await runtime()
    browser.embed(false)
    await expect(initial.signIn('/notes')).rejects.toThrow(safeError)
    expect(initial.getSession().notice).toBe('browser-unavailable')
    expect(browser.requests.map((request) => request.init.method)).toEqual(['POST', 'DELETE'])
    expect(library.calls.grant).toBe(0)
    expect(browser.storage.size).toBe(0)
    expect(initial.getSession().signedIn).toBe(false)
  })

  test.each(['origin', 'state', 'duplicate-code', 'oversized'])(
    'rejects a malformed %s callback before exchange',
    async (kind) => {
      const { initial, browser, library } = await runtime()
      let callbackURL = callback
      if (kind === 'origin') callbackURL = callback.replace('127.0.0.1:5181', 'example.test')
      if (kind === 'state') callbackURL = callback.replace('S'.repeat(43), 'X'.repeat(43))
      if (kind === 'duplicate-code') callbackURL += '&code=another'
      if (kind === 'oversized') callbackURL += '&padding=' + 'x'.repeat(16384)
      browser.setFetch(async (_url, init) => {
        if (init.method === 'DELETE') return new Response(null, { status: 204 })
        return init.body ? json({ requestId, pollToken }, 201) : json({ callbackURL })
      })
      await expect(initial.signIn('/notes')).rejects.toThrow(safeError)
      expect(library.calls.grant).toBe(0)
      expect(browser.storage.size).toBe(0)
      expect(browser.requests.at(-1)?.init.method).toBe('DELETE')
      expect(browser.events).not.toContain('popstate')
    }
  )

  test.each(['sign-out', 'pagehide', 'cancel'])(
    '%s cancels pending polling and prevents late identity publication',
    async (cause) => {
      const { initial, browser, library } = await runtime()
      let polling: (() => void) | undefined
      const started = new Promise<void>((resolve) => {
        polling = resolve
      })
      browser.setFetch(async (_url, init) => {
        if (init.method === 'DELETE') return new Response(null, { status: 204 })
        if (init.body) return json({ requestId, pollToken }, 201)
        polling?.()
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), {
            once: true
          })
        })
      })
      const login = initial.signIn('/notes')
      const result = login.then(
        () => null,
        (error: unknown) => error
      )
      await started
      if (cause === 'sign-out') await initial.signOut()
      else if (cause === 'cancel') initial.cancelSignIn()
      else browser.leave()
      if (cause === 'cancel') expect(initial.getSession().notice).toBe('cancelled')
      expect(await result).toMatchObject({ message: safeError })
      expect(library.calls.grant).toBe(0)
      expect(initial.getSession().signedIn).toBe(false)
      expect(browser.storage.size).toBe(0)
      expect(browser.requests.at(-1)?.init.method).toBe('DELETE')
      expect(browser.events).not.toContain('popstate')
    }
  )

  test('rejects missing or privileged frame boot contexts without opening a browser', async () => {
    const { initial, browser } = await runtime()
    browser.frameName(
      JSON.stringify({
        protocol: 'open-pencil-preview-v2',
        channel: 'channel-1234567890',
        parentOrigin: 'tauri://localhost',
        transport: 'window',
        automation: true
      })
    )
    await expect(initial.signIn('/notes')).rejects.toThrow(safeError)
    expect(browser.messages).toHaveLength(0)
    expect(browser.requests).toHaveLength(0)
    expect(browser.storage.size).toBe(0)
  })
})
