import { describe, expect, test } from 'bun:test'

import {
  TEAM_MOTION_LIBRARY_FORMAT,
  TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
  exportTeamMotionPublicKey,
  serializeTeamMotionLibraryManifest,
  signTeamMotionLibraryManifest,
  type TeamMotionLibraryManifest,
  type TeamMotionLibraryPayload
} from '@open-pencil/scene-graph'

import type { MotionPresetKeyValueStorage } from '@/app/motion-presets/storage'
import {
  TEAM_MOTION_LIBRARY_STORAGE_KEY,
  createTeamMotionLibraryStore,
  reconcileTeamMotionTokenValues
} from '@/app/motion-presets/team-store'

class MemoryStorage implements MotionPresetKeyValueStorage {
  readonly values = new Map<string, string>()
  writes = 0

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    this.values.set(key, value)
  }
}

function payload(
  version = '1.0.0',
  durationMs = 320,
  libraryId = 'brandMotion'
): TeamMotionLibraryPayload {
  return {
    format: TEAM_MOTION_LIBRARY_FORMAT,
    schemaVersion: TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
    publisher: { id: 'designTeam', name: 'Design Team', keyId: 'teamKey1' },
    library: { id: libraryId, name: `Brand Motion ${libraryId}` },
    version,
    engineRange: '>=0.8.0 <1.0.0',
    source: { kind: 'url', ref: 'https://example.com/motion/library.json' },
    tokens: [
      {
        id: 'motion.duration.medium',
        type: 'number',
        defaultValue: durationMs,
        min: 100,
        max: 1_000
      }
    ],
    entries: [
      {
        kind: 'preset',
        preset: {
          id: 'user-soft-enter',
          revision: version === '1.0.0' ? 1 : 2,
          name: 'Soft enter',
          category: 'entrance',
          motion: {
            version: 1,
            tracks: [
              {
                id: 'fade',
                trigger: 'mount',
                keyframes: [
                  { offset: 0, opacity: 0 },
                  { offset: 1, opacity: 1 }
                ],
                timing: { durationMs }
              }
            ]
          }
        }
      },
      {
        kind: 'recipe',
        recipe: {
          format: 'openpencil-motion-recipe',
          version: 1,
          id: 'pairedEnter',
          name: 'Paired enter',
          parameters: [{ id: 'duration', defaultValue: 300, min: 100, max: 1_000 }],
          roles: [
            {
              id: 'hero',
              motion: {
                version: 1,
                tracks: [
                  {
                    id: 'heroEnter',
                    trigger: 'pageEnter',
                    keyframes: [
                      { offset: 0, y: 20 },
                      { offset: 1, y: 0 }
                    ],
                    timing: { durationMs: 300 }
                  }
                ]
              },
              bindings: [
                {
                  parameterId: 'duration',
                  target: { kind: 'timing', trackId: 'heroEnter', field: 'durationMs' }
                }
              ]
            }
          ]
        },
        tokenBindings: [{ tokenId: 'motion.duration.medium', parameterId: 'duration' }]
      }
    ]
  }
}

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function signed(
  keys: CryptoKeyPair,
  version = '1.0.0',
  durationMs = 320,
  libraryId = 'brandMotion'
): Promise<TeamMotionLibraryManifest> {
  return signTeamMotionLibraryManifest(payload(version, durationMs, libraryId), keys.privateKey)
}

async function stage(
  store: ReturnType<typeof createTeamMotionLibraryStore>,
  manifest: TeamMotionLibraryManifest,
  keys: CryptoKeyPair
) {
  return store.stageManifest(
    serializeTeamMotionLibraryManifest(manifest),
    await exportTeamMotionPublicKey(keys.publicKey)
  )
}

function storedValue(storage: MemoryStorage): string {
  const value = storage.getItem(TEAM_MOTION_LIBRARY_STORAGE_KEY)
  if (!value) throw new Error('Expected stored team Motion libraries')
  return value
}

describe('app signed team Motion library store', () => {
  test('reconciles changed token definitions without retaining removed or invalid values', () => {
    const values = { removed: 42, duration: 2_000, invalid: Number.NaN }
    expect(
      reconcileTeamMotionTokenValues(
        [
          { id: 'duration', type: 'number', defaultValue: 320, min: 100, max: 1_000 },
          { id: 'invalid', type: 'number', defaultValue: 12, min: 0, max: 20 }
        ],
        values
      )
    ).toEqual({ duration: 1_000, invalid: 12 })
  })

  test('loads before writes and persists a verified library with reproducible token mapping', async () => {
    const storage = new MemoryStorage()
    const keys = await keyPair()
    const manifest = await signed(keys)
    const store = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })

    await expect(stage(store, manifest, keys)).rejects.toThrow(/still loading/)
    expect(storage.writes).toBe(0)
    await store.load()
    await stage(store, manifest, keys)

    expect(store.snapshot()).toMatchObject({ ready: true, blocked: false, error: null })
    expect(store.snapshot().libraries[0]?.registry.accepted.manifest.version).toBe('1.0.0')
    const exposed = store.snapshot().libraries[0]?.registry.accepted.manifest.entries[0]
    if (exposed?.kind !== 'preset') throw new Error('Expected preset entry')
    const exposedTrack = exposed.preset.motion.tracks[0]
    if (!exposedTrack) throw new Error('Expected preset track')
    exposedTrack.timing.durationMs = 999
    expect(store.instantiate('brandMotion', 'user-soft-enter')).toMatchObject({
      motion: { tracks: [{ timing: { durationMs: 320 } }] }
    })
    expect(
      store.instantiate('brandMotion', 'pairedEnter', {
        roleMapping: { hero: ['node:hero'] },
        tokens: { 'motion.duration.medium': 640 }
      })
    ).toMatchObject({
      kind: 'recipe',
      result: {
        parameters: { duration: 640 },
        assignments: [
          { nodeId: 'node:hero', motion: { tracks: [{ timing: { durationMs: 640 } }] } }
        ]
      }
    })

    const restored = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })
    await restored.load()
    expect(restored.snapshot().libraries[0]?.registry.accepted.verifiedDigest).toBe(
      manifest.integrity.digest
    )
  })

  test('keeps updates pending until accept, supports reject, and rolls back verified history', async () => {
    const storage = new MemoryStorage()
    const keys = await keyPair()
    const first = await signed(keys)
    const second = await signed(keys, '1.1.0', 480)
    const store = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })
    await store.load()
    await stage(store, first, keys)

    await stage(store, second, keys)
    expect(store.snapshot().libraries[0]?.registry).toMatchObject({
      accepted: { manifest: { version: '1.0.0' } },
      pending: { candidate: { manifest: { version: '1.1.0' } } }
    })
    expect(store.instantiate('brandMotion', 'user-soft-enter')).toMatchObject({
      motion: { tracks: [{ timing: { durationMs: 320 } }] }
    })

    await store.reject('brandMotion')
    expect(store.snapshot().libraries[0]?.registry.pending).toBeUndefined()
    await stage(store, second, keys)
    await store.accept('brandMotion')
    expect(store.snapshot().libraries[0]?.registry.accepted.manifest.version).toBe('1.1.0')

    await expect(stage(store, first, keys)).rejects.toThrow(/explicit rollback/)
    expect(store.snapshot().libraries[0]?.registry.accepted.manifest.version).toBe('1.1.0')

    await store.rollback('brandMotion', first.integrity.digest)
    expect(store.snapshot().libraries[0]?.registry).toMatchObject({
      accepted: { manifest: { version: '1.0.0' } },
      history: [{ manifest: { version: '1.1.0' } }]
    })
  })

  test('checks remote updates but rejects stale concurrent operations without losing data', async () => {
    const storage = new MemoryStorage()
    const keys = await keyPair()
    const first = await signed(keys)
    const second = await signed(keys, '1.1.0', 480)
    let remote: unknown = second
    const store = createTeamMotionLibraryStore({
      storage,
      engineVersion: '0.8.4',
      loadSource: async () => remote
    })
    await store.load()
    await stage(store, first, keys)
    await store.checkSource('brandMotion')
    expect(store.snapshot().libraries[0]?.registry.pending?.candidate.manifest.version).toBe(
      '1.1.0'
    )
    await store.reject('brandMotion')

    const otherA = await signed(keys, '1.0.0', 300, 'libraryA')
    const otherB = await signed(keys, '1.0.0', 300, 'libraryB')
    const outcomes = await Promise.allSettled([
      stage(store, otherA, keys),
      stage(store, otherB, keys)
    ])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(store.snapshot().libraries).toHaveLength(2)

    remote = { invalid: true }
    await expect(store.checkSource('brandMotion')).rejects.toThrow()
    expect(store.snapshot().libraries[0]?.registry.accepted.manifest.version).toBe('1.0.0')
  })

  test('rejects insecure URL sources before fetch and never follows redirect downgrades', async () => {
    const keys = await keyPair()
    const publicKeyPem = await exportTeamMotionPublicKey(keys.publicKey)

    const insecurePayload = payload()
    insecurePayload.source = { kind: 'url', ref: 'http://example.com/motion/library.json' }
    const insecureManifest = await signTeamMotionLibraryManifest(insecurePayload, keys.privateKey)
    let insecureFetchCalls = 0
    const insecureStore = createTeamMotionLibraryStore({
      storage: new MemoryStorage(),
      engineVersion: '0.8.4',
      fetchImpl: (async () => {
        insecureFetchCalls += 1
        throw new Error('HTTP source must be rejected before fetch')
      }) as typeof globalThis.fetch
    })
    await insecureStore.load()
    await insecureStore.stageManifest(
      serializeTeamMotionLibraryManifest(insecureManifest),
      publicKeyPem
    )
    await expect(insecureStore.checkSource('brandMotion')).rejects.toThrow(/must use HTTPS/)
    expect(insecureFetchCalls).toBe(0)

    const accepted = await signed(keys)
    const redirected = await signed(keys, '1.1.0', 480)
    let redirectFetchCalls = 0
    let followedDowngrade = 0
    const redirectStore = createTeamMotionLibraryStore({
      storage: new MemoryStorage(),
      engineVersion: '0.8.4',
      fetchImpl: (async (_input, init) => {
        redirectFetchCalls += 1
        if (init?.redirect === 'error') throw new TypeError('Redirect mode rejected the downgrade')
        followedDowngrade += 1
        return new Response(serializeTeamMotionLibraryManifest(redirected), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      }) as typeof globalThis.fetch
    })
    await redirectStore.load()
    await stage(redirectStore, accepted, keys)
    await expect(redirectStore.checkSource('brandMotion')).rejects.toThrow(/Redirect mode/)
    expect(redirectFetchCalls).toBe(1)
    expect(followedDowngrade).toBe(0)
  })

  test('blocks tampered persisted data and every operation that could consume or replace it', async () => {
    const storage = new MemoryStorage()
    const keys = await keyPair()
    const store = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })
    await store.load()
    await stage(store, await signed(keys), keys)

    const tampered = JSON.parse(storedValue(storage))
    tampered.libraries[0].registry.accepted.manifest.entries[0].preset.motion.tracks[0].timing.durationMs = 999
    storage.setItem(TEAM_MOTION_LIBRARY_STORAGE_KEY, JSON.stringify(tampered))
    const preserved = storedValue(storage)

    const restored = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })
    await restored.load()
    expect(restored.snapshot()).toMatchObject({ ready: true, blocked: true })
    expect(() => restored.instantiate('brandMotion', 'user-soft-enter')).toThrow(/verified/)
    await expect(stage(restored, await signed(keys, '1.1.0'), keys)).rejects.toThrow(/preserved/)
    expect(storedValue(storage)).toBe(preserved)
  })

  test('blocks persisted registry snapshot metadata that differs from the verified manifest', async () => {
    const keys = await keyPair()
    for (const field of ['verifiedDigest', 'verifiedKeyId'] as const) {
      const storage = new MemoryStorage()
      const store = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })
      await store.load()
      await stage(store, await signed(keys), keys)

      const tampered = JSON.parse(storedValue(storage))
      const snapshot = tampered.libraries[0].registry.accepted
      snapshot[field] = `${snapshot[field]}-tampered`
      storage.setItem(TEAM_MOTION_LIBRARY_STORAGE_KEY, JSON.stringify(tampered))
      const preserved = storedValue(storage)

      const restored = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })
      await restored.load()
      expect(restored.snapshot()).toMatchObject({ ready: true, blocked: true })
      expect(restored.snapshot().error?.message).toContain(
        'snapshot metadata does not match manifest'
      )
      expect(storedValue(storage)).toBe(preserved)
    }
  })

  test('rejects incompatible engines and signing-key rotation before persistence', async () => {
    const storage = new MemoryStorage()
    const trusted = await keyPair()
    const other = await keyPair()
    const store = createTeamMotionLibraryStore({ storage, engineVersion: '0.8.4' })
    await store.load()
    await stage(store, await signed(trusted), trusted)
    const before = storedValue(storage)

    await expect(stage(store, await signed(other, '1.1.0'), other)).rejects.toThrow(/key rotation/)
    expect(storedValue(storage)).toBe(before)

    const incompatible = createTeamMotionLibraryStore({
      storage: new MemoryStorage(),
      engineVersion: '1.0.0'
    })
    await incompatible.load()
    await expect(stage(incompatible, await signed(trusted), trusted)).rejects.toThrow(
      /requires OpenPencil/
    )
    expect(incompatible.snapshot().libraries).toHaveLength(0)
  })
})
