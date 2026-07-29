import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { CORE_TOOLS, EXTENDED_TOOLS } from '@open-pencil/core/tools'
import {
  TEAM_MOTION_LIBRARY_FORMAT,
  TEAM_MOTION_LIBRARY_LIMITS,
  TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
  exportTeamMotionPublicKey,
  parseTeamMotionLibraryRegistryState,
  signTeamMotionLibraryManifest,
  type TeamMotionLibraryManifest,
  type TeamMotionLibraryPayload,
  SceneGraph
} from '@open-pencil/scene-graph'

import { getTool } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function payload(version = '1.0.0', durationMs = 320): TeamMotionLibraryPayload {
  return {
    format: TEAM_MOTION_LIBRARY_FORMAT,
    schemaVersion: TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
    publisher: { id: 'toolTeam', name: 'Tool Team', keyId: 'toolTeamKey' },
    library: { id: 'toolTeamMotion', name: 'Tool Team Motion' },
    version,
    engineRange: '>=0.13.0 <1.0.0',
    source: { kind: 'url', ref: 'https://example.com/tool-team-motion.json' },
    tokens: [
      {
        id: 'motion.duration',
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
          id: 'user-tool-fade',
          revision: version === '1.0.0' ? 1 : 2,
          name: 'Tool fade',
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
          id: 'toolRecipe',
          name: 'Tool recipe',
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
                      { offset: 0, y: 24 },
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
        tokenBindings: [{ tokenId: 'motion.duration', parameterId: 'duration' }]
      }
    ]
  }
}

async function signedFixture(
  keyPair: CryptoKeyPair,
  version = '1.0.0',
  durationMs = 320
): Promise<{ manifestJson: string; publicKeyPem: string }> {
  const manifest = await signTeamMotionLibraryManifest(
    payload(version, durationMs),
    keyPair.privateKey
  )
  return {
    manifestJson: JSON.stringify(manifest),
    publicKeyPem: await exportTeamMotionPublicKey(keyPair.publicKey)
  }
}

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  return { graph, figma, editor }
}

describe('Team Motion library tools', () => {
  test('registers verify, review, pure management, and apply for built-in AI and MCP', () => {
    const core = new Map(CORE_TOOLS.map((tool) => [tool.name, tool]))
    const extended = new Set(EXTENDED_TOOLS.map(({ name }) => name))
    for (const name of [
      'verify_team_motion_library',
      'review_team_motion_library_update',
      'manage_team_motion_library_registry',
      'apply_team_motion_library_entry'
    ]) {
      expect(core.has(name)).toBe(true)
      expect(extended.has(name)).toBe(false)
    }
    expect(core.get('manage_team_motion_library_registry')?.mutates).not.toBe(true)
  })

  test('verifies signatures and returns a bounded manifest summary', async () => {
    const fixture = await signedFixture(await keyPair())
    const result = (await getTool('verify_team_motion_library').execute(
      new FigmaAPI(new SceneGraph()),
      {
        ...fixture,
        engineVersion: '0.13.2',
        expectedKeyId: 'toolTeamKey'
      }
    )) as Result<{ libraryId: string; entryIds: string[]; tokenCount: number }>

    expect(result).toMatchObject({
      ok: true,
      data: {
        libraryId: 'toolTeamMotion',
        entryIds: ['user-tool-fade', 'toolRecipe'],
        tokenCount: 1
      }
    })
  })

  test(
    'accepts manifest JSON at the raw byte limit and fails closed one byte beyond it',
    { timeout: 15_000 },
    async () => {
      const fixture = await signedFixture(await keyPair())
      const currentBytes = new TextEncoder().encode(fixture.manifestJson).byteLength
      const boundaryManifest = `${fixture.manifestJson}${' '.repeat(
        TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes - currentBytes
      )}`
      const tool = getTool('verify_team_motion_library')
      const args = {
        publicKeyPem: fixture.publicKeyPem,
        engineVersion: '0.13.2',
        expectedKeyId: 'toolTeamKey'
      }

      expect(new TextEncoder().encode(boundaryManifest)).toHaveLength(
        TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes
      )
      expect(
        (await tool.execute(new FigmaAPI(new SceneGraph()), {
          ...args,
          manifestJson: boundaryManifest
        })) as Result<{ libraryId: string }>
      ).toMatchObject({ ok: true, data: { libraryId: 'toolTeamMotion' } })

      const overflow = (await tool.execute(new FigmaAPI(new SceneGraph()), {
        ...args,
        manifestJson: `${boundaryManifest} `
      })) as Result<never>
      expect(overflow).toEqual({
        ok: false,
        error: `manifestJson must not exceed ${TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes} UTF-8 bytes`
      })
    }
  )

  test('reviews only verified same-identity updates and returns the deterministic diff', async () => {
    const keys = await keyPair()
    const accepted = await signedFixture(keys)
    const candidate = await signedFixture(keys, '1.1.0', 480)
    const result = (await getTool('review_team_motion_library_update').execute(
      new FigmaAPI(new SceneGraph()),
      {
        acceptedManifestJson: accepted.manifestJson,
        candidateManifestJson: candidate.manifestJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        expectedKeyId: 'toolTeamKey'
      }
    )) as Result<{
      fromVersion: string
      toVersion: string
      updated: string[]
      registryJson: string
    }>

    expect(result).toMatchObject({
      ok: true,
      data: {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        updated: ['user-tool-fade']
      }
    })
    if (!result.ok) throw new Error(result.error)
    expect(parseTeamMotionLibraryRegistryState(JSON.parse(result.data.registryJson))).toMatchObject(
      {
        accepted: { manifest: { version: '1.0.0' } },
        pending: { candidate: { manifest: { version: '1.1.0' } } }
      }
    )
  })

  test('reverifies every registry snapshot before accept, reject, or verified-history rollback', async () => {
    const keys = await keyPair()
    const accepted = await signedFixture(keys)
    const candidate = await signedFixture(keys, '1.1.0', 480)
    const review = (await getTool('review_team_motion_library_update').execute(
      new FigmaAPI(new SceneGraph()),
      {
        acceptedManifestJson: accepted.manifestJson,
        candidateManifestJson: candidate.manifestJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        expectedKeyId: 'toolTeamKey'
      }
    )) as Result<{ registryJson: string; acceptedDigest: string }>
    if (!review.ok) throw new Error(review.error)

    const { graph, figma, editor } = setup()
    const pendingTarget = figma.createRectangle()
    const appliedAcceptedOnly = (await getTool('apply_team_motion_library_entry').execute(
      figma,
      {
        registryJson: review.data.registryJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        entryId: 'user-tool-fade',
        nodeIds: [pendingTarget.id]
      },
      { editor }
    )) as Result<{ libraryVersion: string }>
    expect(appliedAcceptedOnly).toMatchObject({
      ok: true,
      data: { libraryVersion: '1.0.0' }
    })
    expect(graph.getNode(pendingTarget.id)?.motion?.tracks[0]?.timing.durationMs).toBe(320)
    expect(editor.undo.undo()).toBe('AI: apply_team_motion_library_entry')

    const acceptedTransition = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: review.data.registryJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        expectedKeyId: 'toolTeamKey',
        action: 'accept'
      }
    )) as Result<{
      acceptedVersion: string
      history: Array<{ version: string; digest: string }>
      registryJson: string
    }>
    expect(acceptedTransition).toMatchObject({
      ok: true,
      data: { acceptedVersion: '1.1.0', history: [{ version: '1.0.0' }] }
    })
    if (!acceptedTransition.ok) throw new Error(acceptedTransition.error)

    const nextCandidate = await signedFixture(keys, '1.2.0', 640)
    const continuedReview = (await getTool('review_team_motion_library_update').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: acceptedTransition.data.registryJson,
        candidateManifestJson: nextCandidate.manifestJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        expectedKeyId: 'toolTeamKey'
      }
    )) as Result<{ registryJson: string }>
    expect(continuedReview).toMatchObject({ ok: true })
    if (!continuedReview.ok) throw new Error(continuedReview.error)
    expect(
      parseTeamMotionLibraryRegistryState(JSON.parse(continuedReview.data.registryJson))
    ).toMatchObject({
      accepted: { manifest: { version: '1.1.0' } },
      history: [{ manifest: { version: '1.0.0' } }],
      pending: { candidate: { manifest: { version: '1.2.0' } } }
    })

    const rejectedTransition = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: review.data.registryJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        action: 'reject'
      }
    )) as Result<{ pendingVersion: string | null }>
    expect(rejectedTransition).toMatchObject({ ok: true, data: { pendingVersion: null } })

    const firstDigest = acceptedTransition.data.history[0]?.digest
    if (!firstDigest) throw new Error('Expected verified history digest')
    const rolledBack = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: acceptedTransition.data.registryJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        action: 'rollback',
        digest: firstDigest
      }
    )) as Result<{ acceptedVersion: string }>
    expect(rolledBack).toMatchObject({ ok: true, data: { acceptedVersion: '1.0.0' } })

    const unknownHistory = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: acceptedTransition.data.registryJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        action: 'rollback',
        digest: 'not-a-verified-history-digest'
      }
    )) as Result<unknown>
    expect(unknownHistory).toMatchObject({ ok: false })

    const tampered = JSON.parse(acceptedTransition.data.registryJson)
    tampered.history[0].manifest.entries[0].preset.motion.tracks[0].timing.durationMs = 999
    const tamperedHistory = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: JSON.stringify(tampered),
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        action: 'rollback',
        digest: firstDigest
      }
    )) as Result<unknown>
    expect(tamperedHistory).toMatchObject({ ok: false })
    if (!tamperedHistory.ok) expect(tamperedHistory.error).toContain('digest mismatch')
  })

  test('fails registry transitions for engine/key mismatch and rejects stale update reviews', async () => {
    const keys = await keyPair()
    const accepted = await signedFixture(keys)
    const candidate = await signedFixture(keys, '1.1.0', 480)
    const review = (await getTool('review_team_motion_library_update').execute(
      new FigmaAPI(new SceneGraph()),
      {
        acceptedManifestJson: accepted.manifestJson,
        candidateManifestJson: candidate.manifestJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2'
      }
    )) as Result<{ registryJson: string }>
    if (!review.ok) throw new Error(review.error)

    const incompatible = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: review.data.registryJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '1.0.0',
        action: 'accept'
      }
    )) as Result<unknown>
    expect(incompatible).toMatchObject({ ok: false })

    const otherKey = await signedFixture(await keyPair())
    const wrongKey = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: review.data.registryJson,
        publicKeyPem: otherKey.publicKeyPem,
        engineVersion: '0.13.2',
        action: 'accept'
      }
    )) as Result<unknown>
    expect(wrongKey).toMatchObject({ ok: false })

    const stale = await signedFixture(keys, '0.9.0', 200)
    const staleReview = (await getTool('review_team_motion_library_update').execute(
      new FigmaAPI(new SceneGraph()),
      {
        acceptedManifestJson: accepted.manifestJson,
        candidateManifestJson: stale.manifestJson,
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2'
      }
    )) as Result<unknown>
    expect(staleReview).toMatchObject({ ok: false })
    if (!staleReview.ok) expect(staleReview.error).toContain('cannot downgrade')

    const staleManifest = JSON.parse(stale.manifestJson) as TeamMotionLibraryManifest
    const stalePending = JSON.parse(review.data.registryJson)
    stalePending.pending.candidate = {
      manifest: staleManifest,
      verifiedDigest: staleManifest.integrity.digest,
      verifiedKeyId: staleManifest.integrity.signature.keyId
    }
    const stalePendingTransition = (await getTool('manage_team_motion_library_registry').execute(
      new FigmaAPI(new SceneGraph()),
      {
        registryJson: JSON.stringify(stalePending),
        publicKeyPem: accepted.publicKeyPem,
        engineVersion: '0.13.2',
        action: 'accept'
      }
    )) as Result<unknown>
    expect(stalePendingTransition).toMatchObject({ ok: false })
    if (!stalePendingTransition.ok) {
      expect(stalePendingTransition.error).toContain('cannot downgrade')
    }
  })

  test('applies verified preset and token-bound recipe snapshots with atomic undo', async () => {
    const fixture = await signedFixture(await keyPair())
    const { graph, figma, editor } = setup()
    const page = graph.getPages()[0]
    const first = graph.createNode('RECTANGLE', page.id)
    const second = graph.createNode('RECTANGLE', page.id)
    const preset = (await getTool('apply_team_motion_library_entry').execute(
      figma,
      {
        ...fixture,
        engineVersion: '0.13.2',
        entryId: 'user-tool-fade',
        nodeIds: [first.id, second.id]
      },
      { editor }
    )) as Result<{ assignmentCount: number }>

    expect(preset).toMatchObject({ ok: true, data: { assignmentCount: 2 } })
    expect(graph.getNode(first.id)?.motion?.tracks[0]?.timing.durationMs).toBe(320)
    expect(graph.getNode(second.id)?.motion?.tracks[0]?.timing.durationMs).toBe(320)
    expect(editor.undo.undo()).toBe('AI: apply_team_motion_library_entry')
    expect(graph.getNode(first.id)?.motion).toBeUndefined()
    expect(graph.getNode(second.id)?.motion).toBeUndefined()

    const recipe = (await getTool('apply_team_motion_library_entry').execute(
      figma,
      {
        ...fixture,
        engineVersion: '0.13.2',
        entryId: 'toolRecipe',
        roleMappingJson: JSON.stringify({ hero: [first.id] }),
        tokensJson: JSON.stringify({ 'motion.duration': 640 })
      },
      { editor }
    )) as Result<{ kind: string; assignmentCount: number }>
    expect(recipe).toMatchObject({ ok: true, data: { kind: 'recipe', assignmentCount: 1 } })
    expect(graph.getNode(first.id)?.motion?.tracks[0]?.timing.durationMs).toBe(640)
  })

  test('rejects tampering, engine mismatch, and missing targets before mutation', async () => {
    const fixture = await signedFixture(await keyPair())
    const { graph, figma, editor } = setup()
    const node = figma.createRectangle()
    const tampered = JSON.parse(fixture.manifestJson) as TeamMotionLibraryManifest
    const firstEntry = tampered.entries[0]
    if (firstEntry.kind !== 'preset') throw new Error('Expected preset fixture')
    const firstTrack = firstEntry.preset.motion.tracks[0]
    if (!firstTrack) throw new Error('Expected preset track fixture')
    firstTrack.timing.durationMs = 999
    const invalid = (await getTool('apply_team_motion_library_entry').execute(
      figma,
      {
        ...fixture,
        manifestJson: JSON.stringify(tampered),
        engineVersion: '0.13.2',
        entryId: 'user-tool-fade',
        nodeIds: [node.id]
      },
      { editor }
    )) as Result<unknown>
    expect(invalid.ok).toBe(false)
    expect(graph.getNode(node.id)?.motion).toBeUndefined()
    expect(editor.undo.canUndo).toBe(false)

    const incompatible = (await getTool('verify_team_motion_library').execute(figma, {
      ...fixture,
      engineVersion: '1.0.0'
    })) as Result<unknown>
    expect(incompatible.ok).toBe(false)

    const missing = (await getTool('apply_team_motion_library_entry').execute(
      figma,
      {
        ...fixture,
        engineVersion: '0.13.2',
        entryId: 'user-tool-fade',
        nodeIds: [node.id, 'missing']
      },
      { editor }
    )) as Result<unknown>
    expect(missing.ok).toBe(false)
    expect(graph.getNode(node.id)?.motion).toBeUndefined()
    expect(editor.undo.canUndo).toBe(false)
  })
})
