import { afterEach, describe, expect, test } from 'bun:test'

import { deployFiles, type DeployProgress } from '@open-pencil/compiler/deploy'

/**
 * Phase 3 §5 step 4: the Netlify direct-upload deploy core. The request shaping
 * (SHA-1 digest manifest, `required`→PUT loop, `_redirects` injection, error
 * surfacing) is unit-tested against a mocked `fetch`; the real network deploy
 * is the deploy ACK (经验 K — no token / single process can't hit the API).
 */

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | Uint8Array | undefined
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

/**
 * Install a mocked fetch. `handler` returns the Response for a given call;
 * every call is recorded for assertions.
 */
function mockFetch(handler: (call: RecordedCall) => Response): RecordedCall[] {
  const calls: RecordedCall[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const rawBody = init?.body
    let body: string | Uint8Array | undefined
    if (rawBody instanceof Uint8Array) body = rawBody
    else if (typeof rawBody === 'string') body = rawBody
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body
    }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return calls
}

// SHA-1 of "<html>" and "body{}" — pinned so the manifest digest is asserted
// against known values, not just self-consistency.
const HTML = '<html>'
const HTML_SHA1 = '0fe0bb445f51fad57f3fc4115d7c66cf18545107'
const CSS = 'body{}'
const CSS_SHA1 = 'a4c0dac49e47ffe0dbcca7615f73b72ef6b71543'

function fixture(): Map<string, string> {
  return new Map([
    ['index.html', HTML],
    ['assets/app.css', CSS]
  ])
}

describe('deployFiles — Netlify (Phase 3 §5)', () => {
  test('digest manifest is /-prefixed with correct SHA-1 and includes injected _redirects', async () => {
    let manifest: Record<string, string> = {}
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/deploys') && call.method === 'POST') {
        const parsed = JSON.parse(call.body as string) as { files: Record<string, string> }
        manifest = parsed.files
        return jsonResponse({ id: 'dep_1', required: [] })
      }
      return jsonResponse({})
    })

    await deployFiles(fixture(), { provider: 'netlify', token: 't', site: 'site_1' })

    expect(manifest['/index.html']).toBe(HTML_SHA1)
    // _redirects is injected when absent — SPA fallback.
    expect(manifest['/_redirects']).toBeDefined()
    // Every manifest key is /-prefixed.
    expect(Object.keys(manifest).every((k) => k.startsWith('/'))).toBe(true)
    // No site-create call when --site is given.
    expect(calls.some((c) => c.url.endsWith('/sites') && c.method === 'POST')).toBe(false)
  })

  test('only files whose digest is in `required` are PUT', async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/deploys') && call.method === 'POST') {
        // Server already has index.html; only the css digest is required.
        return jsonResponse({ id: 'dep_1', required: [CSS_SHA1] })
      }
      return jsonResponse({})
    })

    await deployFiles(fixture(), { provider: 'netlify', token: 't', site: 'site_1' })

    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0]?.url).toContain('/files/assets/app.css')
    // The required PUT carries raw bytes and octet-stream content type.
    expect(puts[0]?.body).toBeInstanceOf(Uint8Array)
    expect(puts[0]?.headers['Content-Type']).toBe('application/octet-stream')
  })

  test('creates a site when none is given, and returns its ssl_url', async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/sites') && call.method === 'POST') {
        return jsonResponse({ id: 'new_site', ssl_url: 'https://generated.netlify.app' })
      }
      if (call.url.includes('/sites/new_site/deploys')) {
        return jsonResponse({ id: 'dep_2', required: [] }) // no ssl_url on deploy
      }
      return jsonResponse({})
    })

    const result = await deployFiles(fixture(), { provider: 'netlify', token: 't' })

    expect(calls[0]?.url).toBe('https://api.netlify.com/api/v1/sites')
    expect(result.deployId).toBe('dep_2')
    // Falls back to the created site's ssl_url when the deploy carries none.
    expect(result.url).toBe('https://generated.netlify.app')
    expect(result.provider).toBe('netlify')
  })

  test('prefers the deploy ssl_url and reports fileCount incl. _redirects', async () => {
    mockFetch((call) => {
      if (call.url.endsWith('/deploys') && call.method === 'POST') {
        return jsonResponse({ id: 'dep_3', required: [], ssl_url: 'https://my.example.app' })
      }
      return jsonResponse({})
    })

    const result = await deployFiles(fixture(), { provider: 'netlify', token: 't', site: 's' })

    expect(result.url).toBe('https://my.example.app')
    // 2 fixture files + injected _redirects.
    expect(result.fileCount).toBe(3)
  })

  test('does not overwrite a caller-provided _redirects', async () => {
    let manifest: Record<string, string> = {}
    mockFetch((call) => {
      if (call.url.endsWith('/deploys') && call.method === 'POST') {
        manifest = (JSON.parse(call.body as string) as { files: Record<string, string> }).files
        return jsonResponse({ id: 'dep_4', required: [] })
      }
      return jsonResponse({})
    })

    const files = fixture()
    files.set('_redirects', '/custom /elsewhere 301\n')
    const custom = await deployFiles(files, { provider: 'netlify', token: 't', site: 's' })

    // 2 fixture files + the caller's _redirects — not double-counted.
    expect(custom.fileCount).toBe(3)
    expect(manifest['/_redirects']).toBeDefined()
  })

  test('surfaces a 401 as a structured error mentioning the token', async () => {
    mockFetch(() => new Response('Unauthorized', { status: 401 }))

    await expect(
      deployFiles(fixture(), { provider: 'netlify', token: 'bad', site: 's' })
    ).rejects.toThrow(/401.*token/i)
  })

  test('rejects a missing token before any network call', async () => {
    const calls = mockFetch(() => jsonResponse({}))
    await expect(
      deployFiles(fixture(), { provider: 'netlify', token: '', site: 's' })
    ).rejects.toThrow(/token is required/i)
    expect(calls).toHaveLength(0)
  })

  test('emits the digest → create → upload → done progress sequence', async () => {
    mockFetch((call) => {
      if (call.url.endsWith('/deploys') && call.method === 'POST') {
        return jsonResponse({ id: 'dep_5', required: [CSS_SHA1] })
      }
      return jsonResponse({})
    })

    const stages: DeployProgress['stage'][] = []
    await deployFiles(
      fixture(),
      { provider: 'netlify', token: 't', site: 's' },
      { onProgress: (p) => stages.push(p.stage) }
    )

    expect(stages[0]).toBe('digest')
    expect(stages).toContain('create')
    expect(stages).toContain('upload')
    expect(stages[stages.length - 1]).toBe('done')
  })
})

describe('deployFiles — Vercel (Phase 3 §5.4)', () => {
  test('uploads every file to /v2/files with x-vercel-digest + octet-stream raw bytes', async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/v13/deployments'))
        return jsonResponse({ id: 'dpl_1', url: 'app-x.vercel.app' })
      return jsonResponse({})
    })

    await deployFiles(fixture(), { provider: 'vercel', token: 't', site: 'app' })

    const uploads = calls.filter((c) => c.url.endsWith('/v2/files') && c.method === 'POST')
    // 2 fixture files + injected vercel.json.
    expect(uploads).toHaveLength(3)
    const html = uploads.find((c) => c.headers['x-vercel-digest'] === HTML_SHA1)
    expect(html).toBeDefined()
    expect(html?.body).toBeInstanceOf(Uint8Array)
    expect(html?.headers['Content-Type']).toBe('application/octet-stream')
    expect(uploads.some((c) => c.headers['x-vercel-digest'] === CSS_SHA1)).toBe(true)
  })

  test('creates a deployment with a /-less files manifest incl. injected vercel.json', async () => {
    let body: { name: string; files: { file: string; sha: string; size: number }[] } = {
      name: '',
      files: []
    }
    mockFetch((call) => {
      if (call.url.endsWith('/v13/deployments')) {
        body = JSON.parse(call.body as string) as typeof body
        return jsonResponse({ id: 'dpl_2', url: 'app-y.vercel.app' })
      }
      return jsonResponse({})
    })

    await deployFiles(fixture(), { provider: 'vercel', token: 't', site: 'my-app' })

    expect(body.name).toBe('my-app')
    const index = body.files.find((f) => f.file === 'index.html')
    expect(index?.sha).toBe(HTML_SHA1)
    // Manifest paths carry no leading slash (unlike Netlify).
    expect(body.files.every((f) => !f.file.startsWith('/'))).toBe(true)
    // vercel.json SPA rewrite is injected when absent.
    const vjson = body.files.find((f) => f.file === 'vercel.json')
    expect(vjson).toBeDefined()
    expect(vjson?.size).toBeGreaterThan(0)
  })

  test('does not overwrite a caller-provided vercel.json', async () => {
    let body: { files: { file: string; sha: string }[] } = { files: [] }
    mockFetch((call) => {
      if (call.url.endsWith('/v13/deployments')) {
        body = JSON.parse(call.body as string) as typeof body
        return jsonResponse({ id: 'dpl_3', url: 'app-z.vercel.app' })
      }
      return jsonResponse({})
    })

    const files = fixture()
    const custom = '{"rewrites":[{"source":"/api/(.*)","destination":"/api/$1"}]}\n'
    files.set('vercel.json', custom)
    const result = await deployFiles(files, { provider: 'vercel', token: 't', site: 'app' })

    const vjson = body.files.find((f) => f.file === 'vercel.json')
    expect(vjson?.sha).toBe(await sha1HexOf(custom))
    // 2 fixture files + the caller's vercel.json — not double-counted.
    expect(result.fileCount).toBe(3)
  })

  test('returns the deployment hostname as an https URL', async () => {
    mockFetch((call) => {
      if (call.url.endsWith('/v13/deployments'))
        return jsonResponse({ id: 'dpl_4', url: 'app-q.vercel.app' })
      return jsonResponse({})
    })

    const result = await deployFiles(fixture(), { provider: 'vercel', token: 't', site: 'app' })

    expect(result.provider).toBe('vercel')
    expect(result.deployId).toBe('dpl_4')
    expect(result.url).toBe('https://app-q.vercel.app')
  })

  test('surfaces a 401 as a structured error mentioning the token', async () => {
    mockFetch(() => new Response('Unauthorized', { status: 401 }))

    await expect(
      deployFiles(fixture(), { provider: 'vercel', token: 'bad', site: 'app' })
    ).rejects.toThrow(/401.*token/i)
  })

  test('rejects a missing token before any network call (names VERCEL_TOKEN)', async () => {
    const calls = mockFetch(() => jsonResponse({}))
    await expect(
      deployFiles(fixture(), { provider: 'vercel', token: '', site: 'app' })
    ).rejects.toThrow(/VERCEL_TOKEN/)
    expect(calls).toHaveLength(0)
  })

  test('emits the digest → upload → create → done progress sequence', async () => {
    mockFetch((call) => {
      if (call.url.endsWith('/v13/deployments'))
        return jsonResponse({ id: 'dpl_5', url: 'app-p.vercel.app' })
      return jsonResponse({})
    })

    const stages: DeployProgress['stage'][] = []
    await deployFiles(
      fixture(),
      { provider: 'vercel', token: 't', site: 'app' },
      { onProgress: (p) => stages.push(p.stage) }
    )

    expect(stages[0]).toBe('digest')
    // Vercel is upload-then-create (Netlify is create-then-upload).
    expect(stages.indexOf('upload')).toBeLessThan(stages.indexOf('create'))
    expect(stages[stages.length - 1]).toBe('done')
  })

  test('hits only Vercel endpoints — never the Netlify API', async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/v13/deployments'))
        return jsonResponse({ id: 'dpl_6', url: 'app-w.vercel.app' })
      return jsonResponse({})
    })

    await deployFiles(fixture(), { provider: 'vercel', token: 't', site: 'app' })

    expect(calls.every((c) => c.url.startsWith('https://api.vercel.com'))).toBe(true)
    expect(calls.some((c) => c.url.includes('netlify.com'))).toBe(false)
  })
})

/** Mirror of deploy.ts sha1Hex — for asserting a caller-provided file's digest. */
async function sha1HexOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
