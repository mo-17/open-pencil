import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  SHARED_MOTION_PRESET_MANIFEST_FORMAT,
  SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
  USER_MOTION_PRESET_FORMAT,
  USER_MOTION_PRESET_SCHEMA_VERSION,
  createMotionPreset,
  parseSharedMotionPresetLibraryState,
  serializeUserMotionPresetLibrary,
  type SharedMotionPresetManifest,
  type UserMotionPresetLibrary
} from '@open-pencil/scene-graph'

import {
  readSharedMotionPresetSource,
  type MotionPresetSourceResponse
} from '#cli/commands/motion/presets-source'

import { runOpenPencilCLI } from '#tests/helpers/cli'

const temporaryDirectories: string[] = []

function portableLibrary(revision: number, durationMs: number): UserMotionPresetLibrary {
  const motion = createMotionPreset('fade-in')
  delete motion.preset
  motion.tracks[0].timing.durationMs = durationMs
  return {
    format: USER_MOTION_PRESET_FORMAT,
    schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
    presets: [
      {
        id: 'user-team-fade',
        revision,
        name: 'Team fade',
        description: 'Shared entrance motion',
        category: 'entrance',
        motion
      }
    ]
  }
}

function urlManifest(ref: string): SharedMotionPresetManifest {
  return {
    format: SHARED_MOTION_PRESET_MANIFEST_FORMAT,
    schemaVersion: SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
    publisher: { id: 'design-team', name: 'Design team' },
    library: { id: 'team-motion', name: 'Team Motion' },
    source: { kind: 'url', ref },
    readonly: true,
    sourceVersion: 'v1',
    presets: portableLibrary(1, 240).presets
  }
}

function response(json: string, status = 200): MotionPresetSourceResponse {
  const bytes = new TextEncoder().encode(json)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Service Unavailable',
    headers: {
      get: (name) => (name.toLowerCase() === 'content-length' ? String(bytes.length) : null)
    },
    arrayBuffer: async () => bytes.slice().buffer
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('shared motion preset source reader', () => {
  test('uses injectable URL IO and validates the declared source', async () => {
    const source = { kind: 'url' as const, ref: 'https://presets.example/team.json' }
    const requested: string[] = []
    const manifest = urlManifest(source.ref)
    const parsed = await readSharedMotionPresetSource(source, {
      fetch: async (url) => {
        requested.push(url)
        return response(JSON.stringify(manifest))
      }
    })

    expect(requested).toEqual([source.ref])
    expect(parsed).toMatchObject({ library: { id: 'team-motion' }, sourceVersion: 'v1' })
  })

  test('reports network and HTTP failures with the source URL', async () => {
    const source = { kind: 'url' as const, ref: 'https://presets.example/team.json' }
    await expect(
      readSharedMotionPresetSource(source, {
        fetch: async () => {
          throw new Error('offline')
        }
      })
    ).rejects.toThrow(/presets\.example\/team\.json.*network request failed: offline/)

    await expect(
      readSharedMotionPresetSource(source, { fetch: async () => response('', 503) })
    ).rejects.toThrow(/HTTP 503 Service Unavailable/)
  })
})

describe('motion presets CLI', () => {
  test('publishes, imports, checks without replacing, and explicitly accepts an update', async () => {
    const directory = join(tmpdir(), `openpencil-motion-presets-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const personal = join(directory, 'personal.json')
    const manifest = join(directory, 'shared.json')
    const importedState = join(directory, 'imported-state.json')
    const checkedState = join(directory, 'checked-state.json')
    const acceptedState = join(directory, 'accepted-state.json')

    await Bun.write(personal, serializeUserMotionPresetLibrary(portableLibrary(1, 240)))
    const publishV1 = await runOpenPencilCLI([
      'motion',
      'presets',
      'publish',
      personal,
      '--publisher-id',
      'design-team',
      '--publisher-name',
      'Design team',
      '--library-id',
      'team-motion',
      '--library-name',
      'Team Motion',
      '--source-version',
      'v1',
      '-o',
      manifest,
      '--json'
    ])
    expect(publishV1).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(publishV1.stdout)).toMatchObject({
      manifest: { readonly: true, source: { kind: 'file', ref: resolve(manifest) } },
      output: resolve(manifest)
    })

    const imported = await runOpenPencilCLI([
      'motion',
      'presets',
      'import',
      manifest,
      '-o',
      importedState,
      '--json'
    ])
    expect(imported).toMatchObject({ exitCode: 0, stderr: '' })
    expect(
      parseSharedMotionPresetLibraryState(JSON.parse(await Bun.file(importedState).text()))
    ).toMatchObject({
      manifest: { sourceVersion: 'v1' },
      sourceVersion: 'v1',
      updateAvailable: false
    })

    await Bun.write(personal, serializeUserMotionPresetLibrary(portableLibrary(2, 480)))
    const publishV2 = await runOpenPencilCLI([
      'motion',
      'presets',
      'publish',
      personal,
      '--publisher-id',
      'design-team',
      '--publisher-name',
      'Design team',
      '--library-id',
      'team-motion',
      '--library-name',
      'Team Motion',
      '--source-version',
      'v2',
      '-o',
      manifest,
      '--json'
    ])
    expect(publishV2.exitCode).toBe(0)

    const checked = await runOpenPencilCLI([
      'motion',
      'presets',
      'check',
      importedState,
      '-o',
      checkedState
    ])
    expect(checked).toMatchObject({ exitCode: 0, stderr: '' })
    expect(checked.stdout).toContain('update-available')
    expect(checked.stdout).toContain('team-motion')
    const checkedSnapshot = parseSharedMotionPresetLibraryState(
      JSON.parse(await Bun.file(checkedState).text())
    )
    expect(checkedSnapshot).toMatchObject({
      manifest: { sourceVersion: 'v1' },
      sourceVersion: 'v2',
      updateAvailable: true
    })
    expect(checkedSnapshot.manifest.presets[0]?.motion.tracks[0]?.timing.durationMs).toBe(240)

    const accepted = await runOpenPencilCLI([
      'motion',
      'presets',
      'accept',
      checkedState,
      '-o',
      acceptedState,
      '--json'
    ])
    expect(accepted).toMatchObject({ exitCode: 0, stderr: '' })
    const acceptedSnapshot = parseSharedMotionPresetLibraryState(
      JSON.parse(await Bun.file(acceptedState).text())
    )
    expect(acceptedSnapshot).toMatchObject({
      manifest: { sourceVersion: 'v2' },
      sourceVersion: 'v2',
      updateAvailable: false
    })
    expect(acceptedSnapshot.manifest.presets[0]?.motion.tracks[0]?.timing.durationMs).toBe(480)
  })
})
