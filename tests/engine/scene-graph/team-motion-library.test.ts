import { describe, expect, test } from 'bun:test'

import {
  TEAM_MOTION_LIBRARY_FORMAT,
  TEAM_MOTION_LIBRARY_LIMITS,
  TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
  acceptTeamMotionLibraryReview,
  createTeamMotionLibraryRegistry,
  diffTeamMotionLibraries,
  instantiateTeamMotionLibraryEntry,
  parseTeamMotionLibraryManifest,
  parseTeamMotionLibraryPayload,
  parseTeamMotionLibraryRegistryState,
  rejectTeamMotionLibraryReview,
  reviewTeamMotionLibraryUpdate,
  rollbackTeamMotionLibrary,
  satisfiesTeamMotionEngineRange,
  serializeTeamMotionLibraryManifest,
  signTeamMotionLibraryManifest,
  validateTeamMotionLibraryManifest,
  verifyTeamMotionLibraryManifest,
  type TeamMotionLibraryPayload,
  type VerifiedTeamMotionLibrarySnapshot
} from '@open-pencil/scene-graph'

function payload(version = '1.0.0', durationMs = 320): TeamMotionLibraryPayload {
  return {
    format: TEAM_MOTION_LIBRARY_FORMAT,
    schemaVersion: TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
    publisher: { id: 'designTeam', name: 'Design Team', keyId: 'teamKey1' },
    library: { id: 'brandMotion', name: 'Brand Motion' },
    version,
    engineRange: '>=0.8.0 <1.0.0',
    source: { kind: 'url', ref: 'https://example.com/motion/library.json' },
    releaseNotes: `Release ${version}`,
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

const CANONICAL_FIXTURE_PRIVATE_KEY: JSONWebKey = {
  crv: 'Ed25519',
  d: 'FxJOeRX9SK273eZkGQ8W5ohk1EFWP67CZCSzYL4cNbU',
  ext: true,
  key_ops: ['sign'],
  kty: 'OKP',
  x: '3kDZvtAZuYe78SGOC-rt_sgTMClbZoeR-KYMEAMHwnU'
}

const CANONICAL_FIXTURE_PUBLIC_KEY: JSONWebKey = {
  crv: 'Ed25519',
  ext: true,
  key_ops: ['verify'],
  kty: 'OKP',
  x: '3kDZvtAZuYe78SGOC-rt_sgTMClbZoeR-KYMEAMHwnU'
}

const CANONICAL_FIXTURE_DIGEST = 'bE0QyRKcAvp4l72ge1WqKtZVrovcUq4SrqlTON1JPYk'
const CANONICAL_FIXTURE_SIGNATURE =
  'VSWAZKnZgGrKRok1GkM1dpou76t4a3c3s_E-GZCiRvUc4d9JX5JqdV2rnhzjnScxzi8Zn7X1LRGHWd2F2seSDA'
const CANONICAL_FIXTURE_PAYLOAD =
  '{"engineRange":"*","entries":[{"kind":"preset","preset":{"category":"custom","id":"user-I_i-a","motion":{"tracks":[{"id":"I_i-a","keyframes":[{"offset":0,"opacity":0},{"offset":1,"opacity":1}],"timing":{"durationMs":100},"trigger":"mount"}],"version":1},"name":"Canonical I/i","revision":1}}],"format":"openpencil-team-motion-library","library":{"id":"i-Library","name":"I/i Library"},"publisher":{"id":"I-Team","keyId":"I_key-id","name":"I/i Team"},"schemaVersion":1,"source":{"kind":"url","ref":"https://example.com/I.i_A-a.json"},"tokens":[{"defaultValue":1,"id":"I.i_A-a","max":2,"min":0,"type":"number"}],"version":"1.0.0"}'

function canonicalFixturePayload(): TeamMotionLibraryPayload {
  return {
    format: TEAM_MOTION_LIBRARY_FORMAT,
    schemaVersion: TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
    publisher: { id: 'I-Team', name: 'I/i Team', keyId: 'I_key-id' },
    library: { id: 'i-Library', name: 'I/i Library' },
    version: '1.0.0',
    engineRange: '*',
    source: { kind: 'url', ref: 'https://example.com/I.i_A-a.json' },
    tokens: [{ id: 'I.i_A-a', type: 'number', defaultValue: 1, min: 0, max: 2 }],
    entries: [
      {
        kind: 'preset',
        preset: {
          id: 'user-I_i-a',
          revision: 1,
          name: 'Canonical I/i',
          category: 'custom',
          motion: {
            version: 1,
            tracks: [
              {
                id: 'I_i-a',
                trigger: 'mount',
                keyframes: [
                  { offset: 0, opacity: 0 },
                  { offset: 1, opacity: 1 }
                ],
                timing: { durationMs: 100 }
              }
            ]
          }
        }
      }
    ]
  }
}

function base64URLBytes(value: string): Uint8Array {
  const padded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function webCryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function verified(
  keyPair: CryptoKeyPair,
  version = '1.0.0',
  durationMs = 320
): Promise<VerifiedTeamMotionLibrarySnapshot> {
  const manifest = await signTeamMotionLibraryManifest(
    payload(version, durationMs),
    keyPair.privateKey
  )
  return verifyTeamMotionLibraryManifest(manifest, keyPair.publicKey, {
    expectedKeyId: 'teamKey1',
    engineVersion: '0.8.4'
  })
}

function maxCountPayload(): TeamMotionLibraryPayload {
  const base = payload()
  const template = base.entries[0]
  if (template?.kind !== 'preset') throw new Error('Expected preset template')

  return {
    ...base,
    tokens: Array.from({ length: TEAM_MOTION_LIBRARY_LIMITS.maxTokens }, (_, index) => ({
      id: `motion.boundary.${index}`,
      type: 'number',
      defaultValue:
        index % 2 === 0
          ? TEAM_MOTION_LIBRARY_LIMITS.tokenValue.min
          : TEAM_MOTION_LIBRARY_LIMITS.tokenValue.max,
      min: TEAM_MOTION_LIBRARY_LIMITS.tokenValue.min,
      max: TEAM_MOTION_LIBRARY_LIMITS.tokenValue.max
    })),
    entries: Array.from({ length: TEAM_MOTION_LIBRARY_LIMITS.maxEntries }, (_, index) => ({
      kind: 'preset' as const,
      preset: {
        ...structuredClone(template.preset),
        id: `user-boundary-${index}`,
        name: `Boundary preset ${index}`
      }
    }))
  }
}

function historySnapshot(
  source: VerifiedTeamMotionLibrarySnapshot,
  index: number
): VerifiedTeamMotionLibrarySnapshot {
  const digest = `history-digest-${String(index).padStart(2, '0')}`
  return {
    ...structuredClone(source),
    manifest: {
      ...structuredClone(source.manifest),
      version: `0.${index + 1}.0`,
      integrity: { ...source.manifest.integrity, digest }
    },
    verifiedDigest: digest
  }
}

describe('signed team Motion libraries', () => {
  test('uses locale-independent canonical bytes for fixed digest and signature fixtures', async () => {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      CANONICAL_FIXTURE_PRIVATE_KEY,
      'Ed25519',
      false,
      ['sign']
    )
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      CANONICAL_FIXTURE_PUBLIC_KEY,
      'Ed25519',
      false,
      ['verify']
    )
    const manifest = await signTeamMotionLibraryManifest(canonicalFixturePayload(), privateKey)
    await verifyTeamMotionLibraryManifest(manifest, publicKey, { expectedKeyId: 'I_key-id' })

    expect(manifest.integrity).toMatchObject({
      digest: CANONICAL_FIXTURE_DIGEST,
      signature: { value: CANONICAL_FIXTURE_SIGNATURE }
    })
    const payloadDigest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        webCryptoBuffer(new TextEncoder().encode(CANONICAL_FIXTURE_PAYLOAD))
      )
    )
    expect(base64URLBytes(CANONICAL_FIXTURE_DIGEST)).toEqual(payloadDigest)

    const signedEnvelope = `{"algorithm":"SHA-256","digest":"${CANONICAL_FIXTURE_DIGEST}","payload":${CANONICAL_FIXTURE_PAYLOAD}}`
    expect(
      await crypto.subtle.verify(
        'Ed25519',
        publicKey,
        webCryptoBuffer(base64URLBytes(CANONICAL_FIXTURE_SIGNATURE)),
        webCryptoBuffer(new TextEncoder().encode(signedEnvelope))
      )
    ).toBe(true)
  })

  test('signs canonical snapshots and verifies digest, key id, engine range, and signature', async () => {
    const keyPair = await keys()
    const manifest = await signTeamMotionLibraryManifest(payload(), keyPair.privateKey)
    const snapshot = await verifyTeamMotionLibraryManifest(manifest, keyPair.publicKey, {
      expectedKeyId: 'teamKey1',
      engineVersion: '0.9.0'
    })

    expect(snapshot.verifiedDigest).toBe(manifest.integrity.digest)
    expect(snapshot.verifiedKeyId).toBe('teamKey1')
    expect(
      parseTeamMotionLibraryManifest(JSON.parse(serializeTeamMotionLibraryManifest(manifest)))
    ).toEqual(manifest)

    const tampered = structuredClone(manifest)
    const presetEntry = tampered.entries[0]
    if (presetEntry?.kind !== 'preset') throw new Error('Expected preset')
    const presetTrack = presetEntry.preset.motion.tracks[0]
    if (!presetTrack) throw new Error('Expected preset track')
    presetTrack.timing.durationMs = 999
    await expect(verifyTeamMotionLibraryManifest(tampered, keyPair.publicKey)).rejects.toThrow(
      /digest mismatch/
    )

    const otherKeys = await keys()
    await expect(verifyTeamMotionLibraryManifest(manifest, otherKeys.publicKey)).rejects.toThrow(
      /signature verification failed/
    )
    await expect(
      verifyTeamMotionLibraryManifest(manifest, keyPair.publicKey, { engineVersion: '1.0.0' })
    ).rejects.toThrow(/requires OpenPencil/)
  })

  test('supports exact, comparator, caret, tilde, and wildcard engine ranges', () => {
    expect(satisfiesTeamMotionEngineRange('0.8.4', '*')).toBe(true)
    expect(satisfiesTeamMotionEngineRange('0.8.4', '0.8.4')).toBe(true)
    expect(satisfiesTeamMotionEngineRange('0.8.4', '>=0.8.0 <1.0.0')).toBe(true)
    expect(satisfiesTeamMotionEngineRange('0.9.0', '^0.8.0')).toBe(false)
    expect(satisfiesTeamMotionEngineRange('1.4.2', '^1.2.0')).toBe(true)
    expect(satisfiesTeamMotionEngineRange('1.3.9', '~1.3.0')).toBe(true)
    expect(satisfiesTeamMotionEngineRange('1.4.0', '~1.3.0')).toBe(false)
    expect(() => satisfiesTeamMotionEngineRange('9007199254740992.0.0', '*')).toThrow(
      /safe non-negative integers/
    )
  })

  test('instantiates reproducible preset and token-bound recipe snapshots', async () => {
    const snapshot = await verified(await keys())
    const preset = instantiateTeamMotionLibraryEntry(snapshot, 'user-soft-enter')
    expect(preset).toMatchObject({
      kind: 'preset',
      motion: { tracks: [{ timing: { durationMs: 320 } }] }
    })

    const recipe = instantiateTeamMotionLibraryEntry(snapshot, 'pairedEnter', {
      roleMapping: { hero: ['node:hero'] },
      tokens: { 'motion.duration.medium': 640 }
    })
    expect(recipe).toMatchObject({
      kind: 'recipe',
      result: {
        parameters: { duration: 640 },
        assignments: [
          { nodeId: 'node:hero', motion: { tracks: [{ timing: { durationMs: 640 } }] } }
        ]
      }
    })
  })

  test(
    'accepts maximum entry and token counts within a bounded verification budget',
    { timeout: 15_000 },
    async () => {
      const keyPair = await keys()
      const boundaryPayload = maxCountPayload()
      const startedAt = performance.now()
      const manifest = await signTeamMotionLibraryManifest(boundaryPayload, keyPair.privateKey)
      const snapshot = await verifyTeamMotionLibraryManifest(manifest, keyPair.publicKey, {
        expectedKeyId: 'teamKey1',
        engineVersion: '0.8.4'
      })
      const elapsedMs = performance.now() - startedAt

      expect(snapshot.manifest.entries).toHaveLength(TEAM_MOTION_LIBRARY_LIMITS.maxEntries)
      expect(snapshot.manifest.tokens).toHaveLength(TEAM_MOTION_LIBRARY_LIMITS.maxTokens)
      expect(snapshot.verifiedDigest).toBe(manifest.integrity.digest)
      // Keep the ceiling intentionally coarse: this catches accidental unbounded work, not machine speed.
      expect(elapsedMs).toBeLessThan(5_000)
    }
  )

  test('fails closed one item beyond payload and recipe collection limits', () => {
    const entryOverflow = maxCountPayload()
    const firstEntry = entryOverflow.entries[0]
    if (!firstEntry) throw new Error('Expected boundary entry')
    entryOverflow.entries.push(structuredClone(firstEntry))
    expect(() => parseTeamMotionLibraryPayload(entryOverflow)).toThrow(
      `Expected 1-${TEAM_MOTION_LIBRARY_LIMITS.maxEntries} entries`
    )

    const tokenOverflow = maxCountPayload()
    const firstToken = tokenOverflow.tokens[0]
    if (!firstToken) throw new Error('Expected boundary token')
    tokenOverflow.tokens.push(structuredClone(firstToken))
    expect(() => parseTeamMotionLibraryPayload(tokenOverflow)).toThrow(
      /Too many team Motion tokens/
    )

    const bindingOverflow = payload()
    const recipeEntry = bindingOverflow.entries.find((entry) => entry.kind === 'recipe')
    if (recipeEntry?.kind !== 'recipe') throw new Error('Expected recipe entry')
    recipeEntry.tokenBindings = Array.from(
      { length: TEAM_MOTION_LIBRARY_LIMITS.maxTokenBindings + 1 },
      () => ({ tokenId: 'motion.duration.medium', parameterId: 'duration' })
    )
    expect(() => parseTeamMotionLibraryPayload(bindingOverflow)).toThrow(/Too many token bindings/)
  })

  test('accepts maximum rollback history and rejects one additional snapshot', async () => {
    const accepted = await verified(await keys())
    const history = Array.from({ length: TEAM_MOTION_LIBRARY_LIMITS.maxHistory }, (_, index) =>
      historySnapshot(accepted, index)
    )
    const registry = { version: 1 as const, accepted, history }

    expect(parseTeamMotionLibraryRegistryState(registry).history).toHaveLength(
      TEAM_MOTION_LIBRARY_LIMITS.maxHistory
    )
    expect(() =>
      parseTeamMotionLibraryRegistryState({
        ...registry,
        history: [...history, historySnapshot(accepted, history.length)]
      })
    ).toThrow(/Too many rollback snapshots/)
  })

  test('reviews, accepts, rejects, and rolls back only verified immutable snapshots', async () => {
    const keyPair = await keys()
    const first = await verified(keyPair, '1.0.0', 320)
    const second = await verified(keyPair, '1.1.0', 480)
    let registry = createTeamMotionLibraryRegistry(first)
    registry = reviewTeamMotionLibraryUpdate(registry, second)

    expect(registry.pending?.diff).toEqual({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      added: [],
      removed: [],
      updated: ['user-soft-enter']
    })
    expect(diffTeamMotionLibraries(first, second).updated).toEqual(['user-soft-enter'])
    expect(rejectTeamMotionLibraryReview(registry).pending).toBeUndefined()

    registry = acceptTeamMotionLibraryReview(registry)
    expect(registry.accepted.manifest.version).toBe('1.1.0')
    expect(registry.history.map(({ manifest }) => manifest.version)).toEqual(['1.0.0'])
    expect(() => reviewTeamMotionLibraryUpdate(registry, first)).toThrow(/explicit rollback/)
    expect(() =>
      acceptTeamMotionLibraryReview({
        ...registry,
        pending: {
          candidate: first,
          diff: diffTeamMotionLibraries(second, first),
          status: 'pending'
        }
      })
    ).toThrow(/explicit rollback/)
    registry = rollbackTeamMotionLibrary(registry, first.verifiedDigest)
    expect(registry.accepted.manifest.version).toBe('1.0.0')
    expect(registry.history[0]?.manifest.version).toBe('1.1.0')

    const rewrittenSameVersion = await verified(keyPair, '1.0.0', 700)
    expect(() => reviewTeamMotionLibraryUpdate(registry, rewrittenSameVersion)).toThrow(
      /without a version bump/
    )
  })

  test('fails closed for malformed, future, unsafe, and inconsistent manifests', async () => {
    const keyPair = await keys()
    const manifest = await signTeamMotionLibraryManifest(payload(), keyPair.privateKey)
    const invalid: unknown[] = [
      { ...manifest, schemaVersion: 2 },
      { ...manifest, unexpected: true },
      { ...manifest, engineRange: 'latest' },
      { ...manifest, publisher: { ...manifest.publisher, keyId: '__proto__' } },
      { ...manifest, source: { kind: 'url', ref: 'https://user:password@example.com/lib' } },
      {
        ...manifest,
        entries: [manifest.entries[0], structuredClone(manifest.entries[0])]
      },
      {
        ...manifest,
        integrity: {
          ...manifest.integrity,
          signature: { ...manifest.integrity.signature, keyId: 'otherKey' }
        }
      }
    ]
    for (const candidate of invalid) {
      expect(validateTeamMotionLibraryManifest(candidate).success).toBe(false)
    }
  })
})
