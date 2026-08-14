import { describe, expect, test } from 'bun:test'

import {
  OPENPENCIL_MICROFRONTEND_ABI_V1,
  OPENPENCIL_MICROFRONTEND_COMPOSITION_FORMAT,
  OPENPENCIL_MICROFRONTEND_COMPOSITION_SCHEMA_VERSION,
  OPENPENCIL_MICROFRONTEND_LIMITS,
  microfrontendSha256Base64URL,
  parseOpenPencilMicrofrontendCompositionManifest,
  parseOpenPencilMicrofrontendCompositionManifestJSON,
  serializeOpenPencilMicrofrontendCompositionManifest
} from '#compiler/microfrontend'

const MANIFEST_DIGEST = microfrontendSha256Base64URL('remote manifest')

interface CompositionCoordinateFixture {
  kind: string
  path?: string
  url?: string
  digest?: string
  byteLength?: number
}

interface CompositionAppFixture {
  appId: string
  manifest: CompositionCoordinateFixture
  routeBase: string
  slotId: string
}

interface CompositionSlotFixture {
  id: string
  label?: string
}

interface CompositionManifestFixture {
  format: string
  schemaVersion: number
  abi: string
  composition: { id: string; name: string; version: string }
  slots: CompositionSlotFixture[]
  apps: CompositionAppFixture[]
  shell?: { html: string }
}

function compositionManifest(): CompositionManifestFixture {
  return {
    format: OPENPENCIL_MICROFRONTEND_COMPOSITION_FORMAT,
    schemaVersion: OPENPENCIL_MICROFRONTEND_COMPOSITION_SCHEMA_VERSION,
    abi: OPENPENCIL_MICROFRONTEND_ABI_V1,
    composition: { id: 'acme.portal', name: 'Acme Portal', version: '1.0.0' },
    slots: [{ id: 'main' }, { id: 'sidebar' }],
    apps: [
      {
        appId: 'acme.home',
        manifest: { kind: 'local', path: './apps/home/openpencil.microfrontend.json' },
        routeBase: '/',
        slotId: 'main'
      },
      {
        appId: 'acme.admin',
        manifest: {
          kind: 'remote',
          url: 'https://cdn.acme.dev/apps/admin/openpencil.microfrontend.json',
          digest: MANIFEST_DIGEST,
          byteLength: 2048
        },
        routeBase: '/admin',
        slotId: 'main'
      },
      {
        appId: 'acme.navigation',
        manifest: { kind: 'local', path: './apps/navigation/openpencil.microfrontend.json' },
        routeBase: '/',
        slotId: 'sidebar'
      }
    ]
  }
}

function apps(value: CompositionManifestFixture): CompositionAppFixture[] {
  return value.apps
}

describe('OpenPencil microfrontend composition manifest v1', () => {
  test('parses local and digest-pinned remote app coordinates for slot routing', () => {
    const parsed = parseOpenPencilMicrofrontendCompositionManifest(compositionManifest())

    expect(parsed.composition.id).toBe('acme.portal')
    expect(parsed.slots.map((slot) => slot.id)).toEqual(['main', 'sidebar'])
    expect(parsed.apps.map((app) => [app.appId, app.routeBase, app.slotId])).toEqual([
      ['acme.home', '/', 'main'],
      ['acme.admin', '/admin', 'main'],
      ['acme.navigation', '/', 'sidebar']
    ])
    expect(parsed.apps[0].manifest).toEqual({
      kind: 'local',
      path: './apps/home/openpencil.microfrontend.json'
    })
    expect(parsed.apps[1].manifest.kind).toBe('remote')
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.apps)).toBe(true)
    expect(Object.isFrozen(parsed.apps[1].manifest)).toBe(true)
  })

  test('rejects unknown fields and mixed local/remote coordinate shapes', () => {
    const root = compositionManifest()
    root.shell = { html: 'index.html' }
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(root)).toThrow(
      'microfrontendComposition contains unsupported fields'
    )

    const mixed = compositionManifest()
    apps(mixed)[0].manifest.url = 'https://cdn.acme.dev/home.json'
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(mixed)).toThrow(
      'apps[0].manifest contains unsupported fields'
    )

    const slot = compositionManifest()
    slot.slots[0].label = 'Main'
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(slot)).toThrow(
      'slots[0] contains unsupported fields'
    )
  })

  test('requires unique slot ids, app ids, and manifest coordinates', () => {
    const duplicateSlot = compositionManifest()
    duplicateSlot.slots = [{ id: 'main' }, { id: 'main' }]
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(duplicateSlot)).toThrow(
      'slots ids must be unique'
    )

    const duplicateApp = compositionManifest()
    apps(duplicateApp)[1].appId = 'acme.home'
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(duplicateApp)).toThrow(
      'appId values must be unique'
    )

    const duplicateCoordinate = compositionManifest()
    apps(duplicateCoordinate)[1].manifest = {
      kind: 'local',
      path: './apps/home/openpencil.microfrontend.json'
    }
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(duplicateCoordinate)).toThrow(
      'manifest coordinates must be unique'
    )
  })

  test('requires known slots and rejects the same routeBase twice within one slot', () => {
    const unknownSlot = compositionManifest()
    apps(unknownSlot)[0].slotId = 'missing'
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(unknownSlot)).toThrow(
      'references unknown slot missing'
    )

    const routeConflict = compositionManifest()
    apps(routeConflict)[1].routeBase = '/'
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(routeConflict)).toThrow(
      'may not repeat a routeBase within the same slot'
    )

    const differentSlots = compositionManifest()
    apps(differentSlots)[1].routeBase = '/settings'
    apps(differentSlots)[2].routeBase = '/settings'
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(differentSlots)).not.toThrow()
  })

  test('allows only static canonical route bases and safe local paths', () => {
    for (const invalidRoute of [
      'admin',
      '//admin',
      '/admin/',
      '/admin/:id',
      '/admin/*',
      '/admin?mode=1',
      '/admin/../root'
    ]) {
      const manifest = compositionManifest()
      apps(manifest)[1].routeBase = invalidRoute
      expect(
        () => parseOpenPencilMicrofrontendCompositionManifest(manifest),
        invalidRoute
      ).toThrow()
    }

    for (const invalidPath of [
      'https://example.com/manifest.json',
      '../manifest.json',
      '/apps/home/manifest.json',
      './apps/%2e%2e/manifest.json',
      '//example.com/manifest.json'
    ]) {
      const manifest = compositionManifest()
      apps(manifest)[0].manifest.path = invalidPath
      expect(() => parseOpenPencilMicrofrontendCompositionManifest(manifest), invalidPath).toThrow()
    }
  })

  test('accepts only canonical public HTTPS remote coordinates pinned by digest and length', () => {
    for (const invalidURL of [
      'http://cdn.example.com/manifest.json',
      'https://user:pass@cdn.example.com/manifest.json',
      'https://localhost/manifest.json',
      'https://manifest.internal/app.json',
      'https://manifest.example/app.json',
      'https://cdn.example.com/app.json',
      'https://cdn.example.net/app.json',
      'https://cdn.example.org/app.json',
      'https://manifest.test/app.json',
      'https://manifest.localdomain/app.json',
      'https://singlelabel/app.json',
      'https://xn--bcher-kva.example.com/app.json',
      'https://127.0.0.1/manifest.json',
      'https://cdn.example.com/manifest.json#fragment',
      'https://cdn.example.com/manifest.json?token=secret',
      'https://cdn.example.com:444/manifest.json'
    ]) {
      const manifest = compositionManifest()
      apps(manifest)[1].manifest.url = invalidURL
      expect(() => parseOpenPencilMicrofrontendCompositionManifest(manifest), invalidURL).toThrow(
        'public HTTPS URL'
      )
    }
  })

  test.each(['https://cdn.example.dev/app.json?', 'https://cdn.example.dev/app.json#'])(
    'rejects an empty query or fragment delimiter in %s',
    (url) => {
      const value = compositionManifest()
      const secondApp = value.apps.at(1)
      if (!secondApp) throw new Error('Expected a second composition app fixture')
      secondApp.manifest = {
        kind: 'remote',
        url,
        digest: MANIFEST_DIGEST,
        byteLength: 100
      }
      expect(() => parseOpenPencilMicrofrontendCompositionManifest(value)).toThrow(
        'canonical public HTTPS URL'
      )
    }
  )

  test('bounds composition cardinality and JSON input before parsing', () => {
    const tooMany = compositionManifest()
    tooMany.apps = Array.from(
      { length: OPENPENCIL_MICROFRONTEND_LIMITS.maxApps + 1 },
      (_, index) => ({
        appId: `app-${index}`,
        manifest: { kind: 'local', path: `./apps/${index}/manifest.json` },
        routeBase: `/app-${index}`,
        slotId: 'main'
      })
    )
    expect(() => parseOpenPencilMicrofrontendCompositionManifest(tooMany)).toThrow(
      `may not contain more than ${OPENPENCIL_MICROFRONTEND_LIMITS.maxApps} entries`
    )

    expect(() =>
      parseOpenPencilMicrofrontendCompositionManifestJSON(
        ' '.repeat(OPENPENCIL_MICROFRONTEND_LIMITS.maxCompositionManifestJsonBytes + 1)
      )
    ).toThrow('must be bounded JSON text')
  })

  test('has deterministic canonical serialization', () => {
    const serialized = serializeOpenPencilMicrofrontendCompositionManifest(compositionManifest())
    const reparsed = parseOpenPencilMicrofrontendCompositionManifestJSON(serialized)

    expect(reparsed.apps[1].appId).toBe('acme.admin')
    expect(serialized).toBe(serializeOpenPencilMicrofrontendCompositionManifest(reparsed))
    expect(serialized.endsWith('\n')).toBe(true)
  })
})
