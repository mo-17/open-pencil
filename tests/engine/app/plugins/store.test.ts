/* eslint-disable max-lines -- Store persistence, trust, and lifecycle regressions share one fixture. */
import { describe, expect, test } from 'bun:test'

import {
  CHART_MODULE_TYPE,
  CHART_PLUGIN_ID,
  MAP_MODULE_TYPE,
  MAP_PLUGIN_ID
} from '@open-pencil/core/plugins'
import {
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  parseTrustedPluginKeyring,
  signPluginManifest,
  signVersionedPluginManifest,
  verifyPluginPackage,
  type PluginManifest,
  type PluginManifestPayloadV1,
  type VerifiedPluginPackage
} from '@open-pencil/plugin-contracts'

import { GOOGLE_DRIVE_STORAGE_PLUGIN_ID } from '@/app/integrations/storage/google-drive/config'
import {
  appPluginStoreReady,
  createAppPluginStore as createAppPluginStoreBase,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppPluginActivationCompatibilityPolicy,
  type AppPluginMarketplaceTrustBundle,
  type AppPluginMarketplaceAuthority,
  type AppPluginRemoteCatalogMetadata,
  type CreateAppPluginStoreOptions,
  type PersistedAppPluginStateV2,
  type PersistedAppPluginStateV3
} from '@/app/plugins'
import { AI_POPOUT_PLUGIN_ID, COMPILER_PREVIEW_POPOUT_PLUGIN_ID } from '@/app/plugins/host/ids'

import { pluginPayload } from '#tests/engine/plugins/helpers'

const ENGINE_VERSION = '0.13.2'
const ALLOW_ACTIVATION: AppPluginActivationCompatibilityPolicy = () => ({ ok: true })
const MARKETPLACE_AUTHORITY: AppPluginMarketplaceAuthority = Object.freeze({
  sourceId: 'source:test',
  trustDomainId: 'trust-domain:test',
  sourceGeneration: 1,
  rootKeySpkiSha256: `sha256-${'A'.repeat(43)}`
})

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

function trustedPublisherKeyring(keyPair: CryptoKeyPair, manifest: PluginManifest) {
  return parseTrustedPluginKeyring({
    schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
    keys: [
      {
        keyId: manifest.publisher.keyId,
        publisherId: manifest.publisher.id,
        pluginIds: [manifest.plugin.id],
        publicKey: keyPair.publicKey,
        notBefore: '2020-01-01T00:00:00.000Z',
        notAfter: '2030-01-01T00:00:00.000Z'
      }
    ]
  })
}

function marketplaceTrustBundle(
  catalog: AppPluginMarketplaceTrustBundle['catalog'],
  trustedKeyring: AppPluginMarketplaceTrustBundle['trustedKeyring'],
  snapshotDigest: string,
  snapshotExpiresAt = '2026-08-06T00:00:00.000Z',
  authority: AppPluginMarketplaceAuthority = MARKETPLACE_AUTHORITY
): AppPluginMarketplaceTrustBundle {
  return {
    catalog,
    trustedKeyring,
    lease: {
      authority,
      marketplaceId: 'open-pencil.marketplace',
      snapshotVersion: '1.0.0',
      snapshotSequence: 1,
      snapshotDigest,
      snapshotExpiresAt
    }
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

type TestPluginStore = ReturnType<typeof createAppPluginStore>

function reviewedCatalogPackage(store: TestPluginStore, pluginId: string) {
  const pluginPackage = store
    .snapshot()
    .catalog.find(({ package: candidate }) => candidate.manifest.plugin.id === pluginId)?.package
  if (!pluginPackage) throw new Error(`Missing reviewed catalog package: ${pluginId}`)
  return structuredClone(pluginPackage)
}

function reviewedInstalledAuthority(store: TestPluginStore, pluginId: string) {
  const plugin = store
    .snapshot()
    .installed.find(({ package: candidate }) => candidate.manifest.plugin.id === pluginId)
  const accepted = plugin?.installedState?.accepted
  if (!accepted) throw new Error(`Missing reviewed installed authority: ${pluginId}`)
  return {
    version: accepted.manifest.plugin.version,
    digest: accepted.verifiedDigest,
    keyId: accepted.verifiedKeyId
  }
}

function installReviewedPublisher(store: TestPluginStore, pluginId: string) {
  return store.installReviewed(pluginId, reviewedCatalogPackage(store, pluginId))
}

function acceptReviewedPublisherUpdate(store: TestPluginStore, pluginId: string) {
  return store.acceptUpdateReviewed(
    pluginId,
    reviewedCatalogPackage(store, pluginId),
    reviewedInstalledAuthority(store, pluginId)
  )
}

describe('app plugin store', () => {
  test('loads bundled defaults and gates new module creation through install and enable state', async () => {
    const storage = createMemoryAppPluginStateStorage()
    const catalog = createBundledPluginCatalog()
    const store = createAppPluginStore({ storage, catalog, engineVersion: ENGINE_VERSION })

    const loaded = await store.load()
    expect(loaded.error).toBeNull()
    expect(loaded.installed).toHaveLength(4)
    expect(
      loaded.installed.find(({ package: value }) => value.manifest.plugin.id === MAP_PLUGIN_ID)
    ).toMatchObject({
      enabled: true,
      package: { manifest: { plugin: { id: MAP_PLUGIN_ID } } }
    })
    expect(
      loaded.installed.find(
        ({ package: value }) => value.manifest.plugin.id === GOOGLE_DRIVE_STORAGE_PLUGIN_ID
      )
    ).toMatchObject({ enabled: true })
    expect(
      loaded.installed.find(
        ({ package: value }) => value.manifest.plugin.id === COMPILER_PREVIEW_POPOUT_PLUGIN_ID
      )
    ).toMatchObject({ enabled: true })
    expect(
      loaded.installed.find(
        ({ package: value }) => value.manifest.plugin.id === AI_POPOUT_PLUGIN_ID
      )
    ).toMatchObject({ enabled: true })
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
    ).toEqual([
      AI_POPOUT_PLUGIN_ID,
      COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
      GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
      MAP_PLUGIN_ID
    ])

    const reloaded = createAppPluginStore({ storage, catalog, engineVersion: ENGINE_VERSION })
    await reloaded.load()
    expect(
      reloaded.snapshot().installed.map(({ package: value }) => value.manifest.plugin.id)
    ).toEqual([
      AI_POPOUT_PLUGIN_ID,
      COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
      GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
      MAP_PLUGIN_ID
    ])
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

  test('smoothly migrates a pinned v2 app-bundle record to v3 authority state', async () => {
    const manifest = pluginPayload('1.0.0')
    const currentStorage = createMemoryAppPluginStateStorage()
    const current = createAppPluginStore({
      storage: currentStorage,
      catalog: [bundled(manifest, { installedByDefault: true })],
      engineVersion: ENGINE_VERSION
    })
    await current.load()
    await current.setEnabled(manifest.plugin.id, true)
    await current.setPinned(manifest.plugin.id, true)
    const [record] = await currentStorage.list()
    const { marketplaceAuthority: _authority, ...currentRecord } =
      record as PersistedAppPluginStateV3
    const previous: PersistedAppPluginStateV2 = { ...currentRecord, schemaVersion: 2 }
    const storage = createMemoryAppPluginStateStorage([previous])
    const migrated = createAppPluginStore({
      storage,
      catalog: [bundled(manifest)],
      engineVersion: ENGINE_VERSION
    })

    const snapshot = await migrated.load()
    expect(snapshot.error).toBeNull()
    expect(snapshot.installed[0]).toMatchObject({
      enabled: true,
      pinnedDigest: snapshot.installed[0].package.digest
    })
    expect((await storage.list())[0]).toMatchObject({
      schemaVersion: 3,
      marketplaceAuthority: null,
      pinnedDigest: snapshot.installed[0].package.digest
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
    const trustedKeyring = trustedPublisherKeyring(keyPair, signedInitial.manifest)
    const signedStore = createAppPluginStore({
      storage: signedStorage,
      catalog: [publisherEntry(keyPair, signedInitial.manifest)],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    await signedStore.load()
    await installReviewedPublisher(signedStore, signedInitial.manifest.plugin.id)

    const signedChanged = createAppPluginStore({
      storage: signedStorage,
      catalog: [publisherEntry(keyPair, (await verified(keyPair, '1.1.0')).manifest)],
      trustedKeyring,
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
      revision: backing.revision,
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
    expect(
      retried.installed.find(({ package: value }) => value.manifest.plugin.id === MAP_PLUGIN_ID)
    ).toMatchObject({
      enabled: true,
      package: { manifest: { plugin: { id: MAP_PLUGIN_ID } } }
    })
  })

  test('serializes catalog refresh behind an in-flight plugin mutation', async () => {
    const backing = createMemoryAppPluginStateStorage()
    let releasePut: (() => void) | undefined
    let markPutStarted: (() => void) | undefined
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve
    })
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve
    })
    const storage = {
      revision: backing.revision,
      list: backing.list,
      async put(record: unknown) {
        markPutStarted?.()
        await putGate
        await backing.put(record)
      },
      delete: backing.delete
    }
    let refreshLoads = 0
    const plugin = pluginPayload('1.0.0')
    const store = createAppPluginStore({
      storage,
      catalog: [bundled(plugin)],
      catalogLoader: async () => {
        refreshLoads += 1
        return []
      },
      engineVersion: ENGINE_VERSION
    })
    await store.load()
    refreshLoads = 0

    const installing = store.install(plugin.plugin.id)
    await putStarted
    const refreshing = store.refreshCatalog()
    await Promise.resolve()
    expect(refreshLoads).toBe(0)

    releasePut?.()
    await installing
    await refreshing
    expect(refreshLoads).toBe(1)
    expect(store.snapshot().installed).toHaveLength(1)
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
    expect(loaded.installed.map(({ package: value }) => value.manifest.plugin.id)).toEqual([
      AI_POPOUT_PLUGIN_ID,
      COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
      GOOGLE_DRIVE_STORAGE_PLUGIN_ID
    ])

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
        schemaVersion: 3,
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
    let storageRevision = 0
    const storage = {
      async revision() {
        return storageRevision
      },
      async list() {
        return structuredClone(records)
      },
      async put(record: unknown) {
        records.push(structuredClone(record))
        storageRevision += 1
      },
      async delete(pluginId: string) {
        deletedPluginIds.push(pluginId)
        storageRevision += 1
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
    const mapTombstone = (await currentStorage.list()).find(
      (record) => record.pluginId === MAP_PLUGIN_ID
    )
    if (!mapTombstone) throw new Error('Expected persisted Map uninstall record')
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
    expect(loaded.installed.map(({ package: value }) => value.manifest.plugin.id)).toEqual([
      AI_POPOUT_PLUGIN_ID,
      COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
      GOOGLE_DRIVE_STORAGE_PLUGIN_ID
    ])
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
    const trustedKeyring = trustedPublisherKeyring(keyPair, signed.manifest)
    const tampered = structuredClone(signed.manifest)
    tampered.plugin.name = 'Forged Publisher Package'
    const tamperedStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [...createBundledPluginCatalog(), publisherEntry(keyPair, tampered)],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    const tamperedSnapshot = await tamperedStore.load()
    expect(tamperedSnapshot.error?.message).toContain('digest mismatch')
    expect(tamperedStore.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
    expect(
      tamperedSnapshot.catalog.some(
        ({ package: value }) => value.manifest.plugin.id === signed.manifest.plugin.id
      )
    ).toBe(false)

    const wrongOwner = publisherEntry(keyPair, signed.manifest)
    const ownershipStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [
        ...createBundledPluginCatalog(),
        { ...wrongOwner, expectedPublisherId: 'another-publisher' }
      ],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    const ownershipSnapshot = await ownershipStore.load()
    expect(ownershipSnapshot.error?.message).toContain('different publisher')
    expect(ownershipStore.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
    expect(
      ownershipSnapshot.catalog.some(
        ({ package: value }) => value.manifest.plugin.id === signed.manifest.plugin.id
      )
    ).toBe(false)
  })

  test('uses the keyring public key instead of a same-identity catalog entry key', async () => {
    const trustedKeys = await keys()
    const attackerKeys = await keys()
    const trustedManifest = await signPluginManifest(pluginPayload(), trustedKeys.privateKey)
    const attackerManifest = await signPluginManifest(pluginPayload(), attackerKeys.privateKey)
    const trustedKeyring = trustedPublisherKeyring(trustedKeys, trustedManifest)

    const substitutedStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [...createBundledPluginCatalog(), publisherEntry(attackerKeys, attackerManifest)],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    const substituted = await substitutedStore.load()
    expect(substituted.error?.message).toMatch(/signature|integrity|verification/i)
    expect(substitutedStore.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
    expect(
      substituted.catalog.some(
        ({ package: value }) => value.manifest.plugin.id === trustedManifest.plugin.id
      )
    ).toBe(false)
    await expect(substitutedStore.install(trustedManifest.plugin.id)).rejects.toThrow()

    const adapterKeyIgnored = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [publisherEntry(attackerKeys, trustedManifest)],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    expect((await adapterKeyIgnored.load()).error).toBeNull()
    await installReviewedPublisher(adapterKeyIgnored, trustedManifest.plugin.id)
    expect(adapterKeyIgnored.snapshot().installed).toHaveLength(1)
  })

  test('keeps an app-bundle plugin authoritative when a publisher reuses its id', async () => {
    const keyPair = await keys()
    const collisionPayload = pluginPayload()
    collisionPayload.plugin.id = MAP_PLUGIN_ID
    const collisionManifest = await signPluginManifest(collisionPayload, keyPair.privateKey)
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [
        ...createBundledPluginCatalog(),
        publisherEntry(keyPair, collisionManifest, undefined)
      ],
      trustedKeyring: trustedPublisherKeyring(keyPair, collisionManifest),
      engineVersion: ENGINE_VERSION
    })

    const snapshot = await store.load()
    expect(snapshot.error?.message).toContain('conflicts with app-bundle')
    expect(store.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
    expect(
      snapshot.catalog.find(({ package: value }) => value.manifest.plugin.id === MAP_PLUGIN_ID)
        ?.package.trustSource
    ).toBe('app-bundle')
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
      trustedKeyring: trustedPublisherKeyring(keyPair, signed),
      engineVersion: ENGINE_VERSION
    })

    expect((await store.load()).error).toBeNull()
    await expect(store.install(signed.plugin.id)).rejects.toThrow('explicit package review')
    await installReviewedPublisher(store, signed.plugin.id)
    await expect(store.uninstall(signed.plugin.id)).rejects.toThrow('host privilege cleanup')
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
    const trustedKeyring = trustedPublisherKeyring(keyPair, initial.manifest)
    const first = createAppPluginStore({
      storage,
      catalog: [publisherEntry(keyPair, initial.manifest)],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    await first.load()
    await installReviewedPublisher(first, initial.manifest.plugin.id)
    await first.setEnabled(initial.manifest.plugin.id, true)

    const update = await verified(keyPair, '1.1.0', 'Chart Pro')
    const second = createAppPluginStore({
      storage,
      catalog: [publisherEntry(keyPair, update.manifest)],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    await second.load()
    expect(second.snapshot().installed[0].package.manifest.plugin.version).toBe('1.0.0')
    expect(second.snapshot().installed[0].installedState?.pending?.diff).toMatchObject({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      updatedModules: ['chart']
    })

    await expect(second.acceptUpdate(initial.manifest.plugin.id)).rejects.toThrow(
      'explicit package review'
    )
    await acceptReviewedPublisherUpdate(second, initial.manifest.plugin.id)
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
      trustedKeyring,
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
      trustedKeyring,
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
    const trustedKeyring = trustedPublisherKeyring(keyPair, initial.manifest)
    const store = createAppPluginStore({
      storage,
      catalog: [],
      catalogLoader: async () => [remoteEntry],
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    await store.load()
    await installReviewedPublisher(store, initial.manifest.plugin.id)
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

    await acceptReviewedPublisherUpdate(store, initial.manifest.plugin.id)
    expect(store.snapshot().installed[0].package.remoteCatalog?.catalogDigest).toBe(
      'catalog-update'
    )

    await store.rollback(initial.manifest.plugin.id, '1.0.0')
    expect(store.snapshot().installed[0].package.remoteCatalog).toBeUndefined()
  })

  test('enforces activation compatibility across every direct store lifecycle API', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const trustedKeyring = trustedPublisherKeyring(keyPair, initial.manifest)
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
        trustedKeyring,
        engineVersion: ENGINE_VERSION
      },
      activationPolicy
    )
    await blockedInstall.load()
    await expect(
      installReviewedPublisher(blockedInstall, initial.manifest.plugin.id)
    ).rejects.toThrow('Host adapter unavailable')

    blockedVersions.clear()
    const storage = createMemoryAppPluginStateStorage()
    const first = createAppPluginStore(
      {
        storage,
        catalog: [publisherEntry(keyPair, initial.manifest)],
        trustedKeyring,
        engineVersion: ENGINE_VERSION
      },
      activationPolicy
    )
    await first.load()
    await installReviewedPublisher(first, initial.manifest.plugin.id)
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
        trustedKeyring,
        engineVersion: ENGINE_VERSION
      },
      activationPolicy
    )
    await updated.load()
    blockedVersions.add('1.1.0')
    await expect(
      acceptReviewedPublisherUpdate(updated, initial.manifest.plugin.id)
    ).rejects.toThrow('Host adapter unavailable')
    expect(updated.snapshot().installed[0].installedState?.pending).toBeDefined()

    blockedVersions.delete('1.1.0')
    await acceptReviewedPublisherUpdate(updated, initial.manifest.plugin.id)
    blockedVersions.add('1.0.0')
    await expect(updated.rollback(initial.manifest.plugin.id, '1.0.0')).rejects.toThrow(
      'Host adapter unavailable'
    )
    expect(updated.snapshot().installed[0].package.manifest.plugin.version).toBe('1.1.0')
  })

  test('loads one marketplace trust bundle and expires all publisher live lookups together', async () => {
    const keyPair = await keys()
    const payload = pluginPayload('1.0.0', 'Marketplace Chart')
    payload.contributions.commands = [
      {
        commandId: 'chart.inspect',
        name: 'Inspect chart',
        description: 'Inspect chart data',
        adapterId: 'open-pencil.chart.inspect'
      }
    ]
    payload.contributions.exporters = [
      {
        exporterId: 'chart.json',
        name: 'Chart JSON',
        description: 'Export chart data',
        adapterId: 'open-pencil.chart.json',
        fileExtension: '.json'
      }
    ]
    const manifest = await signPluginManifest(payload, keyPair.privateKey)
    const pluginPackage = await verifyPluginPackage(manifest, keyPair.publicKey, {
      engineVersion: ENGINE_VERSION
    })
    const trustedKeyring = trustedPublisherKeyring(keyPair, manifest)
    let entry = publisherEntry(
      keyPair,
      manifest,
      remoteCatalogMetadata('1.0.0', 'catalog-marketplace')
    )
    let bundleLoads = 0
    let currentTime = Date.parse('2026-08-05T00:00:00.000Z')
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      catalogLoader: async () => {
        throw new Error('legacy catalog loader must not run')
      },
      trustedKeyringLoader: async () => {
        throw new Error('legacy keyring loader must not run')
      },
      marketplaceTrustBundleLoader: async () => {
        bundleLoads += 1
        return marketplaceTrustBundle([entry], trustedKeyring, pluginPackage.verifiedDigest)
      },
      now: () => currentTime,
      engineVersion: ENGINE_VERSION
    })

    expect((await store.load()).error).toBeNull()
    expect(bundleLoads).toBe(1)
    await installReviewedPublisher(store, manifest.plugin.id)
    await store.setEnabled(manifest.plugin.id, true)
    expect(store.installedModules()).toHaveLength(1)
    expect(store.installedCommands()).toHaveLength(1)
    expect(store.installedExporters()).toHaveLength(1)

    const updateManifest = await signPluginManifest(
      {
        ...structuredClone(payload),
        plugin: { ...payload.plugin, version: '1.1.0' }
      },
      keyPair.privateKey
    )
    entry = publisherEntry(
      keyPair,
      updateManifest,
      remoteCatalogMetadata('1.1.0', 'catalog-marketplace-update')
    )
    await store.refreshCatalog()
    expect(store.snapshot().installed[0].installedState?.pending).toBeDefined()

    currentTime = Date.parse('2026-08-07T00:00:00.000Z')
    expect(store.snapshot().installed[0]).toMatchObject({
      enabled: false,
      blockedReason: expect.stringContaining('Marketplace trust snapshot expired')
    })
    expect(store.installedModules()).toEqual([])
    expect(store.installedCommands()).toEqual([])
    expect(store.installedExporters()).toEqual([])
    expect(store.module(manifest.plugin.id, 'chart')).toBeNull()
    expect(store.command(manifest.plugin.id, 'chart.inspect')).toBeNull()
    expect(store.exporter(manifest.plugin.id, 'chart.json')).toBeNull()
    await expect(store.setEnabled(manifest.plugin.id, true)).rejects.toThrow(
      'Marketplace trust snapshot expired'
    )
    await expect(acceptReviewedPublisherUpdate(store, manifest.plugin.id)).rejects.toThrow(
      'Marketplace trust snapshot expired'
    )
    await expect(store.rollback(manifest.plugin.id, '0.9.0')).rejects.toThrow(
      'Marketplace trust snapshot expired'
    )

    currentTime = Date.parse('2026-08-05T00:00:00.000Z')
    expect(store.installedModules()).toEqual([])
    await expect(store.setEnabled(manifest.plugin.id, true)).rejects.toThrow(
      'Marketplace trust snapshot expired'
    )
    currentTime = Date.parse('2026-08-07T00:00:00.000Z')

    const expiredInstall = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      marketplaceTrustBundleLoader: async () =>
        marketplaceTrustBundle([entry], trustedKeyring, pluginPackage.verifiedDigest),
      now: () => currentTime,
      engineVersion: ENGINE_VERSION
    })
    await expiredInstall.load()
    await expect(installReviewedPublisher(expiredInstall, manifest.plugin.id)).rejects.toThrow(
      'Marketplace trust snapshot expired'
    )
  })

  test('binds installed publisher state to the exact marketplace authority', async () => {
    const keyPair = await keys()
    const signed = await verified(keyPair, '1.0.0')
    const keyring = trustedPublisherKeyring(keyPair, signed.manifest)
    const entry = publisherEntry(keyPair, signed.manifest)
    const now = Date.parse('2026-08-05T00:00:00.000Z')
    const storage = createMemoryAppPluginStateStorage()
    const original = createAppPluginStore({
      storage,
      catalog: [],
      marketplaceTrustBundleLoader: async () =>
        marketplaceTrustBundle([entry], keyring, signed.verifiedDigest),
      now: () => now,
      engineVersion: ENGINE_VERSION
    })
    await original.load()
    await installReviewedPublisher(original, signed.manifest.plugin.id)
    const [stored] = await storage.list()
    expect(stored).toMatchObject({
      schemaVersion: 3,
      marketplaceAuthority: MARKETPLACE_AUTHORITY
    })

    const sameAuthority = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage([stored]),
      catalog: [],
      marketplaceTrustBundleLoader: async () =>
        marketplaceTrustBundle([entry], keyring, signed.verifiedDigest),
      now: () => now,
      engineVersion: ENGINE_VERSION
    })
    expect((await sameAuthority.load()).installed).toHaveLength(1)

    const mismatches: AppPluginMarketplaceAuthority[] = [
      { ...MARKETPLACE_AUTHORITY, sourceId: 'source:replacement' },
      { ...MARKETPLACE_AUTHORITY, trustDomainId: 'trust-domain:replacement' },
      { ...MARKETPLACE_AUTHORITY, sourceGeneration: 2 },
      { ...MARKETPLACE_AUTHORITY, rootKeySpkiSha256: `sha256-${'B'.repeat(43)}` }
    ]
    for (const authority of mismatches) {
      const mismatched = createAppPluginStore({
        storage: createMemoryAppPluginStateStorage([stored]),
        catalog: [],
        marketplaceTrustBundleLoader: async () =>
          marketplaceTrustBundle([entry], keyring, signed.verifiedDigest, undefined, authority),
        now: () => now,
        engineVersion: ENGINE_VERSION
      })
      const snapshot = await mismatched.load()
      expect(snapshot.installed).toEqual([])
      expect(snapshot.recordIssues).toEqual([
        { pluginId: signed.manifest.plugin.id, kind: 'invalid-record' }
      ])
    }

    const removedByManagedReplacementStorage = createMemoryAppPluginStateStorage([stored])
    const removedByManagedReplacement = createAppPluginStore({
      storage: removedByManagedReplacementStorage,
      catalog: [],
      marketplaceTrustBundleLoader: async () =>
        marketplaceTrustBundle([], keyring, signed.verifiedDigest, undefined, mismatches[1]),
      now: () => now,
      engineVersion: ENGINE_VERSION
    })
    expect((await removedByManagedReplacement.load()).recordIssues).toEqual([
      { pluginId: signed.manifest.plugin.id, kind: 'invalid-record' }
    ])
    await expect(
      removedByManagedReplacement.resetLocalState(signed.manifest.plugin.id)
    ).rejects.toThrow('requires host privilege cleanup')
    let publisherCleanupRan = false
    await removedByManagedReplacement.resetLocalStateWithPublisherCleanup(
      signed.manifest.plugin.id,
      async () => {
        publisherCleanupRan = true
      }
    )
    expect(publisherCleanupRan).toBe(true)
    expect(await removedByManagedReplacementStorage.list()).toEqual([])

    const { marketplaceAuthority: _authority, ...currentRecord } =
      stored as PersistedAppPluginStateV3
    const previous: PersistedAppPluginStateV2 = { ...currentRecord, schemaVersion: 2 }
    const previousSchema = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage([previous]),
      catalog: [],
      marketplaceTrustBundleLoader: async () =>
        marketplaceTrustBundle([entry], keyring, signed.verifiedDigest),
      now: () => now,
      engineVersion: ENGINE_VERSION
    })
    expect((await previousSchema.load()).recordIssues).toEqual([
      { pluginId: signed.manifest.plugin.id, kind: 'invalid-record' }
    ])
    expect(previousSchema.snapshot().installed).toEqual([])
  })

  test('blocks legacy publisher packages without a keyring while keeping app-bundle plugins live', async () => {
    const keyPair = await keys()
    const signed = await verified(keyPair, '1.0.0')
    const storage = createMemoryAppPluginStateStorage()
    const trusted = createAppPluginStore({
      storage,
      catalog: [publisherEntry(keyPair, signed.manifest)],
      trustedKeyring: trustedPublisherKeyring(keyPair, signed.manifest),
      engineVersion: ENGINE_VERSION
    })
    await trusted.load()
    await installReviewedPublisher(trusted, signed.manifest.plugin.id)
    await trusted.setEnabled(signed.manifest.plugin.id, true)

    const missingKeyring = createAppPluginStore({
      storage,
      catalog: [...createBundledPluginCatalog(), publisherEntry(keyPair, signed.manifest)],
      engineVersion: ENGINE_VERSION
    })
    const snapshot = await missingKeyring.load()
    const publisher = snapshot.installed.find(
      ({ package: value }) => value.manifest.plugin.id === signed.manifest.plugin.id
    )
    expect(snapshot.error?.message).toBe('Publisher trust keyring is unavailable')
    expect(publisher).toBeUndefined()
    expect(
      snapshot.catalog.some(
        ({ package: value }) => value.manifest.plugin.id === signed.manifest.plugin.id
      )
    ).toBe(false)
    expect(missingKeyring.canCreateModule(signed.manifest.plugin.id, 'chart')).toBe(false)
    expect(missingKeyring.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
    expect(
      missingKeyring
        .installedModules()
        .some(({ plugin }) => plugin.package.manifest.plugin.id === signed.manifest.plugin.id)
    ).toBe(false)
    await expect(missingKeyring.setEnabled(signed.manifest.plugin.id, true)).rejects.toThrow(
      'not installed'
    )
    await expect(missingKeyring.rollback(signed.manifest.plugin.id, '0.9.0')).rejects.toThrow(
      'not installed'
    )

    const missingKeyringInstall = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [publisherEntry(keyPair, signed.manifest)],
      engineVersion: ENGINE_VERSION
    })
    await missingKeyringInstall.load()
    await expect(missingKeyringInstall.install(signed.manifest.plugin.id)).rejects.toThrow(
      'Publisher trust keyring is unavailable'
    )

    const unavailableMarketplace = createAppPluginStore({
      storage,
      catalog: createBundledPluginCatalog(),
      marketplaceTrustBundleLoader: async () => null,
      engineVersion: ENGINE_VERSION
    })
    await unavailableMarketplace.load()
    expect(unavailableMarketplace.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
    expect(
      unavailableMarketplace
        .installedModules()
        .some(({ plugin }) => plugin.package.manifest.plugin.id === signed.manifest.plugin.id)
    ).toBe(false)
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

    const expiredInstallStore = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      catalogLoader: async () => remoteEntries,
      trustedKeyring,
      now: () => Date.parse('2026-08-07T00:00:00.000Z'),
      engineVersion: ENGINE_VERSION
    })
    await expiredInstallStore.load()
    await expect(
      installReviewedPublisher(expiredInstallStore, initial.manifest.plugin.id)
    ).rejects.toThrow('refresh the catalog')

    await installReviewedPublisher(store, initial.manifest.plugin.id)
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
    const reviewedUpdate = reviewedCatalogPackage(store, initial.manifest.plugin.id)
    const reviewedCurrent = reviewedInstalledAuthority(store, initial.manifest.plugin.id)

    remoteEntries = []
    await store.refreshCatalog()
    await expect(
      store.acceptUpdateReviewed(initial.manifest.plugin.id, reviewedUpdate, reviewedCurrent)
    ).rejects.toThrow('current verified catalog package')

    remoteEntries = [
      publisherEntry(
        keyPair,
        update.manifest,
        remoteCatalogMetadata('1.1.0', 'catalog-update', catalogExpiry)
      )
    ]
    await store.refreshCatalog()
    currentTime = Date.parse('2026-08-07T00:00:00.000Z')
    await expect(
      store.acceptUpdateReviewed(initial.manifest.plugin.id, reviewedUpdate, reviewedCurrent)
    ).rejects.toThrow('refresh the catalog')
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
    const trustedKeyring = trustedPublisherKeyring(keyPair, initial.manifest)
    const originalStorage = createMemoryAppPluginStateStorage()
    const original = createAppPluginStore({
      storage: originalStorage,
      catalog,
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    await original.load()
    await installReviewedPublisher(original, initial.manifest.plugin.id)

    const [storedValue] = await originalStorage.list()
    const stored = storedValue as PersistedAppPluginStateV3
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
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })

    const loaded = await recovered.load()
    expect(loaded.installed).toHaveLength(0)
    expect(loaded.error?.message).toContain('signature verification failed')
    expect(loaded.recordIssues).toEqual([
      { pluginId: initial.manifest.plugin.id, kind: 'invalid-record' }
    ])

    const reset = await recovered.resetLocalStateWithPublisherCleanup(
      initial.manifest.plugin.id,
      async () => undefined
    )
    expect(reset.error).toBeNull()
    expect(reset.recordIssues).toEqual([])
    expect(await corruptStorage.list()).toHaveLength(0)
    await installReviewedPublisher(recovered, initial.manifest.plugin.id)
    expect(recovered.snapshot().installed).toHaveLength(1)

    const disguisedStorage = createMemoryAppPluginStateStorage([
      { ...stored, trustSource: 'app-bundle' }
    ])
    const disguised = createAppPluginStore({
      storage: disguisedStorage,
      catalog,
      trustedKeyring,
      engineVersion: ENGINE_VERSION
    })
    const disguisedSnapshot = await disguised.load()
    expect(disguisedSnapshot.recordIssues).toEqual([
      { pluginId: initial.manifest.plugin.id, kind: 'invalid-record' }
    ])
    await expect(disguised.resetLocalState(initial.manifest.plugin.id)).rejects.toThrow(
      'requires host privilege cleanup'
    )
    let cleanupCalls = 0
    await disguised.resetLocalStateWithPublisherCleanup(initial.manifest.plugin.id, async () => {
      cleanupCalls += 1
    })
    expect(cleanupCalls).toBe(1)
    expect(await disguisedStorage.list()).toHaveLength(0)

    const replacementPayload = pluginPayload('1.1.0', 'New Engine Chart')
    replacementPayload.engineRange = '>=1.0.0 <2.0.0'
    const replacementManifest = await signPluginManifest(replacementPayload, keyPair.privateKey)
    const incompatible = createAppPluginStore({
      storage: originalStorage,
      catalog: [publisherEntry(keyPair, replacementManifest)],
      trustedKeyring,
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
    await installReviewedPublisher(store, initial.manifest.plugin.id)
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
    await expect(acceptReviewedPublisherUpdate(store, initial.manifest.plugin.id)).rejects.toThrow(
      'expired'
    )
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
    await installReviewedPublisher(first, initial.manifest.plugin.id)
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
    await acceptReviewedPublisherUpdate(rotated, initial.manifest.plugin.id)
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

  test('serializes publisher installs against the source transition fence', async () => {
    const keyPair = await keys()
    const signed = await verified(keyPair, '1.0.0')
    const replacement = await verified(keyPair, '1.1.0')
    const keyring = trustedPublisherKeyring(keyPair, signed.manifest)

    const installFirst = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [publisherEntry(keyPair, signed.manifest)],
      trustedKeyring: keyring,
      engineVersion: ENGINE_VERSION
    })
    await installFirst.load()
    let operationRan = false
    const installing = installReviewedPublisher(installFirst, signed.manifest.plugin.id)
    const blockedTransition = installFirst.transitionPublisherTrust(async () => {
      operationRan = true
    })
    await installing
    await expect(blockedTransition).rejects.toThrow('Uninstall publisher plugins')
    expect(operationRan).toBe(false)

    let transitionCatalog = [publisherEntry(keyPair, signed.manifest)]
    const transitionFirst = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      catalogLoader: async () => transitionCatalog,
      trustedKeyring: keyring,
      engineVersion: ENGINE_VERSION
    })
    await transitionFirst.load()
    const staleReview = reviewedCatalogPackage(transitionFirst, signed.manifest.plugin.id)
    let releaseTransition!: () => void
    const transitionGate = new Promise<void>((resolve) => {
      releaseTransition = resolve
    })
    const transition = transitionFirst.transitionPublisherTrust(async () => {
      expect(transitionFirst.snapshot().ready).toBe(false)
      await transitionGate
      transitionCatalog = [publisherEntry(keyPair, replacement.manifest)]
    })
    await Promise.resolve()
    const queuedInstall = transitionFirst.installReviewed(signed.manifest.plugin.id, staleReview)
    releaseTransition()
    await transition
    await expect(queuedInstall).rejects.toThrow('authority changed')
    expect(transitionFirst.snapshot().installed).toHaveLength(0)
  })

  test('fails a source transition when the committed marketplace bundle is unavailable', async () => {
    let marketplaceUnavailable = false
    let operationRan = false
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: createBundledPluginCatalog(),
      marketplaceTrustBundleLoader: async () => (marketplaceUnavailable ? null : undefined),
      engineVersion: ENGINE_VERSION
    })
    expect((await store.load()).error).toBeNull()

    await expect(
      store.transitionPublisherTrust(async () => {
        operationRan = true
        marketplaceUnavailable = true
      })
    ).rejects.toThrow('plugin catalog could not be loaded')

    expect(operationRan).toBe(true)
    expect(store.snapshot().error?.message).toContain('trust bundle is unavailable')
    expect(store.canCreateModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).toBe(true)
  })

  test('blocks a source transition when another store instance persisted an install', async () => {
    const keyPair = await keys()
    const signed = await verified(keyPair, '1.0.0')
    const keyring = trustedPublisherKeyring(keyPair, signed.manifest)
    const storage = createMemoryAppPluginStateStorage()
    let lockTail: Promise<void> = Promise.resolve()
    const sharedLock = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = lockTail.then(operation, operation)
      lockTail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
    const options = {
      storage,
      catalog: [publisherEntry(keyPair, signed.manifest)],
      trustedKeyring: keyring,
      publisherMutationLock: sharedLock,
      engineVersion: ENGINE_VERSION
    }
    const installingStore = createAppPluginStore(options)
    const transitioningStore = createAppPluginStore(options)
    await installingStore.load()
    await transitioningStore.load()
    await installReviewedPublisher(installingStore, signed.manifest.plugin.id)
    expect(transitioningStore.snapshot().installed).toHaveLength(0)
    let operationRan = false

    await expect(
      transitioningStore.transitionPublisherTrust(async () => {
        operationRan = true
      })
    ).rejects.toThrow('changed in another window')
    expect(operationRan).toBe(false)
  })

  test('rejects stale publisher privileges after uninstall and same-package reinstall ABA', async () => {
    const keyPair = await keys()
    const signed = await verified(keyPair, '1.0.0')
    const keyring = trustedPublisherKeyring(keyPair, signed.manifest)
    const mapEntry = createBundledPluginCatalog().find(
      (entry) => entry.manifest.plugin.id === MAP_PLUGIN_ID
    )
    if (!mapEntry) throw new Error('Expected bundled Map plugin')
    const storage = createMemoryAppPluginStateStorage()
    let lockTail: Promise<void> = Promise.resolve()
    const sharedLock = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = lockTail.then(operation, operation)
      lockTail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
    const options = {
      storage,
      catalog: [mapEntry, publisherEntry(keyPair, signed.manifest)],
      trustedKeyring: keyring,
      publisherMutationLock: sharedLock,
      engineVersion: ENGINE_VERSION
    }
    const initial = createAppPluginStore(options)
    await initial.load()
    await installReviewedPublisher(initial, signed.manifest.plugin.id)
    const firstWindow = createAppPluginStore(options)
    const staleWindow = createAppPluginStore(options)
    await firstWindow.load()
    await staleWindow.load()

    await firstWindow.uninstallWithPublisherCleanup(
      signed.manifest.plugin.id,
      async () => undefined
    )
    await installReviewedPublisher(firstWindow, signed.manifest.plugin.id)
    await staleWindow.setEnabled(MAP_PLUGIN_ID, false)
    await expect(staleWindow.setEnabled(signed.manifest.plugin.id, true)).rejects.toThrow(
      'restart OpenPencil'
    )
    expect(
      (await storage.list()).find((record) => record.pluginId === signed.manifest.plugin.id)
    ).toMatchObject({ installed: true, enabled: false })
    await staleWindow.load()
    expect(
      staleWindow
        .snapshot()
        .installed.find(
          ({ package: value }) => value.manifest.plugin.id === signed.manifest.plugin.id
        )
    ).toMatchObject({ enabled: false, package: { digest: signed.verifiedDigest } })
    await expect(staleWindow.setEnabled(signed.manifest.plugin.id, true)).rejects.toThrow(
      'restart OpenPencil'
    )
  })

  test('captures reviewed package authority before its mutation is queued', async () => {
    const keyPair = await keys()
    const initial = await verified(keyPair, '1.0.0')
    const update = await verified(keyPair, '1.1.0')
    const keyring = trustedPublisherKeyring(keyPair, initial.manifest)
    let catalogEntry = publisherEntry(keyPair, initial.manifest)
    let gate: Promise<void> | null = null
    let releaseGate: (() => void) | null = null
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      catalogLoader: async () => [catalogEntry],
      trustedKeyring: keyring,
      publisherMutationLock: async (operation) => {
        if (gate) await gate
        return operation()
      },
      engineVersion: ENGINE_VERSION
    })
    await store.load()

    const reviewedInstall = reviewedCatalogPackage(store, initial.manifest.plugin.id)
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const installation = store.installReviewed(initial.manifest.plugin.id, reviewedInstall)
    Reflect.set(reviewedInstall, 'digest', update.verifiedDigest)
    releaseGate?.()
    await expect(installation).resolves.toMatchObject({
      package: { manifest: { plugin: { version: '1.0.0' } } }
    })

    gate = null
    catalogEntry = publisherEntry(keyPair, update.manifest)
    await store.refreshCatalog()
    const reviewedCandidate = reviewedCatalogPackage(store, initial.manifest.plugin.id)
    const reviewedCurrent = reviewedInstalledAuthority(store, initial.manifest.plugin.id)
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const acceptance = store.acceptUpdateReviewed(
      initial.manifest.plugin.id,
      reviewedCandidate,
      reviewedCurrent
    )
    Reflect.set(reviewedCandidate, 'digest', initial.verifiedDigest)
    Reflect.set(reviewedCurrent, 'digest', update.verifiedDigest)
    releaseGate?.()
    await expect(acceptance).resolves.toMatchObject({
      package: { manifest: { plugin: { version: '1.1.0' } } }
    })
  })

  test('uses legacy direct publisher trust only when the Marketplace loader is unconfigured', async () => {
    const keyPair = await keys()
    const signed = await verified(keyPair, '1.0.0')
    let legacyLoads = 0
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: [],
      marketplaceTrustBundleLoader: async () => undefined,
      catalogLoader: async () => {
        legacyLoads += 1
        return [publisherEntry(keyPair, signed.manifest)]
      },
      trustedKeyring: trustedPublisherKeyring(keyPair, signed.manifest),
      engineVersion: ENGINE_VERSION
    })
    expect((await store.load()).error).toBeNull()
    expect(legacyLoads).toBe(1)
    expect(
      (await installReviewedPublisher(store, signed.manifest.plugin.id)).package.trustSource
    ).toBe('publisher-signature')
  })
})
