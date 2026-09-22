import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

import { createPreviewAuthRelay } from '#compiler/local-backend-preview/auth-relay'
import { previewAuthCallbackURL } from '#compiler/local-backend-preview/auth-relay/validation'

const BASE = '/_openpencil/preview-auth'
const CALLBACK = '/_openpencil/auth/callback'
const cleanup: (() => Promise<void>)[] = []
type Ticket = { requestId: string; pollToken: string }

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()))
})

async function close(server: Server) {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

async function fixture() {
  let time = 1000
  let valid = true
  let checks = 0
  const server = createServer({ maxHeaderSize: 32 * 1024 }, (request, response) => {
    relay.middleware(request, response, () => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ordinary exported application')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not listen')
  const origin = `http://127.0.0.1:${address.port}`
  const relay = createPreviewAuthRelay({
    previewPort: address.port,
    now: () => time,
    async check() {
      checks++
      if (!valid) throw new Error('Sensitive backend details must not be returned')
    }
  })
  cleanup.push(async () => {
    relay.dispose()
    await close(server)
  })
  const authorization = (state = randomBytes(32).toString('base64url')) => {
    const url = new URL('https://identity.example.test/realms/preview/protocol/openid-connect/auth')
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: 'openpencil-preview',
      redirect_uri: origin + CALLBACK,
      scope: 'openid profile',
      state,
      nonce: randomBytes(32).toString('base64url'),
      code_challenge: randomBytes(32).toString('base64url'),
      code_challenge_method: 'S256'
    }))
      url.searchParams.set(key, value)
    return url
  }
  const begin = (url = authorization(), headers: Record<string, string> = {}) =>
    fetch(origin + BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...headers },
      body: JSON.stringify({ authorizationURL: url.href })
    })
  const register = async (url = authorization()): Promise<Ticket> => {
    const result = await begin(url)
    expect(result.status).toBe(201)
    return result.json() as Promise<Ticket>
  }
  const start = (ticket: Ticket, headers: Record<string, string> = {}) =>
    fetch(origin + BASE + '/start/' + ticket.requestId, {
      redirect: 'manual',
      headers
    })
  const poll = (ticket: Ticket, headers: Record<string, string> = {}) =>
    fetch(origin + BASE + '/result/' + ticket.requestId, {
      method: 'POST',
      headers: { origin, authorization: 'Bearer ' + ticket.pollToken, ...headers }
    })
  return {
    origin,
    authorization,
    begin,
    register,
    start,
    poll,
    advance: () => {
      time += 10 * 60 * 1000
    },
    revoke: () => {
      valid = false
    },
    checks: () => checks,
    dispose: relay.dispose
  }
}

describe('preview-only OIDC code relay over HTTP', () => {
  test('uses independent tickets, one-use browser start, secret-free callback page and one-use result', async () => {
    const f = await fixture()
    const authorization = f.authorization()
    authorization.searchParams.set('resource', 'https://api.example.test')
    const ticket = await f.register(authorization)
    expect(ticket.requestId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(ticket.pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(ticket.requestId).not.toBe(ticket.pollToken)
    expect((await f.poll(ticket)).status).toBe(202)
    const started = await f.start(ticket, {
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'cross-site'
    })
    expect(started.status).toBe(302)
    expect(started.headers.get('location')).toBe(authorization.href)
    expect(started.headers.get('cache-control')).toBe('no-store')
    expect(started.headers.get('referrer-policy')).toBe('no-referrer')
    expect((await f.start(ticket)).status).toBe(404)
    const callbackURL =
      f.origin +
      CALLBACK +
      '?' +
      new URLSearchParams({
        state: authorization.searchParams.get('state') ?? '',
        code: 'single-use-secret-code',
        iss: 'https://identity.example.test/realms/preview',
        session_state: 'session-meta'
      }).toString()
    const received = await fetch(callbackURL)
    expect(received.status).toBe(200)
    expect(received.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(received.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const html = await received.text()
    expect(html).toContain('Return to OpenPencil')
    expect(html).not.toContain('single-use-secret-code')
    expect(html).not.toContain(authorization.searchParams.get('state') ?? '')
    expect((await fetch(callbackURL)).status).toBe(409)
    const result = await f.poll(ticket)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.headers.get('access-control-allow-origin')).toBeNull()
    expect(await result.json()).toEqual({ callbackURL })
    expect((await f.poll(ticket)).status).toBe(404)
    expect(f.checks()).toBeGreaterThanOrEqual(5)
  })

  test('rejects cross-origin, opaque origins, host rebinding and cross-site requests before storing anything', async () => {
    const f = await fixture()
    const rejectedHeaders: Record<string, string>[] = [
      { origin: 'https://evil.example.test' },
      { origin: 'null' },
      { origin: f.origin + '/' },
      { host: 'evil.example.test' },
      { host: 'localhost:' + new URL(f.origin).port },
      { 'sec-fetch-site': 'cross-site' }
    ]
    for (const headers of rejectedHeaders) {
      const response = await f.begin(f.authorization(), headers)
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
    const response = await fetch(f.origin + BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(response.status).toBe(403)
    expect(f.checks()).toBe(0)
  })

  test('rejects malformed, duplicate, unsafe and secret-bearing authorization parameters', async () => {
    const f = await fixture()
    const mutations: ((url: URL) => void)[] = [
      (url) => {
        url.protocol = 'http:'
      },
      (url) => {
        url.username = 'user'
      },
      (url) => {
        url.hash = 'fragment'
      },
      (url) => url.searchParams.set('redirect_uri', 'https://evil.example.test/callback'),
      (url) => url.searchParams.set('redirect_uri', f.origin + '/wrong'),
      (url) => url.searchParams.set('response_type', 'token'),
      (url) => url.searchParams.append('state', 'z'.repeat(43)),
      (url) => url.searchParams.append('redirect_uri', f.origin + CALLBACK),
      (url) => url.searchParams.set('state', 'short'),
      (url) => url.searchParams.set('nonce', 'short'),
      (url) => url.searchParams.set('code_challenge', 'short'),
      (url) => url.searchParams.set('code_challenge_method', 'plain'),
      (url) => url.searchParams.set('scope', 'profile'),
      (url) => url.searchParams.set('client_id', 'x'.repeat(513)),
      (url) => url.searchParams.set('scope', 'openid\nprofile'),
      (url) => url.searchParams.set('client_secret', 'never relay secrets'),
      (url) => url.searchParams.set('code_verifier', 'never relay PKCE verifiers'),
      (url) => url.searchParams.set('access_token', 'never relay access tokens'),
      (url) => url.searchParams.set('resource', 'x'.repeat(16 * 1024))
    ]
    for (const mutate of mutations) {
      const url = f.authorization()
      mutate(url)
      expect((await f.begin(url)).status).toBe(400)
    }
    expect(f.checks()).toBe(0)
  })

  test('accepts literal loopback HTTP identity services only and never fetches them', async () => {
    const f = await fixture()
    for (const hostname of ['127.0.0.1', '[::1]']) {
      const url = f.authorization()
      url.protocol = 'http:'
      url.hostname = hostname
      url.port = '9'
      const ticket = await f.register(url)
      expect((await f.start(ticket)).headers.get('location')).toBe(url.href)
    }
    const url = f.authorization()
    url.protocol = 'http:'
    url.hostname = 'localhost'
    expect((await f.begin(url)).status).toBe(400)
  })

  test('requires the distinct poll token and same origin, and supports cancellation', async () => {
    const f = await fixture()
    const ticket = await f.register()
    expect((await f.poll({ ...ticket, pollToken: ticket.requestId })).status).toBe(404)
    expect((await f.poll(ticket, { authorization: '' })).status).toBe(404)
    expect((await f.poll(ticket, { origin: 'https://evil.example.test' })).status).toBe(403)
    const cancel = await fetch(f.origin + BASE + '/' + ticket.requestId, {
      method: 'DELETE',
      headers: { origin: f.origin, authorization: 'Bearer ' + ticket.pollToken }
    })
    expect(cancel.status).toBe(204)
    expect((await f.poll(ticket)).status).toBe(404)
    expect((await f.start(ticket)).status).toBe(404)
  })

  test('bounds pending sessions, rejects reused states and prunes expired sessions', async () => {
    const f = await fixture()
    const url = f.authorization()
    const first = await f.register(url)
    expect((await f.begin(url)).status).toBe(409)
    for (let i = 1; i < 8; i++) await f.register()
    expect((await f.begin()).status).toBe(429)
    f.advance()
    expect((await f.poll(first)).status).toBe(404)
    expect((await f.start(first)).status).toBe(404)
    expect((await f.begin()).status).toBe(201)
  })

  test('keeps ordinary external callbacks and non-relay paths available', async () => {
    const f = await fixture()
    for (const path of [
      '/',
      '/business-login',
      CALLBACK + '?state=' + 'u'.repeat(43) + '&code=ordinary'
    ]) {
      const response = await fetch(f.origin + path)
      expect(await response.text()).toBe('ordinary exported application')
    }
    expect(f.checks()).toBe(0)
  })

  test('rejects callbacks before browser launch, duplicate states and code/error ambiguity without consuming the ticket', async () => {
    const f = await fixture()
    const url = f.authorization()
    const ticket = await f.register(url)
    const path = f.origin + CALLBACK + '?state=' + url.searchParams.get('state')
    expect((await fetch(path + '&code=early')).status).toBe(409)
    await f.start(ticket)
    expect((await fetch(path + '&code=a&error=b')).status).toBe(400)
    expect((await fetch(path + '&code=a&state=' + 'z'.repeat(43))).status).toBe(400)
    expect((await fetch(path + '&code=a&code=b')).status).toBe(400)
    expect((await fetch(path + '&access_token=forbidden')).status).toBe(400)
    expect(
      (await fetch(path + '&code=a', { headers: { 'sec-fetch-dest': 'iframe' } })).status
    ).toBe(400)
    const callbackURL = path + '&error=access_denied&error_description=User%20cancelled'
    expect((await fetch(callbackURL)).status).toBe(200)
    expect(await (await f.poll(ticket)).json()).toEqual({ callbackURL })
  })

  test('revokes all tickets when the backend guard fails and clears them on disposal', async () => {
    const f = await fixture()
    const ticket = await f.register()
    f.revoke()
    const response = await f.start(ticket)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Sensitive backend details')
    expect((await f.poll(ticket)).status).toBe(404)
    expect((await f.begin()).status).toBe(410)
    const other = await fixture()
    const otherTicket = await other.register()
    other.dispose()
    expect((await other.start(otherTicket)).status).toBe(410)
    expect((await other.poll(otherTicket)).status).toBe(404)
  })

  test('bounds the complete encoded callback JSON before reporting success to the system browser', async () => {
    const f = await fixture()
    const authorization = f.authorization()
    const ticket = await f.register(authorization)
    await f.start(ticket)
    const callback = new URL(f.origin + CALLBACK)
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
    callback.searchParams.set('code', '漢'.repeat(1600))
    callback.searchParams.set('iss', '')
    const padding = 16 * 1024 - 1 - Buffer.byteLength(callback.pathname + callback.search)
    expect(padding).toBeLessThanOrEqual(2048)
    callback.searchParams.set('iss', 'x'.repeat(padding))
    expect(Buffer.byteLength(callback.pathname + callback.search)).toBeLessThan(16 * 1024)
    expect(Buffer.byteLength(JSON.stringify({ callbackURL: callback.href }))).toBeGreaterThan(
      16 * 1024
    )
    expect(previewAuthCallbackURL(callback)).toBeNull()
    // Bun may reject the combined URL and headers before IncomingMessage exists.
    expect([400, 431]).toContain((await fetch(callback)).status)
    expect((await f.poll(ticket)).status).toBe(202)
    callback.searchParams.set('code', 'valid-code')
    expect((await fetch(callback)).status).toBe(200)
    expect(await (await f.poll(ticket)).json()).toEqual({ callbackURL: callback.href })
  })

  test('bounds and validates HTTP bodies and rejects preflight or fetch-based browser starts', async () => {
    const f = await fixture()
    for (const [body, status] of [
      ['{', 400],
      [JSON.stringify({ authorizationURL: f.authorization().href, extra: true }), 400],
      ['x'.repeat(33000), 413]
    ] as const) {
      const response = await fetch(f.origin + BASE, {
        method: 'POST',
        headers: { origin: f.origin, 'content-type': 'application/json' },
        body
      })
      expect(response.status).toBe(status)
    }
    expect(
      (await fetch(f.origin + BASE, { method: 'POST', headers: { origin: f.origin }, body: '{}' }))
        .status
    ).toBe(415)
    expect(
      (
        await fetch(f.origin + BASE, {
          method: 'OPTIONS',
          headers: { origin: 'https://evil.example.test' }
        })
      ).status
    ).toBe(403)
    const ticket = await f.register()
    expect(
      (await f.start(ticket, { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' })).status
    ).toBe(400)
    expect((await f.start(ticket)).status).toBe(302)
  })
})
