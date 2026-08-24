import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  signMarketplaceSnapshot,
  verifyMarketplaceSnapshot,
  type MarketplaceSnapshotPayloadV1,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  canonicalizeMarketplaceSourceConfig,
  createMarketplaceSourceManager,
  createMemoryMarketplaceSourceStorage,
  parseMarketplaceSourceStateJSON
} from '@/app/plugins'

const MARKETPLACE_ID = 'openpencil.marketplace'
const ROOT_KEY_ID = 'marketplace.root.2026'
const URL_A = 'https://plugins.example.com/marketplace.json'
const URL_B = 'https://mirror.example.com/marketplace.json'
const NOW = Date.parse('2026-08-05T00:00:00.000Z')
const SNAPSHOT_EXPIRY = Date.parse('2026-08-08T00:00:00.000Z')

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function payload(sequence: number): Promise<MarketplaceSnapshotPayloadV1> {
  return {
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: MARKETPLACE_ID,
    version: `1.0.${sequence}`,
    sequence,
    generatedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-08T00:00:00.000Z',
    publisherDirectory: { publishers: [], ownerships: [] },
    catalogs: [
      {
        channel: 'stable',
        catalogId: 'openpencil.marketplace.stable',
        keyId: ROOT_KEY_ID,
        url: 'https://plugins.example.com/catalog.json',
        digest: await digestCanonicalManifest({ sequence })
      }
    ],
    listings: [],
    auditHead: {
      sequence,
      headDigest: await digestCanonicalManifest({ audit: sequence }),
      url: 'https://plugins.example.com/audit.json'
    }
  }
}

async function verifiedSnapshot(
  sequence: number,
  pair: CryptoKeyPair,
  rootKeyId = ROOT_KEY_ID
): Promise<VerifiedMarketplaceSnapshot> {
  const signed = await signMarketplaceSnapshot(await payload(sequence), pair.privateKey, {
    keyId: rootKeyId
  })
  return verifyMarketplaceSnapshot(signed, pair.publicKey, {
    expectedMarketplaceId: MARKETPLACE_ID,
    expectedKeyId: rootKeyId,
    now: NOW
  })
}

async function config(pair: CryptoKeyPair, url = URL_A, rootKeyId = ROOT_KEY_ID) {
  return {
    schemaVersion: 1,
    url,
    marketplaceId: MARKETPLACE_ID,
    keyId: rootKeyId,
    publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
    channel: 'stable' as const
  }
}

function ids() {
  let next = 0
  return (kind: 'source' | 'trust-domain' | 'stage') => `${kind}:${++next}`
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message)
  return value
}

describe('marketplace source manager', () => {
  test('stages explicit root confirmation before atomically persisting source and high-water', async () => {
    const root = await keys()
    const storage = createMemoryMarketplaceSourceStorage()
    const manager = createMarketplaceSourceManager({ storage, now: () => NOW, idFactory: ids() })
    await manager.load()

    const candidate = await manager.stageUserSource(await config(root))
    expect(manager.snapshot()).toMatchObject({ origin: 'none', editable: true, configured: false })
    await expect(
      manager.commitCandidate(candidate, await verifiedSnapshot(1, root))
    ).rejects.toThrow('fingerprint confirmation')
    const committed = await manager.commitCandidate(
      candidate,
      await verifiedSnapshot(1, root),
      candidate.config.rootKeySpkiSha256
    )

    expect(committed).toMatchObject({ origin: 'user', editable: true, configured: true })
    expect(committed.active).toMatchObject({
      sourceId: candidate.authority.sourceId,
      trustDomainId: candidate.authority.trustDomainId,
      rootKeySpkiSha256: candidate.config.rootKeySpkiSha256,
      highWater: { snapshotSequence: 1, auditSequence: 1 }
    })
    expect(
      (
        await parseMarketplaceSourceStateJSON(
          required(storage.value(), 'Expected persisted Marketplace source state')
        )
      ).trustDomains[0]
    ).toMatchObject({
      currentRootFingerprint: candidate.config.rootKeySpkiSha256,
      retiredRootFingerprints: [],
      highWater: { snapshotSequence: 1 }
    })
  })

  test('re-verifies the snapshot with the candidate root at commit time', async () => {
    const [trusted, attacker] = await Promise.all([keys(), keys()])
    const manager = createMarketplaceSourceManager({
      storage: createMemoryMarketplaceSourceStorage(),
      now: () => NOW,
      idFactory: ids()
    })
    await manager.load()
    const candidate = await manager.stageUserSource(await config(trusted))
    await expect(
      manager.commitCandidate(
        candidate,
        await verifiedSnapshot(1, attacker),
        candidate.config.rootKeySpkiSha256
      )
    ).rejects.toThrow()
    expect(manager.snapshot().active).toBeNull()
  })

  test('freezes issued authority and rejects structurally forged candidates', async () => {
    const root = await keys()
    const manager = createMarketplaceSourceManager({
      storage: createMemoryMarketplaceSourceStorage(),
      now: () => NOW,
      idFactory: ids()
    })
    await manager.load()
    const candidate = await manager.stageUserSource(await config(root))
    expect(Object.isFrozen(candidate)).toBe(true)
    expect(Object.isFrozen(candidate.config)).toBe(true)
    expect(Reflect.set(candidate.config, 'expectedKeyId', 'attacker.root')).toBe(false)
    expect(candidate.config.expectedKeyId).toBe(ROOT_KEY_ID)

    const forged = {
      ...candidate,
      config: { ...candidate.config, expectedKeyId: 'attacker.root' }
    }
    await expect(
      manager.commitCandidate(
        forged,
        await verifiedSnapshot(1, root),
        candidate.config.rootKeySpkiSha256
      )
    ).rejects.toThrow('not issued by this manager')
  })

  test('shares high-water across mirror URLs and requires a strict source advance', async () => {
    const root = await keys()
    const manager = createMarketplaceSourceManager({
      storage: createMemoryMarketplaceSourceStorage(),
      now: () => NOW,
      idFactory: ids()
    })
    await manager.load()
    const first = await manager.stageUserSource(await config(root, URL_A))
    await manager.commitCandidate(
      first,
      await verifiedSnapshot(1, root),
      first.config.rootKeySpkiSha256
    )

    const mirror = await manager.stageUserSource(await config(root, URL_B))
    expect(mirror.authority.trustDomainId).toBe(first.authority.trustDomainId)
    expect(mirror.requiresStrictAdvance).toBe(true)
    await expect(
      manager.commitCandidate(
        mirror,
        await verifiedSnapshot(1, root),
        mirror.config.rootKeySpkiSha256
      )
    ).rejects.toThrow('strictly advancing')
    await manager.commitCandidate(
      mirror,
      await verifiedSnapshot(2, root),
      mirror.config.rootKeySpkiSha256
    )
    expect(manager.snapshot().active).toMatchObject({
      snapshotUrl: URL_B,
      trustDomainId: first.authority.trustDomainId,
      highWater: { snapshotSequence: 2 }
    })
  })

  test('retires a rotated root and never restores it even with a higher sequence', async () => {
    const [rootA, rootB] = await Promise.all([keys(), keys()])
    const nextRootKeyId = 'marketplace.root.2027'
    const storage = createMemoryMarketplaceSourceStorage()
    const manager = createMarketplaceSourceManager({
      storage,
      now: () => NOW,
      idFactory: ids()
    })
    await manager.load()
    const first = await manager.stageUserSource(await config(rootA))
    await manager.commitCandidate(
      first,
      await verifiedSnapshot(1, rootA),
      first.config.rootKeySpkiSha256
    )

    const rotation = await manager.stageUserSource(await config(rootB, URL_A, nextRootKeyId))
    expect(rotation.requiresRootRotation).toBe(true)
    await manager.commitCandidate(
      rotation,
      await verifiedSnapshot(2, rootB, nextRootKeyId),
      rotation.config.rootKeySpkiSha256
    )
    await expect(manager.stageUserSource(await config(rootA))).rejects.toThrow('retired root key')

    const persistedAfterRotation = await parseMarketplaceSourceStateJSON(
      required(storage.value(), 'Expected persisted Marketplace source state')
    )
    const rotatedSource = required(
      persistedAfterRotation.sources.find(
        ({ rootKeySpkiSha256 }) => rootKeySpkiSha256 === rotation.config.rootKeySpkiSha256
      ),
      'Expected rotated source record'
    )
    expect(rotatedSource).toMatchObject({
      predecessorRootFingerprint: first.config.rootKeySpkiSha256,
      rotationAt: new Date(NOW).toISOString()
    })

    const refresh = required(
      await manager.stageActiveSourceRefresh(),
      'Expected active Marketplace source refresh candidate'
    )
    await manager.commitCandidate(refresh, await verifiedSnapshot(3, rootB, nextRootKeyId))
    const restarted = createMarketplaceSourceManager({ storage, now: () => NOW, idFactory: ids() })
    await restarted.load()
    expect(restarted.snapshot().active).toMatchObject({
      rootKeySpkiSha256: rotation.config.rootKeySpkiSha256,
      highWater: { snapshotSequence: 3 }
    })
    const persistedAfterRestart = await parseMarketplaceSourceStateJSON(
      required(storage.value(), 'Expected persisted Marketplace source state')
    )
    expect(
      persistedAfterRestart.sources.find(({ sourceId }) => sourceId === rotatedSource.sourceId)
    ).toMatchObject({
      predecessorRootFingerprint: first.config.rootKeySpkiSha256,
      rotationAt: rotatedSource.rotationAt
    })

    const retiredSource = persistedAfterRestart.sources.find(
      ({ rootKeySpkiSha256 }) => rootKeySpkiSha256 === first.config.rootKeySpkiSha256
    )
    if (!retiredSource) throw new Error('Expected retired source record')
    await storage.write(
      JSON.stringify({
        ...persistedAfterRestart,
        activeUserSourceId: retiredSource.sourceId
      })
    )
    const corruptedRestart = createMarketplaceSourceManager({
      storage,
      now: () => NOW,
      idFactory: ids()
    })
    expect((await corruptedRestart.load()).error?.message).toContain('current trust root')
  })

  test('rejects replacing a root key while reusing its trusted key id', async () => {
    const [rootA, rootB] = await Promise.all([keys(), keys()])
    const manager = createMarketplaceSourceManager({
      storage: createMemoryMarketplaceSourceStorage(),
      now: () => NOW,
      idFactory: ids()
    })
    await manager.load()
    const first = await manager.stageUserSource(await config(rootA))
    await manager.commitCandidate(
      first,
      await verifiedSnapshot(1, rootA),
      first.config.rootKeySpkiSha256
    )

    await expect(manager.stageUserSource(await config(rootB))).rejects.toThrow('new root key id')
  })

  test('treats any managed env presence as locked and fails closed when malformed', async () => {
    const malformed = createMarketplaceSourceManager({
      storage: createMemoryMarketplaceSourceStorage(),
      managedConfigJSON: '',
      now: () => NOW,
      idFactory: ids()
    })
    expect(await malformed.load()).toMatchObject({
      configured: true,
      origin: 'managed',
      editable: false,
      active: null
    })
    expect(malformed.snapshot().error).not.toBeNull()
    await expect(malformed.stageUserSource({})).rejects.toThrow()

    const root = await keys()
    const managed = createMarketplaceSourceManager({
      storage: createMemoryMarketplaceSourceStorage(),
      managedConfigJSON: JSON.stringify(await config(root)),
      now: () => NOW,
      idFactory: ids()
    })
    await managed.load()
    expect(managed.snapshot()).toMatchObject({ origin: 'managed', editable: false, active: null })
    const candidate = required(
      managed.pendingManagedSource(),
      'Expected pending managed Marketplace source'
    )
    await managed.commitCandidate(candidate, await verifiedSnapshot(1, root))
    expect(managed.snapshot().active).toMatchObject({ origin: 'managed' })
  })

  test('durably checkpoints privilege time across restart and clock rollback', async () => {
    const root = await keys()
    const storage = createMemoryMarketplaceSourceStorage()
    let clock = NOW
    const processA = createMarketplaceSourceManager({
      storage,
      now: () => clock,
      idFactory: ids()
    })
    await processA.load()
    const candidate = await processA.stageUserSource(await config(root))
    await processA.commitCandidate(
      candidate,
      await verifiedSnapshot(1, root),
      candidate.config.rootKeySpkiSha256
    )
    clock = SNAPSHOT_EXPIRY + 1
    expect(await processA.checkpointActivePrivilegeClock()).toBe(clock)
    const persistedAfterCheckpoint = await parseMarketplaceSourceStateJSON(
      required(storage.value(), 'Expected persisted Marketplace source state')
    )
    const persistedClock = required(
      persistedAfterCheckpoint.trustDomains[0].highWater,
      'Expected persisted Marketplace trust high-water'
    )
    expect(Date.parse(persistedClock.lastSeenWallTime)).toBe(clock)

    const processB = createMarketplaceSourceManager({
      storage,
      now: () => SNAPSHOT_EXPIRY - 1,
      idFactory: ids()
    })
    await processB.load()
    const restartedSource = await processB.resolveActiveSource()
    const active = required(restartedSource, 'Expected active Marketplace source after restart')
    expect(active.effectiveNow).toBe(clock)
    expect(active.effectiveNow).toBeGreaterThan(SNAPSHOT_EXPIRY)
  })

  test('rejects unsafe source fields', async () => {
    const root = await keys()
    await expect(
      canonicalizeMarketplaceSourceConfig({
        ...(await config(root)),
        url: 'https://user:secret@plugins.example.com/marketplace.json'
      })
    ).rejects.toThrow('credentials')
    await expect(
      canonicalizeMarketplaceSourceConfig({ ...(await config(root)), secret: 'nope' })
    ).rejects.toThrow('unsupported fields')
  })

  test('uses compare-and-swap so a stale window cannot overwrite the persisted trust floor', async () => {
    const root = await keys()
    const storage = createMemoryMarketplaceSourceStorage()
    const first = createMarketplaceSourceManager({ storage, now: () => NOW, idFactory: ids() })
    const stale = createMarketplaceSourceManager({ storage, now: () => NOW, idFactory: ids() })
    await Promise.all([first.load(), stale.load()])

    const firstCandidate = await first.stageUserSource(await config(root))
    const staleCandidate = await stale.stageUserSource(await config(root))
    await first.commitCandidate(
      firstCandidate,
      await verifiedSnapshot(1, root),
      firstCandidate.config.rootKeySpkiSha256
    )
    await expect(
      stale.commitCandidate(
        staleCandidate,
        await verifiedSnapshot(2, root),
        staleCandidate.config.rootKeySpkiSha256
      )
    ).rejects.toThrow('another window')

    const persisted = await parseMarketplaceSourceStateJSON(
      required(storage.value(), 'Expected persisted Marketplace source state')
    )
    expect(persisted.trustDomains[0].highWater?.snapshotSequence).toBe(1)
    expect(stale.snapshot()).toMatchObject({ active: null })
    expect(stale.snapshot().error?.message).toContain('another window')
  })
})
