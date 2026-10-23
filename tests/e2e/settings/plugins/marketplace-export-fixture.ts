import type { Page } from '@playwright/test'
import { toUint8Array } from 'js-base64'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  signMarketplaceSnapshot,
  signPluginCatalog,
  signVersionedPluginManifest,
  type MarketplaceSnapshotPayloadV1,
  type PluginCatalogPayloadV1
} from '@open-pencil/plugin-contracts'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const SOURCE_ORIGIN = 'https://marketplace-export-fixture.example'
export const MARKETPLACE_EXPORT_SOURCE_URL = `${SOURCE_ORIGIN}/v1/snapshot`
const CATALOG_URL = `${SOURCE_ORIGIN}/v1/catalog/stable`
const ROOT_KEY_ID = 'marketplace.export-test.root'
const PUBLISHER_ID = 'marketplace-export-tests'
const PUBLISHER_KEY_ID = 'marketplace.export-test.publisher'

// Public test-only signing material. This key never grants trust outside this fixture.
const ROOT_PRIVATE_PKCS8 = 'MC4CAQAwBQYDK2VwBCIEIBNKVQcfgrF2LPbUuNqAcl70FwYYv9HUpMhYtOw2IleL'
const ROOT_PUBLIC_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAUjLAaaNw2vUpkgDHQ6P53m/SSbhnS21SUybQRqiQZTw=\n-----END PUBLIC KEY-----'

/** Pass this value to the canonical server when a local .env configures another managed Root. */
export const MARKETPLACE_EXPORT_TRUST_CONFIG_JSON = JSON.stringify({
  schemaVersion: 1,
  url: MARKETPLACE_EXPORT_SOURCE_URL,
  marketplaceId: 'openpencil.marketplace',
  keyId: ROOT_KEY_ID,
  publicKeyPem: ROOT_PUBLIC_PEM,
  channel: 'stable'
})

export const MARKETPLACE_EXPORTERS = [
  {
    pluginId: 'marketplace.design-tokens-exporter',
    exporterId: 'design-tokens-json',
    suffix: '-design-tokens.json',
    kind: 'tokens'
  },
  {
    pluginId: 'marketplace.vue-exporter',
    exporterId: 'vue-source',
    suffix: '-vue.zip',
    kind: 'vue'
  },
  {
    pluginId: 'marketplace.nextjs-exporter',
    exporterId: 'nextjs-source',
    suffix: '-nextjs.zip',
    kind: 'nextjs'
  },
  {
    pluginId: 'marketplace.flutter-exporter',
    exporterId: 'flutter-source',
    suffix: '-flutter.zip',
    kind: 'flutter'
  },
  {
    pluginId: 'marketplace.figma-projection-exporter',
    exporterId: 'figma-editable-projection',
    suffix: '-figma-editable.fig',
    kind: 'fig'
  }
] as const

export const EXPORT_DOCUMENT_TEXT = '新增插件导出验证 Marketplace export'

export async function routeSignedMarketplaceExportFixture(
  page: Page
): Promise<() => Promise<void>> {
  let publishResponses: ((responses: Map<string, unknown>) => void) | undefined
  const responsesReady = new Promise<Map<string, unknown>>((resolve) => {
    publishResponses = resolve
  })
  await page.route(`${SOURCE_ORIGIN}/**`, async (route) => {
    const responses = await responsesReady
    const response = responses.get(route.request().url())
    await route.fulfill({
      status: response ? 200 : 404,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify(response ?? { error: 'Unknown export fixture artifact' })
    })
  })
  return async () => {
    const sourceManifests = await page.evaluate(async () => {
      const { createMarketplacePluginManifests } =
        await import('/src/app/plugins/host/marketplace.ts')
      return createMarketplacePluginManifests()
    })
    const generated = Date.now()
    const generatedAt = new Date(generated).toISOString()
    const expiresAt = new Date(generated + 6 * 24 * 60 * 60 * 1_000).toISOString()
    const rootKey = await crypto.subtle.importKey(
      'pkcs8',
      Uint8Array.from(toUint8Array(ROOT_PRIVATE_PKCS8)).buffer,
      { name: 'Ed25519' },
      false,
      ['sign']
    )
    const publisher = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const manifests = await Promise.all(
      sourceManifests
        .filter((manifest) =>
          MARKETPLACE_EXPORTERS.some(({ pluginId }) => pluginId === manifest.plugin.id)
        )
        .sort((left, right) => left.plugin.id.localeCompare(right.plugin.id))
        .map((manifest) =>
          signVersionedPluginManifest(
            {
              ...manifest,
              publisher: {
                id: PUBLISHER_ID,
                name: 'Marketplace Export Tests',
                keyId: PUBLISHER_KEY_ID
              }
            },
            publisher.privateKey
          )
        )
    )
    const catalogPayload: PluginCatalogPayloadV1 = {
      format: PLUGIN_CATALOG_FORMAT,
      schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
      catalogId: 'openpencil.marketplace.stable',
      version: '1.0.0',
      generatedAt,
      expiresAt,
      entries: manifests.map((manifest) => ({
        pluginId: manifest.plugin.id,
        version: manifest.plugin.version,
        digest: manifest.integrity.digest,
        manifestUrl: `${SOURCE_ORIGIN}/v1/packages/${manifest.plugin.id}`,
        publisherId: PUBLISHER_ID,
        keyId: PUBLISHER_KEY_ID
      }))
    }
    const catalog = await signPluginCatalog(catalogPayload, rootKey, { keyId: ROOT_KEY_ID })
    const snapshotPayload: MarketplaceSnapshotPayloadV1 = {
      format: MARKETPLACE_SNAPSHOT_FORMAT,
      schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
      marketplaceId: 'openpencil.marketplace',
      version: '1.0.0',
      sequence: 1,
      generatedAt,
      expiresAt,
      publisherDirectory: {
        publishers: [
          {
            publisherId: PUBLISHER_ID,
            name: 'Marketplace Export Tests',
            status: 'active',
            keys: [
              {
                keyId: PUBLISHER_KEY_ID,
                publicKeyPem: await exportEd25519PublicKeyPem(publisher.publicKey),
                notBefore: new Date(generated - 60_000).toISOString(),
                notAfter: expiresAt
              }
            ]
          }
        ],
        ownerships: manifests.map((manifest) => ({
          pluginId: manifest.plugin.id,
          publisherId: PUBLISHER_ID,
          status: 'active',
          grantedAt: generatedAt
        }))
      },
      catalogs: [
        {
          channel: 'stable',
          catalogId: catalog.catalogId,
          keyId: ROOT_KEY_ID,
          url: CATALOG_URL,
          digest: catalog.integrity.digest
        }
      ],
      listings: manifests.map((manifest) => ({
        pluginId: manifest.plugin.id,
        publisherId: PUBLISHER_ID,
        name: manifest.plugin.name,
        summary: 'Signed marketplace exporter acceptance fixture.',
        categories: ['exporters'],
        keywords: [],
        releases: [
          { channel: 'stable', version: manifest.plugin.version, digest: manifest.integrity.digest }
        ]
      })),
      auditHead: {
        sequence: 1,
        headDigest: await digestCanonicalManifest({ fixture: 'marketplace-exporters' }),
        url: `${SOURCE_ORIGIN}/v1/audit`
      }
    }
    const snapshot = await signMarketplaceSnapshot(snapshotPayload, rootKey, { keyId: ROOT_KEY_ID })
    const responses = new Map<string, unknown>([
      [MARKETPLACE_EXPORT_SOURCE_URL, snapshot],
      [CATALOG_URL, catalog],
      ...manifests.map((manifest): [string, unknown] => [
        `${SOURCE_ORIGIN}/v1/packages/${manifest.plugin.id}`,
        manifest
      ])
    ])
    if (!publishResponses) throw new Error('Signed fixture response publication is unavailable')
    publishResponses(responses)
  }
}

/** Read a saved projection through Core's public FIG entrypoint without altering the editor. */
export async function readSavedMarketplaceFig(page: Page, bytes: Uint8Array) {
  return page.evaluate(
    async (data) => {
      const { readMarketplaceProjection } =
        await import('/tests/e2e/settings/plugins/marketplace-export-probe.ts')
      return readMarketplaceProjection(data)
    },
    [...bytes]
  )
}

/** Explicit test document setup; export itself is always invoked through the settings UI. */
export async function createMarketplaceExportDocument(page: Page): Promise<void> {
  await page.evaluate((text) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor test API is unavailable')
    const pageId = editor.state.currentPageId
    editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Marketplace export rectangle',
      x: 32,
      y: 32,
      width: 140,
      height: 80,
      fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, visible: true, opacity: 1 }]
    })
    editor.graph.createNode('TEXT', pageId, {
      name: 'Marketplace export Chinese text',
      text,
      x: 32,
      y: 132,
      width: 420,
      height: 40,
      fontFamily: 'Inter',
      fontSize: 20
    })
    const collection = editor.graph.createCollection('Marketplace Theme')
    editor.graph.createVariable('spacing/base', 'FLOAT', collection.id, 8)
  }, EXPORT_DOCUMENT_TEXT)
}

export async function configureMarketplaceExportSource(page: Page): Promise<void> {
  const sourceForm = page.getByTestId('plugin-marketplace-source-form')
  if (await sourceForm.isVisible()) {
    await page
      .getByTestId('plugin-marketplace-source-url-input')
      .fill(MARKETPLACE_EXPORT_SOURCE_URL)
    await page.getByTestId('plugin-marketplace-source-id-input').fill('openpencil.marketplace')
    await page.getByTestId('plugin-marketplace-source-key-input').fill(ROOT_KEY_ID)
    await page.getByTestId('plugin-marketplace-source-pem-input').fill(ROOT_PUBLIC_PEM)
    await page.getByTestId('plugin-marketplace-source-verify').click()
    await page.getByTestId('plugin-marketplace-source-review-confirm').click()
  }
}
