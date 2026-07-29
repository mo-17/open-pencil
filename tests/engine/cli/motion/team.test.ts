import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import {
  TEAM_MOTION_LIBRARY_FORMAT,
  TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
  parseTeamMotionLibraryRegistryState,
  SceneGraph,
  type TeamMotionLibraryPayload
} from '@open-pencil/scene-graph'

import { runOpenPencilCLI } from '#tests/helpers/cli'

const temporaryDirectories: string[] = []
const io = new IORegistry(BUILTIN_IO_FORMATS)

function payload(version: string, durationMs: number): TeamMotionLibraryPayload {
  return {
    format: TEAM_MOTION_LIBRARY_FORMAT,
    schemaVersion: TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
    publisher: { id: 'designTeam', name: 'Design Team', keyId: 'teamKey1' },
    library: { id: 'brandMotion', name: 'Brand Motion' },
    version,
    engineRange: '>=0.13.0 <1.0.0',
    source: { kind: 'file', ref: 'brand-motion.json' },
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
          id: 'user-team-enter',
          revision: version === '1.0.0' ? 1 : 2,
          name: 'Team enter',
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
          id: 'teamRecipe',
          name: 'Team recipe',
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

function pem(label: string, buffer: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  const encoded =
    btoa(binary)
      .match(/.{1,64}/g)
      ?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----\n`
}

async function writeKeys(directory: string): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const privateKey = join(directory, 'private.pem')
  const publicKey = join(directory, 'public.pem')
  await Bun.write(
    privateKey,
    pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  )
  await Bun.write(
    publicKey,
    pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey))
  )
  return { privateKey, publicKey }
}

async function createFigFixture(directory: string): Promise<{ input: string; targetId: string }> {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.createNode('RECTANGLE', page.id, {
    name: 'Team Motion target',
    width: 100,
    height: 40
  })
  const input = join(directory, 'input.fig')
  const encoded = await io.writeDocument('fig', graph)
  await Bun.write(input, encoded.data)
  const found = await runOpenPencilCLI(['find', input, '--name', 'Team Motion target', '--json'])
  expect(found).toMatchObject({ exitCode: 0, stderr: '' })
  const target = (JSON.parse(found.stdout) as Array<{ id: string }>)[0]
  if (!target) throw new Error('Expected Team Motion target')
  return { input, targetId: target.id }
}

async function createRegistryFixture(
  directory: string,
  version = '1.0.0',
  durationMs = 240
): Promise<{ registry: string; publicKey: string }> {
  const { privateKey, publicKey } = await writeKeys(directory)
  const unsigned = join(directory, `payload-${version}.json`)
  const manifest = join(directory, `manifest-${version}.json`)
  const registry = join(directory, `registry-${version}.json`)
  await Bun.write(unsigned, JSON.stringify(payload(version, durationMs)))
  const signed = await runOpenPencilCLI([
    'motion',
    'team',
    'sign',
    unsigned,
    '--private-key',
    privateKey,
    '-o',
    manifest,
    '--json'
  ])
  expect(signed).toMatchObject({ exitCode: 0, stderr: '' })
  const imported = await runOpenPencilCLI([
    'motion',
    'team',
    'import',
    manifest,
    '--public-key',
    publicKey,
    '-o',
    registry,
    '--json'
  ])
  expect(imported).toMatchObject({ exitCode: 0, stderr: '' })
  return { registry, publicKey }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('motion team CLI', () => {
  test('signs, verifies, reviews, accepts, instantiates, and rolls back trusted snapshots', async () => {
    const directory = join(tmpdir(), `openpencil-motion-team-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const { privateKey, publicKey } = await writeKeys(directory)
    const unsigned = join(directory, 'payload.json')
    const manifest = join(directory, 'manifest.json')
    const registry = join(directory, 'registry.json')
    const reviewed = join(directory, 'reviewed.json')
    const accepted = join(directory, 'accepted.json')
    const rolledBack = join(directory, 'rolled-back.json')
    const instantiated = join(directory, 'instantiated.json')

    await Bun.write(unsigned, JSON.stringify(payload('1.0.0', 240)))
    const signedV1 = await runOpenPencilCLI([
      'motion',
      'team',
      'sign',
      unsigned,
      '--private-key',
      privateKey,
      '-o',
      manifest,
      '--json'
    ])
    expect(signedV1).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(signedV1.stdout)).toMatchObject({
      manifest: { integrity: { signature: { keyId: 'teamKey1' } } }
    })

    const verified = await runOpenPencilCLI([
      'motion',
      'team',
      'verify',
      manifest,
      '--public-key',
      publicKey,
      '--key-id',
      'teamKey1',
      '--json'
    ])
    expect(verified).toMatchObject({ exitCode: 0, stderr: '' })
    const firstDigest = JSON.parse(verified.stdout).verifiedDigest as string

    const imported = await runOpenPencilCLI([
      'motion',
      'team',
      'import',
      manifest,
      '--public-key',
      publicKey,
      '-o',
      registry,
      '--json'
    ])
    expect(imported).toMatchObject({ exitCode: 0, stderr: '' })

    await Bun.write(unsigned, JSON.stringify(payload('1.1.0', 480)))
    expect(
      (
        await runOpenPencilCLI([
          'motion',
          'team',
          'sign',
          unsigned,
          '--private-key',
          privateKey,
          '-o',
          manifest
        ])
      ).exitCode
    ).toBe(0)

    const review = await runOpenPencilCLI([
      'motion',
      'team',
      'review',
      registry,
      manifest,
      '--public-key',
      publicKey,
      '-o',
      reviewed,
      '--json'
    ])
    expect(review).toMatchObject({ exitCode: 0, stderr: '' })
    const reviewedState = parseTeamMotionLibraryRegistryState(
      JSON.parse(await Bun.file(reviewed).text())
    )
    expect(reviewedState.accepted.manifest.version).toBe('1.0.0')
    expect(reviewedState.pending?.diff.updated).toEqual(['user-team-enter'])

    const foreignKeyIdPayload = payload('1.2.0', 520)
    foreignKeyIdPayload.publisher.keyId = 'sameKeyDifferentIdentity'
    await Bun.write(unsigned, JSON.stringify(foreignKeyIdPayload))
    expect(
      (
        await runOpenPencilCLI([
          'motion',
          'team',
          'sign',
          unsigned,
          '--private-key',
          privateKey,
          '-o',
          manifest
        ])
      ).exitCode
    ).toBe(0)
    const foreignKeyIdReview = await runOpenPencilCLI([
      'motion',
      'team',
      'review',
      registry,
      manifest,
      '--public-key',
      publicKey,
      '-o',
      join(directory, 'foreign-key-id.json')
    ])
    expect(foreignKeyIdReview.exitCode).toBe(1)
    expect(foreignKeyIdReview.stderr).toContain('key id')

    await Bun.write(unsigned, JSON.stringify(payload('1.1.0', 480)))
    expect(
      (
        await runOpenPencilCLI([
          'motion',
          'team',
          'sign',
          unsigned,
          '--private-key',
          privateKey,
          '-o',
          manifest
        ])
      ).exitCode
    ).toBe(0)

    const inPlace = join(directory, 'in-place-registry.json')
    await Bun.write(inPlace, await Bun.file(reviewed).text())
    const rejectedInPlace = await runOpenPencilCLI([
      'motion',
      'team',
      'reject',
      inPlace,
      '--public-key',
      publicKey,
      '-o',
      inPlace,
      '--json'
    ])
    expect(rejectedInPlace).toMatchObject({ exitCode: 0, stderr: '' })
    expect(
      parseTeamMotionLibraryRegistryState(JSON.parse(await Bun.file(inPlace).text())).pending
    ).toBeUndefined()
    expect(
      (await readdir(directory)).some((name) => name.endsWith('.openpencil-registry-tmp'))
    ).toBe(false)

    const accept = await runOpenPencilCLI([
      'motion',
      'team',
      'accept',
      reviewed,
      '--public-key',
      publicKey,
      '-o',
      accepted,
      '--json'
    ])
    expect(accept).toMatchObject({ exitCode: 0, stderr: '' })
    expect(
      parseTeamMotionLibraryRegistryState(JSON.parse(await Bun.file(accepted).text()))
    ).toMatchObject({
      accepted: { manifest: { version: '1.1.0' } },
      history: [{ manifest: { version: '1.0.0' } }]
    })

    const instance = await runOpenPencilCLI([
      'motion',
      'team',
      'instantiate',
      accepted,
      '--entry',
      'user-team-enter',
      '--public-key',
      publicKey,
      '-o',
      instantiated,
      '--json'
    ])
    expect(instance).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(await Bun.file(instantiated).text())).toMatchObject({
      kind: 'preset',
      motion: { tracks: [{ timing: { durationMs: 480 } }] }
    })

    const rollback = await runOpenPencilCLI([
      'motion',
      'team',
      'rollback',
      accepted,
      '--digest',
      firstDigest,
      '--public-key',
      publicKey,
      '-o',
      rolledBack,
      '--json'
    ])
    expect(rollback).toMatchObject({ exitCode: 0, stderr: '' })
    expect(
      parseTeamMotionLibraryRegistryState(JSON.parse(await Bun.file(rolledBack).text())).accepted
        .manifest.version
    ).toBe('1.0.0')
  }, 30_000)

  test('fails closed for a tampered manifest', async () => {
    const directory = join(tmpdir(), `openpencil-motion-team-tamper-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const { privateKey, publicKey } = await writeKeys(directory)
    const unsigned = join(directory, 'payload.json')
    const manifest = join(directory, 'manifest.json')
    await Bun.write(unsigned, JSON.stringify(payload('1.0.0', 240)))
    const signed = await runOpenPencilCLI([
      'motion',
      'team',
      'sign',
      unsigned,
      '--private-key',
      privateKey,
      '-o',
      manifest
    ])
    expect(signed.exitCode).toBe(0)
    const tampered = JSON.parse(await Bun.file(manifest).text())
    tampered.entries[0].preset.motion.tracks[0].timing.durationMs = 999
    await Bun.write(manifest, JSON.stringify(tampered))

    const result = await runOpenPencilCLI([
      'motion',
      'team',
      'verify',
      manifest,
      '--public-key',
      publicKey,
      '--json'
    ])
    expect(result.exitCode).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain('digest mismatch')
  })

  test('applies verified recipe roles and Team tokens to an atomic new .fig output', async () => {
    const directory = join(tmpdir(), `openpencil-motion-team-apply-fig-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const { registry, publicKey } = await createRegistryFixture(directory)
    const fixture = await createFigFixture(directory)
    const output = join(directory, 'applied.fig')
    const applied = await runOpenPencilCLI([
      'motion',
      'team',
      'apply',
      fixture.input,
      registry,
      '--entry',
      'teamRecipe',
      '--roles',
      JSON.stringify({ hero: [fixture.targetId] }),
      '--tokens',
      JSON.stringify({ 'motion.duration': 720 }),
      '--public-key',
      publicKey,
      '--key-id',
      'teamKey1',
      '-o',
      output,
      '--json'
    ])

    expect(applied).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(applied.stdout)).toMatchObject({
      libraryId: 'brandMotion',
      libraryVersion: '1.0.0',
      entryId: 'teamRecipe',
      kind: 'recipe',
      assignmentCount: 1,
      output
    })
    const decoded = await io.readDocument({
      name: output,
      data: new Uint8Array(await Bun.file(output).arrayBuffer())
    })
    const target = [...decoded.graph.getAllNodes()].find(
      ({ name }) => name === 'Team Motion target'
    )
    expect(target?.motion?.tracks[0]?.timing.durationMs).toBe(720)
    expect((await readdir(directory)).some((name) => name.endsWith('.openpencil-tmp'))).toBe(false)
  }, 30_000)

  test('source-preserves .pen and fails closed for clobbering, conversion, or registry tampering', async () => {
    const directory = join(tmpdir(), `openpencil-motion-team-apply-pen-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const { registry, publicKey } = await createRegistryFixture(directory)
    const input = join(directory, 'input.pen')
    const output = join(directory, 'applied.pen')
    const inputSource = `${JSON.stringify(
      {
        version: '2.14',
        children: [
          {
            id: 'penTarget',
            type: 'rectangle',
            name: 'Pen target',
            width: 120,
            height: 48
          }
        ]
      },
      null,
      2
    )}\n`
    await Bun.write(input, inputSource)
    const applyArgs = [
      'motion',
      'team',
      'apply',
      input,
      registry,
      '--entry',
      'user-team-enter',
      '--nodes',
      JSON.stringify(['penTarget']),
      '--public-key',
      publicKey,
      '-o',
      output,
      '--json'
    ]
    const applied = await runOpenPencilCLI(applyArgs)
    expect(applied).toMatchObject({ exitCode: 0, stderr: '' })
    expect(await Bun.file(input).text()).toBe(inputSource)
    const decoded = await io.readDocument({
      name: output,
      data: new Uint8Array(await Bun.file(output).arrayBuffer())
    })
    expect(decoded.graph.getNode('penTarget')?.motion?.tracks[0]?.timing.durationMs).toBe(240)

    const outputBefore = await Bun.file(output).text()
    const clobber = await runOpenPencilCLI(applyArgs)
    expect(clobber.exitCode).toBe(1)
    expect(clobber.stderr).toContain('Refusing to overwrite')
    expect(await Bun.file(output).text()).toBe(outputBefore)

    const sourceClobber = await runOpenPencilCLI([...applyArgs.slice(0, -3), '-o', input, '--json'])
    expect(sourceClobber.exitCode).toBe(1)
    expect(sourceClobber.stderr).toContain('must differ')
    expect(await Bun.file(input).text()).toBe(inputSource)

    const converted = join(directory, 'converted.fig')
    const crossFormat = await runOpenPencilCLI([
      ...applyArgs.slice(0, -3),
      '-o',
      converted,
      '--json'
    ])
    expect(crossFormat.exitCode).toBe(1)
    expect(crossFormat.stderr).toContain('preserves the input document format')
    expect(await Bun.file(converted).exists()).toBe(false)

    const tamperedRegistry = join(directory, 'tampered-registry.json')
    const tampered = JSON.parse(await Bun.file(registry).text())
    tampered.accepted.manifest.entries[0].preset.motion.tracks[0].timing.durationMs = 999
    await Bun.write(tamperedRegistry, JSON.stringify(tampered))
    const tamperedOutput = join(directory, 'tampered-output.pen')
    const tamperedApply = await runOpenPencilCLI([
      'motion',
      'team',
      'apply',
      input,
      tamperedRegistry,
      '--entry',
      'user-team-enter',
      '--nodes',
      JSON.stringify(['penTarget']),
      '--public-key',
      publicKey,
      '-o',
      tamperedOutput
    ])
    expect(tamperedApply.exitCode).toBe(1)
    expect(tamperedApply.stderr).toContain('digest mismatch')
    expect(await Bun.file(tamperedOutput).exists()).toBe(false)

    const metadataRegistry = join(directory, 'tampered-metadata-registry.json')
    const metadataTampered = JSON.parse(await Bun.file(registry).text())
    metadataTampered.accepted.verifiedDigest = `${metadataTampered.accepted.verifiedDigest.slice(1)}A`
    await Bun.write(metadataRegistry, JSON.stringify(metadataTampered))
    const metadataOutput = join(directory, 'tampered-metadata-output.pen')
    const metadataApply = await runOpenPencilCLI([
      'motion',
      'team',
      'apply',
      input,
      metadataRegistry,
      '--entry',
      'user-team-enter',
      '--nodes',
      JSON.stringify(['penTarget']),
      '--public-key',
      publicKey,
      '-o',
      metadataOutput
    ])
    expect(metadataApply.exitCode).toBe(1)
    expect(metadataApply.stderr).toContain('snapshot metadata does not match manifest')
    expect(await Bun.file(metadataOutput).exists()).toBe(false)
    expect((await readdir(directory)).some((name) => name.endsWith('.openpencil-tmp'))).toBe(false)
  }, 30_000)
})
