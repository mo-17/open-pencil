import { describe, expect, test } from 'bun:test'

import { encodeBase64URL, webCryptoBuffer } from '@open-pencil/scene-graph'

import {
  CODEPEN_ISOLATED_RENDERER_CONTRACT,
  CODEPEN_STATIC_EVIDENCE_FORMAT,
  CODEPEN_STATIC_EVIDENCE_LIMITS,
  createCodePenStaticEvidence,
  createCodePenStaticEvidenceFromFetchedSources,
  loadCodePenStaticEvidence,
  loadCodePenStaticEvidenceFromTauri,
  parseCodePenURL,
  serializeCodePenStaticEvidence,
  verifyCodePenStaticEvidenceIntegrity,
  type CodePenFetchedSources,
  type CodePenTauriInvoker,
  type CodePenSourceKind,
  type CodePenStaticEvidence
} from '@/app/codepen'

import { codePenSecretFixtures } from '#tests/helpers/codepen-secrets'

const PEN_URL = 'https://codepen.io/jakebogan01/pen/pvNWZWr'

function requestURL(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}
const SOURCE_URLS: Readonly<Record<CodePenSourceKind, string>> = Object.freeze({
  html: `${PEN_URL}.html`,
  css: `${PEN_URL}.css`,
  js: `${PEN_URL}.js`
})
const FIXTURE = Object.freeze({
  html: `<main onclick="buy()">
    <img src="https://assets.codepen.io/mug.png?token=not-retained#hero">
    <script src="https://cdn.example.com/widget.js"></script>
    <iframe src="http://127.0.0.1/private"></iframe>
    <div style="background:url(data:image/png;base64,secret-payload)"></div>
  </main>`,
  css: `@import "https://fonts.example.com/theme.css";
    @font-face { src: url("https://fonts.example.com/mug.woff2") }
    .hero { background: url('/relative/background.webp') }`,
  js: `const endpoint = "https://api.example.com/products?token=not-retained";
    localStorage.setItem("cart", "1");
    fetch(endpoint).then((response) => response.json());
    eval("console.log('never execute')");`
})
const MEDIA_TYPES: Readonly<Record<CodePenSourceKind, string>> = Object.freeze({
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript'
})

async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', webCryptoBuffer(bytes))
  return encodeBase64URL(new Uint8Array(hash))
}

function responseAt(url: string, body: BodyInit, init: ResponseInit): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'url', { configurable: true, value: url })
  return response
}

async function fetchedFixture(
  overrides: Partial<CodePenFetchedSources> = {}
): Promise<CodePenFetchedSources> {
  const sources = await Promise.all(
    (['html', 'css', 'js'] as const).map(async (kind) => ({
      kind,
      url: SOURCE_URLS[kind],
      byteLength: new TextEncoder().encode(FIXTURE[kind]).byteLength,
      digest: await digest(FIXTURE[kind]),
      contentType: MEDIA_TYPES[kind]
    }))
  )
  return {
    canonicalUrl: PEN_URL,
    ...FIXTURE,
    sources,
    ...overrides
  }
}

describe('CodePen static evidence', () => {
  test('accepts only a canonical public CodePen Pen URL', () => {
    expect(parseCodePenURL(PEN_URL)).toEqual({
      provider: 'codepen',
      owner: 'jakebogan01',
      slug: 'pvNWZWr',
      url: PEN_URL,
      sourceURLs: SOURCE_URLS
    })
    const rejected = [
      `http://codepen.io/jakebogan01/pen/pvNWZWr`,
      `https://user:secret@codepen.io/jakebogan01/pen/pvNWZWr`,
      `${PEN_URL}?editors=1010`,
      `${PEN_URL}#preview`,
      `https://codepen.io:443/jakebogan01/pen/pvNWZWr`,
      `https://CODEPEN.io/jakebogan01/pen/pvNWZWr`,
      `https://www.codepen.io/jakebogan01/pen/pvNWZWr`,
      `https://codepen.io/jakebogan01/full/pvNWZWr`,
      `https://codepen.io/jakebogan01/pen/pvNWZWr.js`,
      `${PEN_URL}/`,
      `https://codepen.io/jake%62ogan01/pen/pvNWZWr`,
      ` ${PEN_URL}`
    ]
    for (const value of rejected) expect(() => parseCodePenURL(value)).toThrow()
  })

  test('creates deterministic frozen evidence without executing or fetching resources', async () => {
    const first = await createCodePenStaticEvidence({ penURL: PEN_URL, sources: FIXTURE })
    const second = await createCodePenStaticEvidence({ penURL: PEN_URL, sources: FIXTURE })

    expect(first).toEqual(second)
    expect(first.payload.format).toBe(CODEPEN_STATIC_EVIDENCE_FORMAT)
    expect(first.integrity.digest).toHaveLength(43)
    expect(await verifyCodePenStaticEvidenceIntegrity(first)).toBe(first.integrity.digest)
    expect(first.payload.summary).toMatchObject({
      safeForStaticAIAnalysis: true,
      safeToExecute: false
    })
    expect(first.payload.policy).toEqual({
      analysis: 'static-advisory',
      aiInputTrust: 'untrusted-data',
      sourceInstructions: 'non-authoritative',
      sourceCodeExecution: 'blocked',
      externalResourceFetching: 'blocked',
      mainWebViewRendering: 'blocked',
      isolatedRendering: 'host-required'
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.payload)).toBe(true)
    expect(Object.isFrozen(first.payload.resources)).toBe(true)

    const riskCodes = first.payload.risks.map((risk) => risk.code)
    expect(riskCodes).toContain('javascript-source-present')
    expect(riskCodes).toContain('script-element-present')
    expect(riskCodes).toContain('inline-event-handler-present')
    expect(riskCodes).toContain('active-embed-present')
    expect(riskCodes).toContain('network-api-present')
    expect(riskCodes).toContain('dynamic-code-evaluation-present')
    expect(riskCodes).toContain('persistent-state-api-present')
    expect(riskCodes).toContain('external-script-resource-present')
    expect(riskCodes).toContain('non-public-resource-host-present')

    const resources = first.payload.resources
    const image = resources.find((resource) => resource.url.endsWith('/mug.png'))
    expect(image).toMatchObject({
      scheme: 'https',
      hasQuery: true,
      hasFragment: true,
      networkPolicy: 'not-fetched'
    })
    expect(image?.url).not.toContain('token')
    expect(resources.some((resource) => resource.url === 'data:image/png;[payload-omitted]')).toBe(
      true
    )
    expect(resources.every((resource) => !resource.url.includes('secret-payload'))).toBe(true)
    expect(resources.find((resource) => resource.url.endsWith('/widget.js'))?.kinds).toContain(
      'script'
    )
  })

  test('detects persisted evidence tampering and rejects extra envelope fields', async () => {
    const evidence = await createCodePenStaticEvidence({ penURL: PEN_URL, sources: FIXTURE })
    const tampered = JSON.parse(serializeCodePenStaticEvidence(evidence)) as CodePenStaticEvidence
    ;(tampered.payload.sources.html as { text: string }).text = '<main>changed</main>'
    await expect(verifyCodePenStaticEvidenceIntegrity(tampered)).rejects.toThrow('digest mismatch')

    const extra = Object.assign(
      JSON.parse(serializeCodePenStaticEvidence(evidence)) as CodePenStaticEvidence,
      { extra: true }
    )
    await expect(verifyCodePenStaticEvidenceIntegrity(extra)).rejects.toThrow('exactly')
  })

  test('enforces per-source, aggregate, and media-type bounds', async () => {
    await expect(
      createCodePenStaticEvidence({
        penURL: PEN_URL,
        sources: {
          html: 'x'.repeat(CODEPEN_STATIC_EVIDENCE_LIMITS.maxHTMLBytes + 1),
          css: '',
          js: ''
        }
      })
    ).rejects.toThrow('byte limit')

    await expect(
      createCodePenStaticEvidence({
        penURL: PEN_URL,
        sources: {
          html: { text: '', mediaType: 'application/octet-stream' },
          css: '',
          js: ''
        }
      })
    ).rejects.toThrow('media type')
  })

  test('blocks AI handoff when secret-like material is detected without copying it into risks', async () => {
    const privateKey =
      '-----BEGIN PRIVATE KEY-----\nvery-secret-material\n-----END PRIVATE KEY-----'
    const evidence = await createCodePenStaticEvidence({
      penURL: PEN_URL,
      sources: { html: `<pre>${privateKey}</pre>`, css: '', js: '' }
    })
    expect(evidence.payload.summary.safeForStaticAIAnalysis).toBe(false)
    expect(evidence.payload.risks.map((risk) => risk.code)).toContain(
      'secret-like-material-present'
    )
    expect(JSON.stringify(evidence.payload.risks)).not.toContain('very-secret-material')
  })

  test('keeps the shared secret-format union out of static AI handoff and risk text', async () => {
    for (const fixture of codePenSecretFixtures()) {
      const evidence = await createCodePenStaticEvidence({
        penURL: PEN_URL,
        sources: { html: '', css: '', js: fixture.source }
      })
      expect(evidence.payload.summary.safeForStaticAIAnalysis, fixture.label).toBe(false)
      expect(
        evidence.payload.risks.some((risk) => risk.code === 'secret-like-material-present'),
        fixture.label
      ).toBe(true)
      expect(JSON.stringify(evidence.payload.risks), fixture.label).not.toContain(
        fixture.secretMarker
      )
    }
  })

  test('validates desktop-fetched metadata before creating evidence', async () => {
    const fetched = await fetchedFixture()
    const evidence = await createCodePenStaticEvidenceFromFetchedSources(fetched)
    expect(evidence.payload.sources.html.digest).toBe(fetched.sources[0].digest)

    const wrongLength = await fetchedFixture({
      sources: (await fetchedFixture()).sources.map((entry) =>
        entry.kind === 'css' ? { ...entry, byteLength: entry.byteLength + 1 } : entry
      )
    })
    await expect(createCodePenStaticEvidenceFromFetchedSources(wrongLength)).rejects.toThrow(
      'byte length'
    )

    const wrongDigest = await fetchedFixture({
      sources: (await fetchedFixture()).sources.map((entry) =>
        entry.kind === 'js' ? { ...entry, digest: 'A'.repeat(43) } : entry
      )
    })
    await expect(createCodePenStaticEvidenceFromFetchedSources(wrongDigest)).rejects.toThrow(
      'digest does not match'
    )

    const wrongURL = await fetchedFixture({
      sources: (await fetchedFixture()).sources.map((entry) =>
        entry.kind === 'html' ? { ...entry, url: 'https://evil.example/source.html' } : entry
      )
    })
    await expect(createCodePenStaticEvidenceFromFetchedSources(wrongURL)).rejects.toThrow(
      'canonical endpoint'
    )
  })

  test('uses the fixed native command through an injected Tauri adapter and rejects browser fallback', async () => {
    const calls: Array<{ command: string; args: unknown }> = []
    const response = await fetchedFixture()
    const invoker: CodePenTauriInvoker = async (command, args) => {
      calls.push({ command, args })
      return response
    }
    const evidence = await loadCodePenStaticEvidenceFromTauri(PEN_URL, invoker)
    expect(evidence.payload.pen.url).toBe(PEN_URL)
    expect(calls).toEqual([
      { command: 'fetch_codepen_sources', args: { request: { url: PEN_URL } } }
    ])

    let called = false
    await expect(
      loadCodePenStaticEvidenceFromTauri(`${PEN_URL}?editors=1010`, async () => {
        called = true
        return response
      })
    ).rejects.toThrow('query or fragment')
    expect(called).toBe(false)
    await expect(loadCodePenStaticEvidenceFromTauri(PEN_URL)).rejects.toThrow('desktop app')
  })

  test('requires an injected fetcher and applies a credential-free no-redirect request policy', async () => {
    await expect(loadCodePenStaticEvidence(PEN_URL)).rejects.toThrow('host-owned')

    const calls: Array<{ href: string; init: RequestInit | undefined }> = []
    const fetchImpl = (async (input, init) => {
      const href = requestURL(input)
      calls.push({ href, init })
      let kind: CodePenSourceKind = 'js'
      if (href.endsWith('.html')) kind = 'html'
      else if (href.endsWith('.css')) kind = 'css'
      return responseAt(href, FIXTURE[kind], {
        status: 200,
        headers: {
          'content-type': MEDIA_TYPES[kind]
        }
      })
    }) as typeof globalThis.fetch

    const evidence = await loadCodePenStaticEvidence(PEN_URL, { fetchImpl })
    expect(evidence.payload.sources.js.text).toBe(FIXTURE.js)
    expect(calls.map((call) => call.href)).toEqual([
      SOURCE_URLS.html,
      SOURCE_URLS.css,
      SOURCE_URLS.js
    ])
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store'
      })
    }
  })

  test('fails closed on redirects, media-type confusion, and oversized bodies', async () => {
    const redirected = (async (_input) =>
      responseAt('https://evil.example/source.html', 'source', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })) as typeof globalThis.fetch
    await expect(loadCodePenStaticEvidence(PEN_URL, { fetchImpl: redirected })).rejects.toThrow(
      'redirects'
    )

    const confused = (async (input) =>
      responseAt(requestURL(input), 'source', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      })) as typeof globalThis.fetch
    await expect(loadCodePenStaticEvidence(PEN_URL, { fetchImpl: confused })).rejects.toThrow(
      'media type'
    )

    const oversized = (async (input) =>
      responseAt(requestURL(input), 'small', {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-length': String(CODEPEN_STATIC_EVIDENCE_LIMITS.maxHTMLBytes + 1)
        }
      })) as typeof globalThis.fetch
    await expect(loadCodePenStaticEvidence(PEN_URL, { fetchImpl: oversized })).rejects.toThrow(
      'byte limit'
    )
  })

  test('exposes only a fail-closed host isolation contract for future screenshots', () => {
    expect(CODEPEN_ISOLATED_RENDERER_CONTRACT).toEqual({
      version: 1,
      processIsolation: 'required',
      mainWebViewAccess: 'forbidden',
      sourceJavaScript: 'disabled',
      inlineEventHandlers: 'disabled',
      networkAccess: 'disabled',
      persistentStorage: 'disabled',
      navigation: 'disabled',
      popups: 'disabled'
    })
    expect(Object.isFrozen(CODEPEN_ISOLATED_RENDERER_CONTRACT)).toBe(true)
  })
})
