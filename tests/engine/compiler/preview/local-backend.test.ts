import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import {
  parsePreviewLocalBackendConnection,
  type PreviewLocalBackendConnection
} from '@open-pencil/compiler/preview-local-backend'

const DIGEST = 'A'.repeat(43)
const INPUT = {
  previewPort: 5188,
  apiPort: 3019,
  apiBasePath: '/api',
  applicationId: 'notes',
  applicationDigest: DIGEST
}
const CONTRACT = { version: 1, applicationId: INPUT.applicationId, applicationDigest: DIGEST }
const HTML = '<!doctype html><html><body><main>Virtual notes login</main></body></html>'
type Handler = (request: IncomingMessage, response: ServerResponse) => void

describe('local NestJS preview connection', () => {
  test('accepts only an immutable closed public loopback configuration', () => {
    const source = { ...INPUT }
    const parsed = parsePreviewLocalBackendConnection(source)
    source.apiPort += 1
    expect(parsed.apiPort).toBe(INPUT.apiPort)
    expect(Object.isFrozen(parsed)).toBe(true)
    const hidden = Object.defineProperty({ ...INPUT }, 'secret', { value: 'hidden' })
    for (const value of [
      { ...INPUT, previewPort: '5188' },
      { ...INPUT, apiPort: 80 },
      { ...INPUT, apiPort: INPUT.previewPort },
      { ...INPUT, apiPort: 65536 },
      { ...INPUT, apiBasePath: '//example.test' },
      { ...INPUT, apiBasePath: '/api?url=x' },
      { ...INPUT, apiBasePath: '/_openpencil' },
      { ...INPUT, applicationDigest: 'B'.repeat(43) },
      { ...INPUT, applicationId: '../notes' },
      { ...INPUT, url: 'https://example.test' },
      hidden,
      Object.defineProperty({ ...INPUT }, 'apiPort', { get: () => INPUT.apiPort })
    ])
      expect(() => parsePreviewLocalBackendConnection(value)).toThrow('NestJS preview connection')
  })
})

describe('live VFS with a fixed local NestJS backend', () => {
  const servers: Server[] = []
  let preview: PreviewServer | undefined
  async function listen(handler: Handler): Promise<{ server: Server; port: number }> {
    const server = createServer(handler)
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address !== 'object') throw new Error('Missing test port')
    return { server, port: address.port }
  }
  async function connection(handler: Handler): Promise<PreviewLocalBackendConnection> {
    const api = await listen(handler)
    const probe = await listen((_request, response) => response.end())
    await new Promise<void>((resolve, reject) => {
      probe.server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    return { ...INPUT, apiPort: api.port, previewPort: probe.port }
  }
  afterEach(async () => {
    await preview?.close()
    preview = undefined
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
            server.closeAllConnections()
          })
      )
    )
  })
  const contractResponse = (response: ServerResponse, value: unknown = CONTRACT) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
  }

  test('preserves an atomic command attempt key and body through the same-origin preview mount', async () => {
    const localBackend = await connection((request, response) => {
      if (request.url === '/_openpencil/preview-contract') {
        contractResponse(response)
        return
      }
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            path: request.url,
            key: request.headers['idempotency-key'],
            authorization: request.headers.authorization,
            body: JSON.parse(body)
          })
        )
      })
    })
    preview = await createPreviewServer({
      localBackend,
      initialFiles: new Map([['index.html', HTML]])
    })
    const body = { skuId: '20000000-0000-4000-8000-000000000002', quantity: 2 }
    const result = await fetch(preview.url + 'api/commands/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-only',
        'content-type': 'application/json',
        'Idempotency-Key': 'checkout-attempt-00001'
      },
      body: JSON.stringify(body)
    })
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({
      path: '/commands/checkout',
      key: 'checkout-attempt-00001',
      authorization: 'Bearer test-only',
      body
    })
  })

  test('serves login/callback deep links and forwards only the intended API without cookies or redirects', async () => {
    let probes = 0
    const requests: Array<{
      url: string | undefined
      authorization: string | undefined
      cookie: string | undefined
      body: string
    }> = []
    const localBackend = await connection((request, response) => {
      if (request.url === '/_openpencil/preview-contract') {
        expect(request.headers.origin).toBeUndefined()
        probes += 1
        contractResponse(response)
        return
      }
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        requests.push({
          url: request.url,
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
          body
        })
        if (request.url === '/redirect') {
          response.writeHead(307, { location: 'http://127.0.0.1:1/', 'set-cookie': 'blocked=1' })
          response.end()
          return
        }
        response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'blocked=1' })
        response.end(JSON.stringify({ ok: true }))
      })
    })
    preview = await createPreviewServer({
      localBackend,
      initialFiles: new Map([['index.html', HTML]])
    })
    expect(preview.port).toBe(localBackend.previewPort)
    for (const path of ['login-2', '_openpencil/auth/callback?code=test&state=test']) {
      const page = await fetch(preview.url + path, { headers: { accept: 'text/html' } })
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('Virtual notes login')
    }
    const result = await fetch(preview.url + 'api/notes?limit=1', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-only',
        cookie: 'editorCookie=private',
        'content-type': 'application/json'
      },
      body: '{"title":"test"}'
    })
    expect(result.status).toBe(200)
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(await result.json()).toEqual({ ok: true })
    expect(requests).toEqual([
      {
        url: '/notes?limit=1',
        authorization: 'Bearer test-only',
        cookie: undefined,
        body: '{"title":"test"}'
      }
    ])
    const redirected = await fetch(preview.url + 'api/redirect', { redirect: 'manual' })
    expect(redirected.status).toBe(502)
    expect(redirected.headers.get('location')).toBeNull()
    expect(redirected.headers.get('set-cookie')).toBeNull()
    await redirected.text()
    await preview.updateFiles(new Map([['index.html', HTML]]))
    expect(probes).toBe(4)
  }, 15_000)

  test('rechecks every API request and permanently blocks writes after service contract drift', async () => {
    let digest = DIGEST
    let writes = 0
    const localBackend = await connection((request, response) => {
      if (request.url === '/_openpencil/preview-contract')
        contractResponse(response, { ...CONTRACT, applicationDigest: digest })
      else {
        writes += 1
        response.end('ok')
      }
    })
    preview = await createPreviewServer({ localBackend })
    expect((await fetch(preview.url + 'api/notes', { method: 'DELETE' })).status).toBe(200)
    digest = 'different-application'
    const denied = await fetch(preview.url + 'api/notes', { method: 'DELETE' })
    expect(denied.status).toBe(503)
    expect(await denied.text()).toContain('does not match this application')
    digest = DIGEST
    expect((await fetch(preview.url + 'api/notes', { method: 'DELETE' })).status).toBe(503)
    await expect(preview.updateFiles(new Map())).rejects.toThrow('does not match')
    expect(writes).toBe(1)
  }, 15_000)

  test('disables conditional caching for authenticated repeated list requests', async () => {
    const validators: Array<string | undefined> = []
    const localBackend = await connection((request, response) => {
      if (request.url === '/_openpencil/preview-contract') {
        contractResponse(response)
        return
      }
      validators.push(
        request.headers['if-none-match'],
        request.headers['if-modified-since'],
        request.headers['if-range']
      )
      if (request.headers['if-none-match']) {
        response.writeHead(304)
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"notes-version-1"',
        'cache-control': 'public, max-age=600'
      })
      response.end(JSON.stringify({ rows: [request.headers.authorization] }))
    })
    preview = await createPreviewServer({ localBackend })
    for (const token of ['account-one', 'account-two']) {
      const response = await fetch(preview.url + 'api/notes?limit=20', {
        headers: {
          authorization: `Bearer ${token}`,
          'if-none-match': '"notes-version-1"',
          'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
          'if-range': '"notes-version-1"'
        }
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ rows: [`Bearer ${token}`] })
    }
    expect(validators).toEqual(Array.from({ length: 6 }, () => undefined))
  }, 15_000)

  test('refuses a mismatched, redirected or oversized initial contract without starting a preview', async () => {
    for (const mode of ['mismatch', 'redirect', 'oversized']) {
      const localBackend = await connection((_request, response) => {
        if (mode === 'redirect') {
          response.writeHead(302, { location: 'http://127.0.0.1:1/' })
          response.end()
        } else
          contractResponse(
            response,
            mode === 'oversized'
              ? { ...CONTRACT, padding: 'x'.repeat(4096) }
              : { ...CONTRACT, applicationId: 'other' }
          )
      })
      await expect(createPreviewServer({ localBackend })).rejects.toThrow('NestJS preview backend')
    }
  })

  test('fails if the registered preview port is occupied instead of changing the callback origin', async () => {
    const localBackend = await connection((_request, response) => contractResponse(response))
    const occupied = createServer((_request, response) => response.end('other service'))
    servers.push(occupied)
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', reject)
      occupied.listen(localBackend.previewPort, '127.0.0.1', resolve)
    })
    await expect(createPreviewServer({ localBackend })).rejects.toThrow('already in use')
    expect(await (await fetch(`http://127.0.0.1:${localBackend.previewPort}/`)).text()).toBe(
      'other service'
    )
  }, 15_000)
})
