/* eslint-disable max-lines -- Store persistence, trust, and lifecycle regressions share one fixture. */
import { describe, expect, test } from 'bun:test'

import {
  CHART_MODULE_TYPE,
  CHART_PLUGIN_ID,
  MAP_MODULE_TYPE,
  MAP_PLUGIN_ID,
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  parseTrustedPluginKeyring,
  signPluginManifest,
  signVersionedPluginManifest,
  verifyPluginPackage,
  type PluginManifest,
  type PluginManifestPayloadV1,
  type VerifiedPluginPackage
} from '@open-pencil/core/plugins'

import {
  appPluginStoreReady,
  createAppPluginStore as createAppPluginStoreBase,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppPluginActivationCompatibilityPolicy,
  type AppPluginRemoteCatalogMetadata,
  type CreateAppPluginStoreOptions,
  type PersistedAppPluginStateV2
} from '@/app/plugins'

import { pluginPayload } from '#tests/engine/plugins/helpers'

const ENGINE_VERSION = '0.13.2'
const ALLOW_ACTIVATION: AppPluginActivationCompatibilityPolicy = () => ({ ok: true })

function createAppPluginStore(
  options: Omit<CreateAppPluginStoreOptions, 'activationCompatibilityPolicy'>,
  activationCompatibilityPolicy: AppPluginActivationCompatibilityPolicy = ALLOW_ACTIVATION
) {
  return createAppPluginStoreBase({ ...options, activationCompatibilityPolicy })
}

function bundled(
  manifest: PluginManifestPayloadV1,
  defaults: { installedByDefault?: boolean; enabledByDefault?: boolean } = {}
) {
  return { trustSource: 'app-bundle' as const, manifest, ...defaults }
}

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function verified(
  keyPair: CryptoKeyPair,
  version: string,
  moduleName = 'Chart'
): Promise<VerifiedPluginPackage> {
  const manifest = await signPluginManifest(pluginPayload(version, moduleName), keyPair.privateKey)
  return verifyPluginPackage(manifest, keyPair.publicKey, { engineVersion: ENGINE_VERSION })
}

function publisherEntry(
  keyPair: CryptoKeyPair,
  manifest: PluginManifest,
  remoteCatalog?: AppPluginRemoteCatalogMetadata
) {
  return {
    trustSource: 'publisher-signature' as const,
    manifest,
    trustedPublicKey: keyPair.publicKey,
    expectedPluginId: manifest.plugin.id,
    expectedPublisherId: manifest.publisher.id,
    expectedKeyId: manifest.publisher.keyId,
    ...(remoteCatalog ? { remoteCatalog } : {})
  }
}

function remoteCatalogMetadata(
  catalogVersion: string,
  catalogDigest: string,
  catalogExpiresAt = '2027-01-01T00:00:00.000Z'
): AppPluginRemoteCatalogMetadata {
  return {
    catalogId: 'open-pencil.marketplace',
    catalogVersion,
    catalogDigest,
    catalogExpiresAt,
    source: 'network'
  }
}

describe('app plugin store', () => {
  test('loads bundled defaults and gates new module creation through install and enable state', async () => {
    const storage = createMemoryAppPluginStateStorage()
    const catalog = createBundledPluginCatalog()
    const store = createAppPluginStore({ storage, catalog, engineVersion: ENGINE_VERSION })

    const loaded = await store.load()
    expect(loaded.error).toBeNull()
    expect(loaded.installed).toHaveLength(1)
    expect(loaded.installed[0]).toMatchObject({
      enabled: true,
      package: { manifest: { plugin: { id: MAP_PLUGIN_ID } } }
    })
    expect(store.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
    expect(store.canCreateModule(CHART_PLUGIN_ID, CHART_MODULE_TYPE)).toBe(false)

    const installedChart = await store.install(CHART_PLUGIN_ID)
    expect(installedChart.enabled).toBe(false)
    expect(store.canCreateModule(CHART_PLUGIN_ID, CHART_MODULE_TYPE)).toBe(false)

    await store.setEnabled(CHART_PLUGIN_ID, true)
    expect(store.canCreateModule(CHART_PLUGIN_ID, CHART_MODULE_TYPE)).toBe(true)
    expect(store.module(CHART_PLUGIN_ID, CHART_MODULE_TYPE)?.contribution.adapterId).toBe(
      'open-pencil.chart'
    )

    const pinned = await store.setPinned(CHART_PLUGIN_ID, true)
    expect(pinned.pinnedDigest).toBe(pinned.package.digest)
    await store.setPinned(CHART_PLUGIN_ID, false)
    expect(
      store
        .snapshot()
        .installed.find(({ package: value }) => value.manifest.plugin.id === CHART_PLUGIN_ID)
        ?.pinnedDigest
    ).toBeNull()

    await store.setEnabled(CHART_PLUGIN_ID, false)
    expect(store.canCreateModule(CHART_PLUGIN_ID, CHART_MODULE_TYPE)).toBe(false)
    await store.uninstall(CHART_PLUGIN_ID)
    expect(
      store.snapshot().installed.map(({ package: value }) => value.manifest.plugin.id)
    ).toEqual([MAP_PLUGIN_ID])

    const reloaded = createAppPluginStore({ storage, catalog, engineVersion: ENGINE_VERSION })
    await reloaded.load()
    expect(
      reloaded.snapshot().installed.map(({ package: value }) => value.manifest.plugin.id)
    ).toEqual([MAP_PLUGIN_ID])
  })

  test('migrates an unpinned app-bundle digest without changing installed or enabled state', async () => {
    const storage = createMemoryAppPluginStateStorage()
    const initial = pluginPayload('1.0.0')
    const first = createAppPluginStore({
      storage,
      catalog: [bundled(initial, { installedByDefault: true })],
      engineVersion: ENGINE_VERSION
    })
    await first.load()
    await first.setEnabled(initial.plugin.id, true)
    const oldDigest = first.snapshot().installed[0].package.digest

    const update = pluginPayload('1.1.0', 'Chart Pro')
    const second = createAppPluginStore({
      storage,
      catalog: [bundled(update)],
      engineVersion: ENGINE_VERSION
    })
    const loaded = await second.load()

    expect(loaded.error).toBeNull()
    expect(loaded.installed[0]).toMatchObject({ enabled: true, pinnedDigest: null })
    expect(loaded.installed[0].package.digest).not.toBe(oldDigest)
    expect((await storage.list())[0]).toMatchObject({
      activeDigest: loaded.installed[0].package.digest,
      installed: true,
      enabled: true,
      pinnedDigest: null
    })
  })

  test('fails closed for pinned app-bundle changes and stages signed package updates', async () => {
    const bundleStorage = createMemoryAppPluginStateStorage()
    const initialPayload = pluginPayload('1.0.0')
    const initialStore = createAppPluginStore({
      storage: bundleStorage,
      catalog: [bundled(initialPayload, { installedByDefault: true })],
      engineVersion: ENGINE_VERSION
    })
    await initialStore.load()
    const previousDigest = (await initialStore.setPinned(initialPayload.plugin.id, true))
      .pinnedDigest
    if (!previousDigest) throw new Error('Expected an exact pinned digest')

    const changedBundle = createAppPluginStore({
      storage: bundleStorage,
      catalog: [bundled(pluginPayload('1.1.0'))],
      engineVersion: ENGINE_VERSION
    })
    const pinnedResult = await changedBundle.load()
    expect(pinnedResult.installed).toHaveLength(0)
    expect(pinnedResult.error?.message).toContain('pinned')
    expect(pinnedResult.catalog).toHaveLength(1)
    expect(pinnedResult.catalog[0].installed).toBe(false)
    expect(pinnedResult.pinnedDigestMismatches).toEqual([
      {
        pluginId: initialPayload.plugin.id,
        previousDigest,
        catalogDigest: pinnedResult.catalog[0].package.digest
      }
    ])
    await expect(changedBundle.install(initialPayload.plugin.id)).rejects.toThrow(
      'requires explicit confirmation'
    )
    await expect(
      changedBundle.replacePinnedDigest(initialPayload.plugin.id, 'wrong-digest')
    ).rejects.toThrow('requires explicit confirmation')
    expect((await bundleStorage.list())[0]).toMatchObject({
      activeDigest: previousDigest,
      pinnedDigest: previousDigest
    })
    await changedBundle.replacePinnedDigest(initialPayload.plugin.id, previousDigest)
    expect(changedBundle.snapshot().installed).toHaveLength(1)
    expect(changedBundle.snapshot().installed[0].pinnedDigest).toBeNull()
    expect(changedBundle.snapshot().pinnedDigestMismatches).toHaveLength(0)
    expect(changedBundle.snapshot().error).toBeNull()

    const keyPair = await keys()
    const signedStorage = createMemoryAppPluginStateStorage()
    const signedInitial = await verified(keyPair, '1.0.0')
    const signedStore = createAppPluginStore({
      storage: signedStorage,
      catalog: [publisherEntry(keyPair, signedInitial.manifest)],
      engineVersion: ENGINE_VERSION
    })
    await signedStore.load()
    await signedStore.install(signedInitial.manifest.plugin.id)

    const signedChanged = createAppPluginStore({
      storage: signedStorage,
      catalog: [publisherEntry(keyPair, (await verified(keyPair, '1.1.0')).manifest)],
      engineVersion: ENGINE_VERSION
    })
    const signedResult = await signedChanged.load()
    expect(signedResult.error).toBeNull()
    expect(signedResult.installed).toHaveLength(1)
    expect(signedResult.installed[0].installedState).toMatchObject({
      accepted: { manifest: { plugin: { version: '1.0.0' } } },
      pending: { candidate: { manifest: { plugin: { version: '1.1.0' } } } }
    })
  })

  test('retries a transient storage load failure', async () => {
    const backing = createMemoryAppPluginStateStorage()
    let failNextList = true
    const storage = {
      async list() {
        if (failNextList) {
          failNextList = false
          throw new Error('transient IndexedDB failure')
        }
        return backing.list()
      },
      put: backing.put,
      delete: backing.delete
    }
    const store = createAppPluginStore({
      storage,
      catalog: createBundledPluginCatalog(),
      engineVersion: ENGINE_VERSION
    })

    const failed = await store.load()
    expect(failed.error?.message).toBe('transient IndexedDB failure')
    expect(failed.catalog).toHaveLength(0)

    const retried = await store.load()
    expect(retried.error).toBeNull()
    expect(retried.catalog).toHaveLength(createBundledPluginCatalog().length)
    expect(retried.installed[0]).toMatchObject({
      enabled: true,
      package: { manifest: { plugin: { id: MAP_PLUGIN_ID } } }
    })
  })

  test('exposes a future-schema issue and resets only its exact local plugin record', async () => {
    const storage = createMemoryAppPluginStateStorage([
      {
        schemaVersion: 999,
        pluginId: MAP_PLUGIN_ID,
        trustSource: 'app-bundle',
        activeDigest: 'future-digest',
        installed: true,
        enabled: true,
        pinnedDigest: null
      }
    ])
    const store = createAppPluginStore({
      storage,
      catalog: createBundledPluginCatalog(),
      engineVersion: ENGINE_VERSION
    })

    const loaded = await store.load()
    expect(loaded.error?.message).toContain('unsupported schema version')
    expect(loaded.recordIssues).toEqual([{ pluginId: MAP_PLUGIN_ID, kind: 'unsupported-schema' }])
    expect(loaded.installed).toHaveLength(0)

    const reset = await store.resetLocalState(MAP_PLUGIN_ID)
    expect(reset.error).toBeNull()
    expect(reset.recordIssues).toEqual([])
    expect(reset.installed).toContainEqual(
      expect.objectContaining({
        enabled: true,
        package: expect.objectContaining({
          manifest: expect.objectContaining({
            plugin: expect.objectContaining({ id: MAP_PLUGIN_ID })
          })
        })
      })
    )
    expect(await storage.list()).toContainEqual(
      expect.objectContaining({
        schemaVersion: 2,
        pluginId: MAP_PLUGIN_ID,
        installed: true,
        enabled: true
      })
    )
  })

  test('does not expose a reset target without a trusted catalog plugin id', async () => {
    const records: unknown[] = [
      {
        schemaVersion: 999,
        pluginId: 'retired.plugin',
        trustSource: 'app-bundle',
        activeDigest: 'retired-digest',
        installed: false,
        enabled: false,
        pinnedDigest: null
      }
    ]
    const deletedPluginIds: string[] = []
    const storage = {
      async list() {
        return structuredClone(records)
      },
      async put(record: unknown) {
        records.push(structuredClone(record))
      },
      async delete(pluginId: string) {
        deletedPluginIds.push(pluginId)
      }
    }
    const store = createAppPluginStore({
      storage,
      catalog: createBundledPluginCatalog(),
      engineVersion: ENGINE_VERSION
    })

    const loaded = await store.load()
    expect(loaded.error).not.toBeNull()
    expect(loaded.recordIssues).toEqual([{ pluginId: null, kind: 'unsupported-schema' }])
    await expect(store.resetLocalState(MAP_PLUGIN_ID)).rejects.toThrow(
      'does not have resettable local state'
    )
    expect(deletedPluginIds).toEqual([])
  })

  test('honors a current uninstall record after more than one catalog generation of stale state', async () => {
    const currentStorage = createMemoryAppPluginStateStorage()
    const current = createAppPluginStore({
      storage: currentStorage,
      catalog: createBundledPluginCatalog(),
      engineVersion: ENGINE_VERSION
    })
    await current.load()
    await current.uninstall(MAP_PLUGIN_ID)
    const [mapTombstone] = await currentStorage.list()
    const staleRecords = Array.from({ length: 64 }, (_, index) => ({
      schemaVersion: 1,
      pluginId: `retired.plugin-${index}`,
      trustSource: 'app-bundle',
      activeDigest: `retired-${index}`,
      installed: false,
      enabled: false,
      pinnedDigest: null
    }))
    const storage = createMemoryAppPluginStateStorage([...staleRecords, mapTombstone])
    const store = createAppPluginStore({
      storage,
      catalog: createBundledPluginCatalog(),
      engineVersion: ENGINE_VERSION
    })

    const loaded = await store.load()

    expect(loaded.error).toBeNull()
    expect(loaded.installed).toHaveLength(0)
    expect(store.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(false)
  })

  test('rejects malformed and engine-incompatible catalog entries', async () => {
    const incompatible = pluginPayload()
    incompatible.engineRange = '>=1.0.0'
    const incompatibleStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [bundled(incompatible)],
      engineVersion: ENGINE_VERSION
    })
    expect((await incompatibleStore.load()).error?.message).toContain('requires OpenPencil')

    const malformed = structuredClone(pluginPayload()) as PluginManifestPayloadV1 & {
      executable?: string
    }
    malformed.executable = 'alert(1)'
    const malformedStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [bundled(malformed)],
      engineVersion: ENGINE_VERSION
    })
    expect((await malformedStore.load()).error?.message).toContain('unsupported')

    const keyPair = await keys()
    const signed = await verified(keyPair, '1.0.0')
    const tampered = structuredClone(signed.manifest)
    tampered.plugin.name = 'Forged Publisher Package'
    const tamperedStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [publisherEntry(keyPair, tampered)],
      engineVersion: ENGINE_VERSION
    })
    expect((await tamperedStore.load()).error?.message).toContain('digest mismatch')

    const wrongOwner = publisherEntry(keyPair, signed.manifest)
    const ownershipStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [{ ...wrongOwner, expectedPublisherId: 'another-publisher' }],
      engineVersion: ENGINE_VERSION
    })
    expect((await ownershipStore.load()).error?.message).toContain('publisher')
  })

  test('loads bundled v2 manifests and fails closed for an unknown manifest version', async () => {
    const v2Entry = createBundledPluginCatalog().find(
      (entry) => entry.manifest.plugin.id === 'open-pencil.accessibility-audit'
    )
    if (v2Entry?.manifest.schemaVersion !== 2) {
      throw new Error('Expected bundled v2 plugin')
    }
    const v2Store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [{ ...v2Entry, installedByDefault: true, enabledByDefault: true }],
      engineVersion: ENGINE_VERSION
    })
    const loaded = await v2Store.load()
    expect(loaded.error).toBeNull()
    expect(loaded.installed[0].package.manifest.schemaVersion).toBe(2)
    expect(v2Store.installedCommands()).toHaveLength(1)

    const unknownVersion = { ...structuredClone(v2Entry.manifest), schemaVersion: 99 }
    const futureStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [
        {
          trustSource: 'app-bundle',
          manifest: unknownVersion as never
        }
      ],
      engineVersion: ENGINE_VERSION
    })
    expect((await futureStore.load()).error?.message).toContain('schemaVersion is not supported')
  })

  test('cryptographically verifies and activates a publisher-signed v2 package', async () => {
    const keyPair = await keys()
    const bundledV2 = createBundledPluginCatalog().find(
      (entry) => entry.manifest.plugin.id === 'open-pencil.accessibility-audit'
    )?.manifest
    if (bundledV2?.schemaVersion !== 2) {
      throw new Error('Expected bundled v2 manifest')
    }
    const signed = await signVersionedPluginManifest(bundledV2, keyPair.privateKey)
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [publisherEntry(keyPair, signed)],
      engineVersion: ENGINE_VERSION
    })

    expect((await store.load()).error).toBeNull()
    await store.install(signed.plugin.id)
    await store.setEnabled(signed.plugin.id, true)
    const installed = store.snapshot().installed[0]
    expect(installed.package.manifest.schemaVersion).toBe(2)
    expect(installed.package.verifiedPackage?.manifest.schemaVersion).toBe(2)
    expect(store.installedCommands()).toHaveLength(1)
  })

  test('persists explicit signed update review, acceptance, rejection, and rollback', async () => {
    const keyPair = await keys()
    const storage = createMemoryAppPluginStateStorage()
    const initial = await verified(keyPair, '1.0.0')
    const first = createAppPluginStore({
      storage,
      catalog: [publisherEntry(keyPair, initial.manifest)],
      engineVersion: ENGINE_VERSION
    })
    await first.load()
    await first.install(initial.manifest.plugin.id)
    await first.setEnabled(initial.manifest.plugin.id, true)

    const update = await verified(keyPair, '1.1.0', 'Chart Pro')
    const second = createAppPluginStore({
      storage,
      catalog: [publisherEntry(keyPair, update.manifest)],
      engineVersion: ENGINE_VERSION
    })
    await second.load()
    expect(second.snapshot().installed[0].package.manifest.plugin.version).toBe('1.0.0')
    expect(second.snapshot().installed[0].installedState?.pending?.diff).toMatchObject({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      updatedModules: ['chart']
    })

    await second.acceptUpdate(initial.manifest.plugin.id)
    expect(second.snapshot().installed[0]).toMatchObject({
      enabled: true,
      package: { manifest: { plugin: { version: '1.1.0' } } },
      installedState: {
        history: [{ manifest: { plugin: { version: '1.0.0' } } }]
      }
    })

    const reloaded = createAppPluginStore({
      storage,
      catalog: [publisherEntry(keyPair, update.manifest)],
      engineVersion: ENGINE_VERSION
    })
    await reloaded.load()
    expect(reloaded.snapshot().installed[0].package.manifest.plugin.version).toBe('1.1.0')
    await reloaded.rollback(initial.manifest.plugin.id, '1.0.0')
    expect(reloaded.snapshot().installed[0].package.manifest.plugin.version).toBe('1.0.0')

    const nextUpdate = await verified(keyPair, '1.2.0', 'Chart Next')
    const reviewAgain = createAppPluginStore({
      storage,
      catalog: [publisherEntry(keyPair, nextUpdate.manifest)],
      engineVersion: ENGINE_VERSION
    })
    await reviewAgain.load()
    expect(reviewAgain.snapshot().installed[0].installedState?.pending).toBeDefined()
    await reviewAgain.rejectUpdate(initial.manifest.plugin.id)
    expect(reviewAgain.snapshot().installed[0].installedState?.pending).toBeUndefined()
    expect(reviewAgain.snapshot().installed[0].package.manifest.plugin.version).toBe('1.0.0')
  })

  test('binds remote catalog provenance only to its exact accepted package digest', async () => {
    const keyPair = await keys()
    const storage = createMemoryAppPluginStateStorage()
    const initial = await verified(keyPair, '1.0.0')
    const initialCatalog = remoteCatalogMetadata('1.0.0', 'catalog-initial')
    const updateCatalog = remoteCatalogMetadata('1.1.0', 'catalog-update')
    let remoteEntry = publisherEntry(keyPair, initial.manifest, initialCatalog)
    const store = createAppPluginStore({
      storage,
      catalog: [],
      catalogLoader: async () => [remoteEntry],
      engineVersion: ENGINE_VERSION
    })
    await store.load()
    await store.install(initial.manifest.plugin.id)
    expect(store.snapshot().installed[0].package.remoteCatalog?.catalogDigest).toBe(
      'catalog-initial'
    )

    const update = await verified(keyPair, '1.1.0', 'Remote Update')
    remoteEntry = publisherEntry(keyPair, update.manifest, updateCatalog)
    await store.refreshCatalog()

    expect(store.snapshot().installed[0]).toMatchObject({
      package: { manifest: { plugin: { version: '1.0.0' } } },
      installedState: {
        pending: { candidate: { manifest: { plugin: { version: '1.1.0' } } } }
      }
    })
    expect(store.snapshot().installed[0].package.remoteCatalog).toBeUndefined()

    await store.acceptUpdate(initial.manifest.plugin.id)
    expect(store.snapshot().installed[0].package.remoteCatalog?.catalogDigest).toBe(
      'catalog-update'
    )

    await store.rollback(initial.manifest.plugin.id, '1.0.0')
    expect(store.snapshot().installed[0].package.remoteCatalog).toBeUndefined()
  })

  test('enforces activation compatibility across every direct store lifecycle API', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const blockedVersions = new Set<string>()
    const activationPolicy: AppPluginActivationCompatibilityPolicy = (manifest) =>
      blockedVersions.has(manifest.plugin.version)
        ? { ok: false, reason: `Host adapter unavailable for ${manifest.plugin.version}` }
        : { ok: true }

    blockedVersions.add('1.0.0')
    const blockedInstall = createAppPluginStore(
      {
        storage: createMemoryAppPluginStateStorage(),
        catalog: [publisherEntry(keyPair, initial.manifest)],
        engineVersion: ENGINE_VERSION
      },
      activationPolicy
    )
    await blockedInstall.load()
    await expect(blockedInstall.install(initial.manifest.plugin.id)).rejects.toThrow(
      'Host adapter unavailable'
    )

    blockedVersions.clear()
    const storage = createMemoryAppPluginStateStorage()
    const first = createAppPluginStore(
      {
        storage,
        catalog: [publisherEntry(keyPair, initial.manifest)],
        engineVersion: ENGINE_VERSION
      },
      activationPolicy
    )
    await first.load()
    await first.install(initial.manifest.plugin.id)
    await first.setEnabled(initial.manifest.plugin.id, true)

    blockedVersions.add('1.0.0')
    expect(first.snapshot().installed[0]).toMatchObject({
      enabled: false,
      blockedReason: expect.stringContaining('Host adapter unavailable')
    })
    expect(first.installedModules()).toEqual([])
    expect(first.canCreateModule(initial.manifest.plugin.id, 'chart')).toBe(false)
    await expect(first.setEnabled(initial.manifest.plugin.id, true)).rejects.toThrow(
      'Host adapter unavailable'
    )

    blockedVersions.clear()
    const update = await verified(keyPair, '1.1.0', 'Compatible Update')
    const updated = createAppPluginStore(
      {
        storage,
        catalog: [publisherEntry(keyPair, update.manifest)],
        engineVersion: ENGINE_VERSION
      },
      activationPolicy
    )
    await updated.load()
    blockedVersions.add('1.1.0')
    await expect(updated.acceptUpdate(initial.manifest.plugin.id)).rejects.toThrow(
      'Host adapter unavailable'
    )
    expect(updated.snapshot().installed[0].installedState?.pending).toBeDefined()

    blockedVersions.delete('1.1.0')
    await updated.acceptUpdate(initial.manifest.plugin.id)
    blockedVersions.add('1.0.0')
    await expect(updated.rollback(initial.manifest.plugin.id, '1.0.0')).rejects.toThrow(
      'Host adapter unavailable'
    )
    expect(updated.snapshot().installed[0].package.manifest.plugin.version).toBe('1.1.0')
  })

  test('requires a fresh exact catalog for install and accept but keeps accepted modules usable', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const update = await verified(keyPair, '1.1.0', 'Catalog Update')
    const trustedKeyring = parseTrustedPluginKeyring({
      schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
      keys: [
        {
          keyId: 'acme.release',
          publisherId: 'acme',
          pluginIds: ['acme.analytics'],
          publicKey: keyPair.publicKey,
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        }
      ]
    })
    const catalogExpiry = '2026-08-06T00:00:00.000Z'
    let currentTime = Date.parse('2026-08-05T00:00:00.000Z')
    let remoteEntries = [
      publisherEntry(
        keyPair,
        initial.manifest,
        remoteCatalogMetadata('1.0.0', 'catalog-initial', catalogExpiry)
      )
    ]
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      catalogLoader: async () => remoteEntries,
      trustedKeyring,
      now: () => currentTime,
      engineVersion: ENGINE_VERSION
    })
    await store.load()

    currentTime = Date.parse('2026-08-07T00:00:00.000Z')
    await expect(store.install(initial.manifest.plugin.id)).rejects.toThrow('refresh the catalog')

    currentTime = Date.parse('2026-08-05T00:00:00.000Z')
    await store.install(initial.manifest.plugin.id)
    await store.setEnabled(initial.manifest.plugin.id, true)
    remoteEntries = [
      publisherEntry(
        keyPair,
        update.manifest,
        remoteCatalogMetadata('1.1.0', 'catalog-update', catalogExpiry)
      )
    ]
    await store.refreshCatalog()
    expect(store.snapshot().installed[0].installedState?.pending).toBeDefined()

    remoteEntries = []
    await store.refreshCatalog()
    await expect(store.acceptUpdate(initial.manifest.plugin.id)).rejects.toThrow(
      'current verified catalog package'
    )

    remoteEntries = [
      publisherEntry(
        keyPair,
        update.manifest,
        remoteCatalogMetadata('1.1.0', 'catalog-update', catalogExpiry)
      )
    ]
    await store.refreshCatalog()
    currentTime = Date.parse('2026-08-07T00:00:00.000Z')
    await expect(store.acceptUpdate(initial.manifest.plugin.id)).rejects.toThrow(
      'refresh the catalog'
    )
    expect(store.canCreateModule(initial.manifest.plugin.id, 'chart')).toBe(true)
    await store.setEnabled(initial.manifest.plugin.id, false)
    await store.setEnabled(initial.manifest.plugin.id, true)
    expect(store.canCreateModule(initial.manifest.plugin.id, 'chart')).toBe(true)
    expect(store.snapshot().installed[0].package.manifest.plugin.version).toBe('1.0.0')
  })

  test('exposes a reset action for a known plugin with a corrupt signed snapshot', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const catalog = [publisherEntry(keyPair, initial.manifest)]
    const originalStorage = createMemoryAppPluginStateStorage()
    const original = createAppPluginStore({
      storage: originalStorage,
      catalog,
      engineVersion: ENGINE_VERSION
    })
    await original.load()
    await original.install(initial.manifest.plugin.id)

    const [storedValue] = await originalStorage.list()
    const stored = storedValue as PersistedAppPluginStateV2
    if (!stored.installedState) throw new Error('Expected a signed installed state')
    const signature = stored.installedState.accepted.manifest.integrity.signature.value
    const corruptSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
    const corruptStorage = createMemoryAppPluginStateStorage([
      {
        ...stored,
        installedState: {
          ...stored.installedState,
          accepted: {
            ...stored.installedState.accepted,
            manifest: {
              ...stored.installedState.accepted.manifest,
              integrity: {
                ...stored.installedState.accepted.manifest.integrity,
                signature: {
                  ...stored.installedState.accepted.manifest.integrity.signature,
                  value: corruptSignature
                }
              }
            }
          }
        }
      }
    ])
    const recovered = createAppPluginStore({
      storage: corruptStorage,
      catalog,
      engineVersion: ENGINE_VERSION
    })

    const loaded = await recovered.load()
    expect(loaded.installed).toHaveLength(0)
    expect(loaded.error?.message).toContain('signature verification failed')
    expect(loaded.recordIssues).toEqual([
      { pluginId: initial.manifest.plugin.id, kind: 'invalid-record' }
    ])

    const reset = await recovered.resetLocalState(initial.manifest.plugin.id)
    expect(reset.error).toBeNull()
    expect(reset.recordIssues).toEqual([])
    expect(await corruptStorage.list()).toHaveLength(0)
    await recovered.install(initial.manifest.plugin.id)
    expect(recovered.snapshot().installed).toHaveLength(1)

    const replacementPayload = pluginPayload('1.1.0', 'New Engine Chart')
    replacementPayload.engineRange = '>=1.0.0 <2.0.0'
    const replacementManifest = await signPluginManifest(replacementPayload, keyPair.privateKey)
    const incompatible = createAppPluginStore({
      storage: originalStorage,
      catalog: [publisherEntry(keyPair, replacementManifest)],
      engineVersion: '1.0.0'
    })
    const incompatibleSnapshot = await incompatible.load()
    expect(incompatibleSnapshot.error?.message).toContain('requires OpenPencil')
    expect(incompatibleSnapshot.recordIssues).toEqual([
      { pluginId: initial.manifest.plugin.id, kind: 'invalid-record' }
    ])
  })

  test('rechecks key expiry before update acceptance and every module creation path', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const update = await verified(keyPair, '1.1.0', 'Expiring Chart')
    const trustedKeyring = parseTrustedPluginKeyring({
      schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
      keys: [
        {
          keyId: 'acme.release',
          publisherId: 'acme',
          pluginIds: ['acme.analytics'],
          publicKey: keyPair.publicKey,
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2026-08-06T00:00:00.000Z'
        }
      ]
    })
    let currentTime = Date.parse('2026-08-05T00:00:00.000Z')
    let remoteEntry = publisherEntry(keyPair, initial.manifest)
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      catalogLoader: async () => [remoteEntry],
      trustedKeyring,
      now: () => currentTime,
      engineVersion: ENGINE_VERSION
    })
    await store.load()
    await store.install(initial.manifest.plugin.id)
    await store.setEnabled(initial.manifest.plugin.id, true)
    remoteEntry = publisherEntry(keyPair, update.manifest)
    await store.refreshCatalog()
    expect(store.canCreateModule(initial.manifest.plugin.id, 'chart')).toBe(true)
    expect(store.module(initial.manifest.plugin.id, 'chart')).not.toBeNull()
    expect(store.snapshot().installed[0].installedState?.pending).toBeDefined()

    currentTime = Date.parse('2026-08-07T00:00:00.000Z')
    expect(store.snapshot().installed[0]).toMatchObject({
      enabled: false,
      blockedReason: expect.stringContaining('expired')
    })
    expect(store.installedModules()).toEqual([])
    expect(store.canCreateModule(initial.manifest.plugin.id, 'chart')).toBe(false)
    expect(store.module(initial.manifest.plugin.id, 'chart')).toBeNull()
    await expect(store.setEnabled(initial.manifest.plugin.id, true)).rejects.toThrow('expired')
    await expect(store.acceptUpdate(initial.manifest.plugin.id)).rejects.toThrow('expired')
    expect(store.snapshot().installed[0].package.manifest.plugin.version).toBe('1.0.0')
    expect(store.snapshot().installed[0].installedState?.pending).toBeDefined()
  })

  test('accepts explicit publisher key rotation and disables a later revoked installation', async () => {
    const firstKeys = await keys()
    const nextKeys = await keys()
    const initial = await verified(firstKeys, '1.0.0')
    const rotatedPayload = pluginPayload('1.1.0', 'Rotated Chart')
    rotatedPayload.publisher.keyId = 'acme.release.v2'
    const rotatedManifest = await signPluginManifest(rotatedPayload, nextKeys.privateKey)
    const validKeyring = parseTrustedPluginKeyring({
      schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
      keys: [
        {
          keyId: 'acme.release',
          publisherId: 'acme',
          pluginIds: ['acme.analytics'],
          publicKey: firstKeys.publicKey,
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        },
        {
          keyId: 'acme.release.v2',
          publisherId: 'acme',
          pluginIds: ['acme.analytics'],
          publicKey: nextKeys.publicKey,
          notBefore: '2026-07-01T00:00:00.000Z',
          notAfter: '2027-07-01T00:00:00.000Z',
          predecessorKeyId: 'acme.release'
        }
      ]
    })
    const storage = createMemoryAppPluginStateStorage()
    const first = createAppPluginStore({
      storage,
      catalog: [publisherEntry(firstKeys, initial.manifest)],
      trustedKeyring: validKeyring,
      now: () => Date.parse('2026-08-05T00:00:00.000Z'),
      engineVersion: ENGINE_VERSION
    })
    await first.load()
    await first.install(initial.manifest.plugin.id)
    await first.setEnabled(initial.manifest.plugin.id, true)

    const rotated = createAppPluginStore({
      storage,
      catalog: [publisherEntry(nextKeys, rotatedManifest)],
      trustedKeyring: validKeyring,
      now: () => Date.parse('2026-08-05T00:00:00.000Z'),
      engineVersion: ENGINE_VERSION
    })
    await rotated.load()
    expect(rotated.snapshot().installed[0].installedState?.pending).toBeDefined()
    await rotated.acceptUpdate(initial.manifest.plugin.id)
    expect(rotated.snapshot().installed[0].package.manifest.publisher.keyId).toBe('acme.release.v2')

    const revokedKeyring = parseTrustedPluginKeyring({
      schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
      keys: [
        validKeyring.keys[0],
        {
          ...validKeyring.keys[1],
          revokedAt: '2026-08-06T00:00:00.000Z',
          revocationReason: 'Compromised key'
        }
      ]
    })
    const revoked = createAppPluginStore({
      storage,
      catalog: [],
      trustedKeyring: revokedKeyring,
      now: () => Date.parse('2026-08-07T00:00:00.000Z'),
      engineVersion: ENGINE_VERSION
    })
    const revokedSnapshot = await revoked.load()
    expect(revokedSnapshot.error).toBeNull()
    expect(revokedSnapshot.installed[0]).toMatchObject({
      enabled: false,
      blockedReason: expect.stringContaining('revoked')
    })
    await expect(revoked.setEnabled(initial.manifest.plugin.id, true)).rejects.toThrow(
      'trust is blocked'
    )
  })

  test('loads the global Bun fallback store with a stable engine version', async () => {
    const snapshot = await appPluginStoreReady
    expect(snapshot.ready).toBe(true)
    expect(snapshot.error).toBeNull()
    expect(snapshot.installed).toContainEqual(
      expect.objectContaining({
        enabled: true,
        package: expect.objectContaining({
          manifest: expect.objectContaining({
            plugin: expect.objectContaining({ id: MAP_PLUGIN_ID })
          })
        })
      })
    )
  })
})
