import { describe, expect, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { parsePenFile, REMOTE_PEN_PARSE_LIMITS } from '@open-pencil/pen'
import {
  componentSubtreeVersion,
  encodeBase64URL,
  REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS,
  webCryptoBuffer
} from '@open-pencil/scene-graph'

import {
  REMOTE_LIBRARY_LIMITS,
  loadRemoteLibraryCandidate,
  parseRemoteLibraryManifestText,
  parseRemoteLibraryURL,
  type RemoteLibraryArtifactFormat
} from '@/app/lowcode/remote-library-source'

const MANIFEST_URL = 'https://libraries.openpencil.dev/brand/manifest.json'
const ARTIFACT_URL = 'https://libraries.openpencil.dev/brand/library.pen'
const FIG_ARTIFACT_URL = 'https://libraries.openpencil.dev/brand/library.fig'
const UNSAFE_IMAGE_HASH = 'ab'.repeat(20)

const PEN_SOURCE = `${JSON.stringify({
  version: '2.14',
  children: [
    {
      id: 'button',
      type: 'frame',
      name: 'Button',
      reusable: true,
      width: 120,
      height: 40,
      children: [{ id: 'label', type: 'text', content: 'Go' }]
    }
  ]
})}\n`
const PEN_BYTES = new TextEncoder().encode(PEN_SOURCE)
const PEN_GRAPH = parsePenFile(PEN_SOURCE)
const PEN_COMPONENT_VERSION = componentSubtreeVersion(PEN_GRAPH, 'button')
const VALID_COMPONENT = Object.freeze({
  key: 'button-key',
  name: 'Button',
  version: PEN_COMPONENT_VERSION,
  nodeId: 'button',
  type: 'COMPONENT'
})

interface ManifestFixtureOptions {
  artifactBytes?: Uint8Array
  artifactURL?: string
  format?: RemoteLibraryArtifactFormat
  mediaType?: string
  byteLength?: number
  digest?: string
  libraryId?: string
  name?: string
  components?: unknown[]
}

interface FetchCall {
  href: string
  init: RequestInit | undefined
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', webCryptoBuffer(bytes))
  return encodeBase64URL(new Uint8Array(digest))
}

async function manifestFixture(
  options: ManifestFixtureOptions = {}
): Promise<Record<string, unknown>> {
  const format = options.format ?? 'pen'
  const artifactBytes = options.artifactBytes ?? PEN_BYTES
  return {
    format: 'openpencil.component-library',
    schemaVersion: 1,
    libraryId: options.libraryId ?? 'brand-library',
    name: options.name ?? 'Brand Library',
    components: options.components ?? [VALID_COMPONENT],
    source: {
      kind: 'url',
      ref: options.artifactURL ?? (format === 'fig' ? FIG_ARTIFACT_URL : ARTIFACT_URL)
    },
    artifact: {
      format,
      mediaType:
        options.mediaType ?? (format === 'fig' ? 'application/octet-stream' : 'application/json'),
      byteLength: options.byteLength ?? artifactBytes.byteLength,
      integrity: {
        algorithm: 'SHA-256',
        digest: options.digest ?? (await sha256(artifactBytes))
      }
    }
  }
}

function responseAt(url: string, body: BodyInit | null, init: ResponseInit = {}): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'url', { configurable: true, value: url })
  return response
}

function fixtureFetch(
  manifest: Record<string, unknown>,
  artifactResponse: () => Response,
  calls: FetchCall[] = []
): typeof globalThis.fetch {
  return (async (input, init) => {
    const href = String(input)
    calls.push({ href, init })
    if (href === MANIFEST_URL) {
      return responseAt(MANIFEST_URL, JSON.stringify(manifest), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      })
    }
    if (href === ARTIFACT_URL || href === FIG_ARTIFACT_URL) return artifactResponse()
    throw new Error(`Unexpected request: ${href}`)
  }) as typeof globalThis.fetch
}

function artifactResponse(
  bytes: Uint8Array = PEN_BYTES,
  url = ARTIFACT_URL,
  mediaType = 'application/json',
  headers: Record<string, string> = {}
): Response {
  return responseAt(url, bytes, {
    status: 200,
    headers: { 'content-type': mediaType, ...headers }
  })
}

describe('remote component library source', () => {
  test('uses the shared strict descriptor limits', () => {
    expect(REMOTE_LIBRARY_LIMITS).toMatchObject(REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS)
  })

  test('accepts only canonical public HTTPS URLs, with an explicit loopback HTTP test escape hatch', () => {
    const rejected = [
      'http://libraries.openpencil.dev/manifest.json',
      'https://user:secret@libraries.openpencil.dev/manifest.json',
      'https://libraries.openpencil.dev/manifest.json#fragment',
      'https://libraries.openpencil.dev/manifest.json?channel=beta',
      'https://libraries.openpencil.dev:8443/manifest.json',
      'https://127.0.0.1/manifest.json',
      'https://intranet/manifest.json',
      'https://xn--bcher-kva.openpencil.dev/manifest.json',
      'https://libraries.openpencil.test/manifest.json',
      'https://LIBRARIES.openpencil.dev/manifest.json',
      'https://libraries.openpencil.dev:443/manifest.json'
    ]
    for (const value of rejected) expect(() => parseRemoteLibraryURL(value)).toThrow()

    expect(() => parseRemoteLibraryURL('http://127.0.0.1:4173/manifest.json')).toThrow('HTTPS')
    expect(
      parseRemoteLibraryURL('http://127.0.0.1:4173/manifest.json', {
        allowLoopbackHttp: true
      }).href
    ).toBe('http://127.0.0.1:4173/manifest.json')
    expect(() =>
      parseRemoteLibraryURL('http://192.168.1.2:4173/manifest.json', {
        allowLoopbackHttp: true
      })
    ).toThrow('HTTPS')
  })

  test('strictly parses the v1 manifest, media type, digest, URL extension, and exact fields', async () => {
    const valid = await manifestFixture()
    const wrongExtension = await manifestFixture({ artifactURL: FIG_ARTIFACT_URL })
    const wrongMediaType = await manifestFixture({ mediaType: 'text/plain' })
    const paddedDigest = await manifestFixture({ digest: `${'A'.repeat(43)}=` })
    const oversizedArtifact = await manifestFixture({
      format: 'fig',
      artifactURL: FIG_ARTIFACT_URL,
      byteLength: REMOTE_LIBRARY_LIMITS.maxArtifactBytes + 1
    })
    const oversizedPenArtifact = await manifestFixture({
      byteLength: REMOTE_PEN_PARSE_LIMITS.maxBytes + 1
    })
    const figAbovePenLimit = await manifestFixture({
      format: 'fig',
      artifactURL: FIG_ARTIFACT_URL,
      byteLength: REMOTE_PEN_PARSE_LIMITS.maxBytes + 1
    })
    const uppercasePenPath = await manifestFixture({
      artifactURL: 'https://libraries.openpencil.dev/brand/library.PEN'
    })
    expect(parseRemoteLibraryManifestText(JSON.stringify(valid))).toMatchObject({
      format: 'openpencil.component-library',
      schemaVersion: 1,
      libraryId: 'brand-library',
      source: { kind: 'url', ref: ARTIFACT_URL },
      artifact: {
        format: 'pen',
        mediaType: 'application/json',
        byteLength: PEN_BYTES.byteLength,
        integrity: { algorithm: 'SHA-256' }
      }
    })

    expect(() =>
      parseRemoteLibraryManifestText(JSON.stringify({ ...valid, unsignedExtra: true }))
    ).toThrow('exactly')
    expect(() => parseRemoteLibraryManifestText(JSON.stringify(wrongExtension))).toThrow(
      'end in .pen'
    )
    expect(() => parseRemoteLibraryManifestText(JSON.stringify(wrongMediaType))).toThrow(
      'application/json'
    )
    expect(() => parseRemoteLibraryManifestText(JSON.stringify(paddedDigest))).toThrow('SHA-256')
    expect(() => parseRemoteLibraryManifestText(JSON.stringify(oversizedArtifact))).toThrow(
      'byteLength'
    )
    expect(() => parseRemoteLibraryManifestText(JSON.stringify(oversizedPenArtifact))).toThrow(
      `1 to ${REMOTE_PEN_PARSE_LIMITS.maxBytes} for pen`
    )
    expect(
      parseRemoteLibraryManifestText(JSON.stringify(figAbovePenLimit)).artifact.byteLength
    ).toBe(REMOTE_PEN_PARSE_LIMITS.maxBytes + 1)
    expect(
      parseRemoteLibraryManifestText(JSON.stringify(uppercasePenPath)).source.ref.endsWith('.PEN')
    ).toBe(true)
  })

  test('bounds component count and all manifest identifiers and rejects control characters', async () => {
    const tooManyComponents = Array.from(
      { length: REMOTE_LIBRARY_LIMITS.maxComponents + 1 },
      () => VALID_COMPONENT
    )
    const oversizedManifest = await manifestFixture({ components: tooManyComponents })
    expect(() => parseRemoteLibraryManifestText(JSON.stringify(oversizedManifest))).toThrow(
      'more than'
    )

    const invalidComponents = [
      { ...VALID_COMPONENT, key: 'k'.repeat(REMOTE_LIBRARY_LIMITS.maxComponentKeyLength + 1) },
      { ...VALID_COMPONENT, nodeId: 'n'.repeat(REMOTE_LIBRARY_LIMITS.maxNodeIdLength + 1) },
      { ...VALID_COMPONENT, version: 'v'.repeat(REMOTE_LIBRARY_LIMITS.maxVersionLength + 1) },
      { ...VALID_COMPONENT, name: 'n'.repeat(REMOTE_LIBRARY_LIMITS.maxNameLength + 1) },
      { ...VALID_COMPONENT, key: 'key\u0000control' }
    ]
    const invalidManifests = [
      await manifestFixture({
        libraryId: 'l'.repeat(REMOTE_LIBRARY_LIMITS.maxLibraryIdLength + 1)
      }),
      await manifestFixture({ name: 'bad\nname' }),
      ...invalidComponents.map((component) => ({
        ...validManifestShell(),
        components: [component]
      }))
    ]
    for (const value of invalidManifests) {
      expect(() => parseRemoteLibraryManifestText(JSON.stringify(value))).toThrow()
    }

    for (const components of [
      [],
      [VALID_COMPONENT, { ...VALID_COMPONENT, nodeId: 'other-node' }],
      [VALID_COMPONENT, { ...VALID_COMPONENT, key: 'other-key' }]
    ]) {
      const manifest = await manifestFixture({ components })
      expect(() => parseRemoteLibraryManifestText(JSON.stringify(manifest))).toThrow()
    }
  })

  test('loads and validates a real .pen artifact with credential-free no-redirect requests', async () => {
    const manifest = await manifestFixture()
    const calls: FetchCall[] = []
    const candidate = await loadRemoteLibraryCandidate(MANIFEST_URL, {
      fetchImpl: fixtureFetch(manifest, () => artifactResponse(), calls)
    })

    expect(candidate.manifestURL).toBe(MANIFEST_URL)
    expect(candidate.artifact).toMatchObject({
      url: ARTIFACT_URL,
      format: 'pen',
      byteLength: PEN_BYTES.byteLength
    })
    expect(candidate.sourceGraph.getNode('button')?.type).toBe('COMPONENT')
    expect(Object.hasOwn(candidate.artifact, 'bytes')).toBe(false)
    expect(calls.map((call) => call.href)).toEqual([MANIFEST_URL, ARTIFACT_URL])
    for (const { init } of calls) {
      expect(init).toMatchObject({
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store'
      })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(new Headers(calls[0]?.init?.headers).get('accept')).toBe('application/json')
    expect(new Headers(calls[1]?.init?.headers).get('accept')).toBe('application/json')
    expect(calls[0]?.init?.signal).toBe(calls[1]?.init?.signal)
  })

  test('loads and validates a real .fig artifact through the bounded all-pages decoder', async () => {
    const registry = new IORegistry(BUILTIN_IO_FORMATS)
    const figSourceGraph = parsePenFile(PEN_SOURCE)
    figSourceGraph.updateNode('button', { componentKey: 'fig-button-key' })
    const written = await registry.writeDocument('fig', figSourceGraph, { renderThumbnail: false })
    if (!(written.data instanceof Uint8Array)) throw new Error('Expected binary .fig output')
    const bytes = written.data
    const decoded = await registry.readDocumentAs(
      'fig',
      { name: 'library.fig', mimeType: 'application/octet-stream', data: bytes },
      { populate: 'all' }
    )
    const component = [...decoded.graph.nodes.values()].find((node) => node.type === 'COMPONENT')
    if (!component) throw new Error('Expected a decoded .fig component')
    const components = [
      {
        key: 'fig-button-key',
        name: component.name,
        version: componentSubtreeVersion(decoded.graph, component.id),
        nodeId: component.id,
        type: 'COMPONENT'
      }
    ]
    const manifest = await manifestFixture({
      artifactBytes: bytes,
      artifactURL: FIG_ARTIFACT_URL,
      format: 'fig',
      components
    })

    const candidate = await loadRemoteLibraryCandidate(MANIFEST_URL, {
      fetchImpl: fixtureFetch(manifest, () =>
        artifactResponse(bytes, FIG_ARTIFACT_URL, 'application/octet-stream')
      )
    })
    expect(candidate.artifact.format).toBe('fig')
    expect(
      [...candidate.sourceGraph.nodes.values()].some(
        (node) => node.type === 'COMPONENT' && node.componentKey === 'fig-button-key'
      )
    ).toBe(true)
  })

  test('rejects a remote artifact whose referenced image has an unsafe header', async () => {
    const registry = new IORegistry(BUILTIN_IO_FORMATS)
    const figSourceGraph = parsePenFile(PEN_SOURCE)
    figSourceGraph.updateNode('button', {
      componentKey: 'fig-button-key',
      fills: [
        {
          type: 'IMAGE',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          imageHash: UNSAFE_IMAGE_HASH,
          imageScaleMode: 'FILL'
        }
      ]
    })
    figSourceGraph.images.set(UNSAFE_IMAGE_HASH, new Uint8Array([1, 2, 3]))
    const written = await registry.writeDocument('fig', figSourceGraph, { renderThumbnail: false })
    if (!(written.data instanceof Uint8Array)) throw new Error('Expected binary .fig output')
    const bytes = written.data
    const decoded = await registry.readDocumentAs(
      'fig',
      { name: 'library.fig', mimeType: 'application/octet-stream', data: bytes },
      { populate: 'all' }
    )
    const component = [...decoded.graph.nodes.values()].find((node) => node.type === 'COMPONENT')
    if (!component) throw new Error('Expected a decoded .fig component')
    const manifest = await manifestFixture({
      artifactBytes: bytes,
      artifactURL: FIG_ARTIFACT_URL,
      format: 'fig',
      components: [
        {
          key: 'fig-button-key',
          name: component.name,
          version: componentSubtreeVersion(decoded.graph, component.id),
          nodeId: component.id,
          type: 'COMPONENT'
        }
      ]
    })

    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(manifest, () =>
          artifactResponse(bytes, FIG_ARTIFACT_URL, 'application/octet-stream')
        )
      })
    ).rejects.toThrow(new RegExp(`image "${UNSAFE_IMAGE_HASH}".*complete PNG, JPEG, or WebP`))
  })

  test('rejects manifest status, content type, redirect, invalid UTF-8, and declared overflow', async () => {
    const cases: Array<{ response: () => Response; message: string }> = [
      {
        response: () =>
          responseAt(MANIFEST_URL, '{}', {
            status: 503,
            headers: { 'content-type': 'application/json' }
          }),
        message: 'HTTP 503'
      },
      {
        response: () =>
          responseAt(MANIFEST_URL, '<html>', {
            status: 200,
            headers: { 'content-type': 'text/html' }
          }),
        message: 'application/json'
      },
      {
        response: () =>
          responseAt('https://cdn.openpencil.dev/manifest.json', '{}', {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }),
        message: 'redirects'
      },
      {
        response: () =>
          responseAt(MANIFEST_URL, Uint8Array.of(0xc3, 0x28), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }),
        message: 'UTF-8'
      },
      {
        response: () =>
          responseAt(MANIFEST_URL, '{}', {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'content-length': String(REMOTE_LIBRARY_LIMITS.maxManifestBytes + 1)
            }
          }),
        message: 'byte limit'
      }
    ]
    for (const current of cases) {
      const fetchImpl = (async () => current.response()) as typeof globalThis.fetch
      await expect(loadRemoteLibraryCandidate(MANIFEST_URL, { fetchImpl })).rejects.toThrow(
        current.message
      )
    }
  })

  test('requires same-origin artifacts and the exact artifact response media type and URL', async () => {
    const crossOrigin = await manifestFixture({
      artifactURL: 'https://cdn.openpencil.dev/brand/library.pen'
    })
    let calls = 0
    const crossOriginFetch = (async () => {
      calls += 1
      return responseAt(MANIFEST_URL, JSON.stringify(crossOrigin), {
        headers: { 'content-type': 'application/json' }
      })
    }) as typeof globalThis.fetch
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, { fetchImpl: crossOriginFetch })
    ).rejects.toThrow('same origin')
    expect(calls).toBe(1)

    const manifest = await manifestFixture()
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(manifest, () =>
          artifactResponse(PEN_BYTES, ARTIFACT_URL, 'text/plain')
        )
      })
    ).rejects.toThrow('application/json')
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(manifest, () =>
          responseAt(ARTIFACT_URL, PEN_BYTES, {
            status: 404,
            headers: { 'content-type': 'application/json' }
          })
        )
      })
    ).rejects.toThrow('HTTP 404')
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(manifest, () =>
          artifactResponse(PEN_BYTES, 'https://libraries.openpencil.dev/brand/other.pen')
        )
      })
    ).rejects.toThrow('redirects')
  })

  test('rejects declared and streamed artifact overflow and cancels the overflowing reader', async () => {
    const manifest = await manifestFixture()
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(manifest, () =>
          artifactResponse(PEN_BYTES, ARTIFACT_URL, 'application/json', {
            'content-length': String(PEN_BYTES.byteLength + 1)
          })
        )
      })
    ).rejects.toThrow('byte limit')

    let cancelled = false
    const overflow = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PEN_BYTES)
        controller.enqueue(Uint8Array.of(0))
      },
      cancel() {
        cancelled = true
      }
    })
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(manifest, () =>
          responseAt(ARTIFACT_URL, overflow, {
            headers: { 'content-type': 'application/json' }
          })
        )
      })
    ).rejects.toThrow('byte limit')
    expect(cancelled).toBe(true)
  })

  test('requires exact artifact length and SHA-256 digest before decoding', async () => {
    const longerDeclaration = await manifestFixture({ byteLength: PEN_BYTES.byteLength + 1 })
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(longerDeclaration, () =>
          artifactResponse(PEN_BYTES, ARTIFACT_URL, 'application/json', {
            'content-length': String(PEN_BYTES.byteLength)
          })
        )
      })
    ).rejects.toThrow('length mismatch')

    const wrongDigest = await manifestFixture({ digest: 'A'.repeat(43) })
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(wrongDigest, () => artifactResponse())
      })
    ).rejects.toThrow('SHA-256 digest')
  })

  test('uses decoded response bytes when Content-Encoding changes Content-Length semantics', async () => {
    const manifest = await manifestFixture()
    const candidate = await loadRemoteLibraryCandidate(MANIFEST_URL, {
      fetchImpl: fixtureFetch(manifest, () =>
        artifactResponse(PEN_BYTES, ARTIFACT_URL, 'application/json', {
          'content-encoding': 'gzip',
          'content-length': String(Math.max(1, PEN_BYTES.byteLength - 5))
        })
      )
    })

    expect(candidate.sourceGraph.getNode('button')?.type).toBe('COMPONENT')
  })

  test('fails closed when the decoded artifact does not match the component manifest', async () => {
    const manifest = await manifestFixture({
      components: [{ ...VALID_COMPONENT, nodeId: 'missing-component' }]
    })
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: fixtureFetch(manifest, () => artifactResponse())
      })
    ).rejects.toThrow(/does not match.*cannot be resolved/)
  })

  test('combines caller abort and timeout, cancelling an active response reader', async () => {
    const alreadyAborted = new AbortController()
    alreadyAborted.abort(new DOMException('already cancelled', 'AbortError'))
    let preAbortedCalls = 0
    const unexpectedFetch = (async () => {
      preAbortedCalls += 1
      throw new Error('A pre-aborted load must not fetch')
    }) as typeof globalThis.fetch
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, {
        fetchImpl: unexpectedFetch,
        signal: alreadyAborted.signal
      })
    ).rejects.toThrow('already cancelled')
    expect(preAbortedCalls).toBe(0)

    let started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    let cancelled = false
    const pendingBody = new ReadableStream<Uint8Array>({
      pull() {
        started()
      },
      cancel() {
        cancelled = true
      }
    })
    const controller = new AbortController()
    const fetchImpl = (async () =>
      responseAt(MANIFEST_URL, pendingBody, {
        headers: { 'content-type': 'application/json' }
      })) as typeof globalThis.fetch
    const pending = loadRemoteLibraryCandidate(MANIFEST_URL, {
      fetchImpl,
      signal: controller.signal
    })
    await reading
    controller.abort(new DOMException('caller cancelled', 'AbortError'))
    await expect(pending).rejects.toThrow('caller cancelled')
    expect(cancelled).toBe(true)

    const neverFetch = (() =>
      new Promise<Response>(() => {
        void 0
      })) as typeof globalThis.fetch
    await expect(
      loadRemoteLibraryCandidate(MANIFEST_URL, { fetchImpl: neverFetch, timeoutMs: 5 })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

function validManifestShell(): Record<string, unknown> {
  return {
    format: 'openpencil.component-library',
    schemaVersion: 1,
    libraryId: 'brand-library',
    name: 'Brand Library',
    source: { kind: 'url', ref: ARTIFACT_URL },
    artifact: {
      format: 'pen',
      mediaType: 'application/json',
      byteLength: PEN_BYTES.byteLength,
      integrity: { algorithm: 'SHA-256', digest: 'A'.repeat(43) }
    }
  }
}
