import { describe, expect, test } from 'bun:test'

import {
  OPENPENCIL_MICROFRONTEND_ABI_V1,
  OPENPENCIL_MICROFRONTEND_LIMITS,
  OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT,
  OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION,
  buildOpenPencilMicrofrontendTypes,
  isOpenPencilMicrofrontendRuntimeModule,
  microfrontendSha256Base64URL,
  parseOpenPencilMicrofrontendRuntimeManifest,
  parseOpenPencilMicrofrontendRuntimeManifestJSON,
  parseOpenPencilMicrofrontendRuntimeModule,
  serializeOpenPencilMicrofrontendRuntimeManifest
} from '#compiler/microfrontend'

const ENTRY_DIGEST = microfrontendSha256Base64URL('entry')
const STYLE_DIGEST = microfrontendSha256Base64URL('style')

interface RuntimeAppFixture {
  id: string
  name: string
  version: string
  framework: string
  homepage?: string
}

interface RuntimeAssetFixture {
  path: string
  mediaType: string
  byteLength: number
  digest: string
}

interface RuntimeManifestFixture {
  format: string
  schemaVersion: number
  abi: string
  app: RuntimeAppFixture
  artifact: { entry: RuntimeAssetFixture; styles: RuntimeAssetFixture[] }
  routes: string[]
  extra?: boolean
}

function runtimeManifest(): RuntimeManifestFixture {
  return {
    format: OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT,
    schemaVersion: OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION,
    abi: OPENPENCIL_MICROFRONTEND_ABI_V1,
    app: {
      id: 'acme.storefront',
      name: 'Acme Storefront',
      version: '1.2.3',
      framework: 'react'
    },
    artifact: {
      entry: {
        path: './assets/entry-a1b2.js',
        mediaType: 'text/javascript',
        byteLength: 1234,
        digest: ENTRY_DIGEST
      },
      styles: [
        {
          path: '/assets/style-a1b2.css',
          mediaType: 'text/css',
          byteLength: 456,
          digest: STYLE_DIGEST
        }
      ]
    },
    routes: ['/', '/products/:id', '/filters/:tag?', '/help/*']
  }
}

describe('OpenPencil microfrontend runtime manifest v1', () => {
  test('parses and deeply freezes a React/Vue-neutral ESM artifact contract', () => {
    const parsed = parseOpenPencilMicrofrontendRuntimeManifest(runtimeManifest())

    expect(parsed.app).toEqual({
      id: 'acme.storefront',
      name: 'Acme Storefront',
      version: '1.2.3',
      framework: 'react'
    })
    expect(parsed.artifact.entry.mediaType).toBe('text/javascript')
    expect(parsed.artifact.styles[0].mediaType).toBe('text/css')
    expect(parsed.routes).toEqual(['/', '/products/:id', '/filters/:tag?', '/help/*'])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.app)).toBe(true)
    expect(Object.isFrozen(parsed.artifact)).toBe(true)
    expect(Object.isFrozen(parsed.artifact.styles)).toBe(true)
  })

  test('accepts Vue as the other ABI-compatible framework and rejects unknown ABI versions', () => {
    const manifest = runtimeManifest()
    manifest.app = { ...manifest.app, framework: 'vue' }
    expect(parseOpenPencilMicrofrontendRuntimeManifest(manifest).app.framework).toBe('vue')

    manifest.abi = 'openpencil.microfrontend.v2'
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(manifest)).toThrow(
      'microfrontendManifest.abi must be openpencil.microfrontend.v1'
    )
  })

  test('uses exact records at every manifest level', () => {
    const root = runtimeManifest()
    root.extra = true
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(root)).toThrow(
      'microfrontendManifest contains unsupported fields'
    )

    const nested = runtimeManifest()
    nested.app.homepage = 'https://example.com'
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(nested)).toThrow(
      'microfrontendManifest.app contains unsupported fields'
    )

    const accessor = runtimeManifest()
    Object.defineProperty(accessor, 'routes', { enumerable: true, get: () => ['/'] })
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(accessor)).toThrow(
      'microfrontendManifest.routes must be an enumerable data property'
    )
  })

  test('rejects unsafe paths, URL-shaped paths, traversal, and duplicate asset paths', () => {
    for (const path of [
      'https://cdn.example.com/entry.js',
      '../entry.js',
      './assets/../entry.js',
      './assets/%2e%2e/entry.js',
      '//cdn.example.com/entry.js',
      './entry.js?x=1',
      './entry.js#fragment',
      '.\\entry.js'
    ]) {
      const manifest = runtimeManifest()
      manifest.artifact.entry.path = path
      expect(() => parseOpenPencilMicrofrontendRuntimeManifest(manifest), path).toThrow()
    }

    const duplicate = runtimeManifest()
    const artifact = duplicate.artifact
    artifact.styles[0].path = artifact.entry.path
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(duplicate)).toThrow(
      'asset paths must be unique'
    )
  })

  test('binds entry and styles to their exact media types and byte/digest coordinates', () => {
    const wrongEntryType = runtimeManifest()
    wrongEntryType.artifact.entry.mediaType = 'text/css'
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(wrongEntryType)).toThrow(
      'entry.mediaType must be text/javascript'
    )

    const zeroLength = runtimeManifest()
    zeroLength.artifact.entry.byteLength = 0
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(zeroLength)).toThrow(
      'byteLength must be a positive safe integer'
    )

    const badDigest = runtimeManifest()
    badDigest.artifact.entry.digest = 'deadbeef'
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(badDigest)).toThrow(
      'must be a SHA-256 base64url digest'
    )

    const aggregateTooLarge = runtimeManifest()
    aggregateTooLarge.artifact.entry.byteLength = OPENPENCIL_MICROFRONTEND_LIMITS.maxAssetByteLength
    aggregateTooLarge.artifact.styles[0].byteLength = 1
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(aggregateTooLarge)).toThrow(
      'Runtime manifest aggregate assets exceed the application limit'
    )
  })

  test('bounds and de-duplicates route patterns, including equivalent dynamic shapes', () => {
    const malformed = runtimeManifest()
    malformed.routes = ['/ok', '/bad?query=yes']
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(malformed)).toThrow(
      'malformed route segment'
    )

    const equivalent = runtimeManifest()
    equivalent.routes = ['/products/:id', '/products/:slug']
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(equivalent)).toThrow(
      'unique without equivalent patterns'
    )

    const tooMany = runtimeManifest()
    tooMany.routes = Array.from(
      { length: OPENPENCIL_MICROFRONTEND_LIMITS.maxRoutes + 1 },
      (_, index) => `/route-${index}`
    )
    expect(() => parseOpenPencilMicrofrontendRuntimeManifest(tooMany)).toThrow(
      `may not contain more than ${OPENPENCIL_MICROFRONTEND_LIMITS.maxRoutes} entries`
    )
  })

  test('serializes canonically, parses bounded JSON, and shares a deterministic digest helper', () => {
    const first = serializeOpenPencilMicrofrontendRuntimeManifest(runtimeManifest())
    const reordered = runtimeManifest()
    reordered.app = {
      framework: 'react',
      version: '1.2.3',
      name: 'Acme Storefront',
      id: 'acme.storefront'
    }
    const second = serializeOpenPencilMicrofrontendRuntimeManifest(reordered)

    expect(first).toBe(second)
    expect(first.endsWith('\n')).toBe(true)
    expect(parseOpenPencilMicrofrontendRuntimeManifestJSON(first).app.id).toBe('acme.storefront')
    expect(microfrontendSha256Base64URL('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
    expect(() =>
      parseOpenPencilMicrofrontendRuntimeManifestJSON(
        ' '.repeat(OPENPENCIL_MICROFRONTEND_LIMITS.maxRuntimeManifestJsonBytes + 1)
      )
    ).toThrow('must be bounded JSON text')
  })
})

describe('OpenPencil microfrontend direct ESM ABI v1', () => {
  const validModule = () => ({
    bootstrap: () => Promise.resolve(),
    mount: () => Promise.resolve(),
    update: () => Promise.resolve(),
    unmount: () => Promise.resolve()
  })

  test('emits self-contained generated-project ABI types', () => {
    const source = buildOpenPencilMicrofrontendTypes()
    expect(source).toContain("OPENPENCIL_MICROFRONTEND_ABI_V1 = 'openpencil.microfrontend.v1'")
    expect(source).toContain('mount(container: HTMLElement')
    expect(source).toContain('portalTarget: HTMLElement')
    expect(source).toContain('subscribe(topic: string')
    expect(source.endsWith('\n')).toBe(true)
    expect(source).not.toContain('@open-pencil/compiler')
  })

  test('accepts exactly bootstrap/mount/update/unmount functions', () => {
    const module = validModule()
    expect(parseOpenPencilMicrofrontendRuntimeModule(module)).toBe(module)
    expect(isOpenPencilMicrofrontendRuntimeModule(module)).toBe(true)
  })

  test('rejects missing, non-function, accessor, and extra exports', () => {
    expect(() =>
      parseOpenPencilMicrofrontendRuntimeModule({ ...validModule(), bootstrap: undefined })
    ).toThrow('bootstrap must be a data-property function')
    expect(() =>
      parseOpenPencilMicrofrontendRuntimeModule({ ...validModule(), debug: true })
    ).toThrow('must export exactly')
    const accessor = validModule()
    Object.defineProperty(accessor, 'mount', {
      enumerable: true,
      get: () => () => Promise.resolve()
    })
    expect(() => parseOpenPencilMicrofrontendRuntimeModule(accessor)).toThrow(
      'mount must be a data-property function'
    )
    const symbol = Object.assign(validModule(), { [Symbol('hidden')]: true })
    expect(() => parseOpenPencilMicrofrontendRuntimeModule(symbol)).toThrow('must export exactly')
    expect(isOpenPencilMicrofrontendRuntimeModule(null)).toBe(false)
  })
})
