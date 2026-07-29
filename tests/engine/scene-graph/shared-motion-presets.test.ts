import { describe, expect, test } from 'bun:test'

import {
  SHARED_MOTION_PRESET_MANIFEST_FORMAT,
  SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
  SharedMotionPresetValidationError,
  acceptSharedMotionPresetLibraryUpdate,
  checkSharedMotionPresetLibraryUpdate,
  instantiateSharedMotionPreset,
  noteSharedMotionPresetLibraryUpdate,
  parseSharedMotionPresetLibraryState,
  parseSharedMotionPresetManifest,
  parseSharedMotionPresetManifestJson,
  serializeSharedMotionPresetManifest,
  validateSharedMotionPresetManifest,
  type SharedMotionPresetManifest
} from '@open-pencil/scene-graph'

function manifest(
  sourceVersion = 'v1',
  source: SharedMotionPresetManifest['source'] = {
    kind: 'url',
    ref: 'https://example.com/motion/presets.json'
  }
): SharedMotionPresetManifest {
  return {
    format: SHARED_MOTION_PRESET_MANIFEST_FORMAT,
    schemaVersion: SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
    publisher: { id: 'openpencil-team', name: 'OpenPencil 团队' },
    library: { id: 'brand-motion', name: '品牌动效' },
    source,
    readonly: true,
    sourceVersion,
    presets: [
      {
        id: 'user-soft-enter',
        revision: sourceVersion === 'v1' ? 1 : 2,
        name: '柔和进入',
        description: '共享入场动画',
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
              timing: { durationMs: sourceVersion === 'v1' ? 300 : 420 },
              exit: 'none'
            }
          ],
          reducedMotion: 'reduce'
        }
      }
    ]
  }
}

describe('shared motion preset manifests', () => {
  test('strictly parses file and URL sources and serializes deterministic detached snapshots', () => {
    const source = manifest()
    const parsed = parseSharedMotionPresetManifest(source)
    const json = serializeSharedMotionPresetManifest(parsed)

    expect(parseSharedMotionPresetManifestJson(json)).toEqual(parsed)
    expect(serializeSharedMotionPresetManifest(parseSharedMotionPresetManifestJson(json))).toBe(
      json
    )
    expect(parsed).not.toBe(source)
    expect(parsed.publisher).not.toBe(source.publisher)
    expect(parsed.presets[0].motion).not.toBe(source.presets[0].motion)

    const file = parseSharedMotionPresetManifest(
      manifest('build-7', { kind: 'file', ref: './motion/team-presets.json' })
    )
    expect(file.source).toEqual({ kind: 'file', ref: './motion/team-presets.json' })
  })

  test('checks without replacing and accepts updates explicitly', () => {
    const first = acceptSharedMotionPresetLibraryUpdate(null, manifest('v1'))
    expect(first).toMatchObject({ sourceVersion: 'v1', updateAvailable: false })

    expect(checkSharedMotionPresetLibraryUpdate(first, manifest('v1'))).toEqual({
      libraryId: 'brand-motion',
      status: 'up-to-date',
      acceptedVersion: 'v1',
      sourceVersion: 'v1',
      updateAvailable: false
    })

    const check = checkSharedMotionPresetLibraryUpdate(first, manifest('v2'))
    expect(check).toMatchObject({ status: 'update-available', sourceVersion: 'v2' })
    expect(first.manifest.sourceVersion).toBe('v1')

    const noted = noteSharedMotionPresetLibraryUpdate(first, manifest('v2'))
    expect(noted).toMatchObject({ sourceVersion: 'v2', updateAvailable: true })
    expect(noted.manifest.sourceVersion).toBe('v1')

    const accepted = acceptSharedMotionPresetLibraryUpdate(noted, manifest('v2'))
    expect(accepted).toMatchObject({ sourceVersion: 'v2', updateAvailable: false })
    expect(accepted.manifest.presets[0].revision).toBe(2)
    expect(first.manifest.presets[0].revision).toBe(1)
    expect(parseSharedMotionPresetLibraryState(accepted)).toEqual(accepted)
  })

  test('instantiates a complete snapshot with shared provenance and no shared references', () => {
    const accepted = acceptSharedMotionPresetLibraryUpdate(null, manifest('release-12'))
    const instance = instantiateSharedMotionPreset(accepted, 'user-soft-enter')

    expect(instance).toMatchObject({
      version: 1,
      tracks: [{ id: 'fade', timing: { durationMs: 420 } }],
      preset: {
        id: 'user-soft-enter',
        version: 2,
        parameters: {
          publisherId: 'openpencil-team',
          libraryId: 'brand-motion',
          sourceVersion: 'release-12'
        }
      }
    })
    instance.tracks[0].keyframes[0].opacity = 0.8
    expect(accepted.manifest.presets[0].motion.tracks[0].keyframes[0].opacity).toBe(0)
  })

  test('fails closed on identity changes and content changes without a version bump', () => {
    const accepted = acceptSharedMotionPresetLibraryUpdate(null, manifest('v1'))
    const changed = manifest('v1')
    changed.presets[0].motion.tracks[0].timing.durationMs = 999
    expect(() => checkSharedMotionPresetLibraryUpdate(accepted, changed)).toThrow(
      /without a source version change/
    )

    for (const source of [
      { ...manifest('v2'), publisher: { id: 'other-team', name: 'Other' } },
      { ...manifest('v2'), library: { id: 'other-library', name: 'Other' } },
      {
        ...manifest('v2'),
        source: { kind: 'url' as const, ref: 'https://evil.example/presets.json' }
      }
    ]) {
      expect(() => acceptSharedMotionPresetLibraryUpdate(accepted, source)).toThrow(
        SharedMotionPresetValidationError
      )
    }
  })

  test('rejects unsafe, unbounded, future, and malformed values', () => {
    const customPrototype = Object.assign(Object.create({ polluted: true }), manifest())
    const invalidValues: unknown[] = [
      { ...manifest(), unexpected: true },
      { ...manifest(), schemaVersion: 2 },
      { ...manifest(), library: { id: '../unsafe', name: 'Unsafe' } },
      { ...manifest(), sourceVersion: 'version with spaces' },
      {
        ...manifest(),
        source: { kind: 'url', ref: 'https://user:secret@example.com/presets.json' }
      },
      { ...manifest(), source: { kind: 'file', ref: `bad\u0000path` } },
      { ...manifest(), readonly: 'yes' },
      { ...manifest(), readonly: false },
      customPrototype
    ]

    for (const value of invalidValues) {
      expect(validateSharedMotionPresetManifest(value).success).toBe(false)
      expect(() => parseSharedMotionPresetManifest(value)).toThrow(
        SharedMotionPresetValidationError
      )
    }
    expect(() => parseSharedMotionPresetManifestJson('{not json')).toThrow(
      SharedMotionPresetValidationError
    )
    expect(() => instantiateSharedMotionPreset(manifest(), 'user-missing')).toThrow(
      /Unknown shared motion preset/
    )
  })
})
