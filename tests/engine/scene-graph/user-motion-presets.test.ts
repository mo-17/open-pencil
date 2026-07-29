import { describe, expect, test } from 'bun:test'

import {
  USER_MOTION_PRESET_FORMAT,
  USER_MOTION_PRESET_LIMITS,
  USER_MOTION_PRESET_SCHEMA_VERSION,
  UserMotionPresetValidationError,
  createUserMotionPreset,
  createUserMotionPresetLibrary,
  instantiateUserMotionPreset,
  mergeUserMotionPresetLibraries,
  parseUserMotionPresetLibrary,
  parseUserMotionPresetLibraryJson,
  removeUserMotionPreset,
  renameUserMotionPreset,
  serializeUserMotionPresetLibrary,
  updateUserMotionPreset,
  validateUserMotionPresetLibrary,
  type MotionSpec,
  type UserMotionPreset
} from '@open-pencil/scene-graph'

function portableMotion(delayMs = 0): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: 'fade',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 300, delayMs, easing: 'ease-out' },
        exit: 'none'
      }
    ],
    reducedMotion: 'reduce'
  }
}

function userPreset(id = 'user-fade', name = '柔和淡入', revision = 1): UserMotionPreset {
  return {
    id,
    revision,
    name,
    description: '用于页面进入',
    category: 'entrance',
    motion: portableMotion()
  }
}

function rawLibrary(presets: unknown[], schemaVersion = 1): unknown {
  return { format: USER_MOTION_PRESET_FORMAT, schemaVersion, presets }
}

describe('portable user motion presets', () => {
  test('creates a canonical v1 library and deep-copies every nested motion value', () => {
    const source = userPreset()
    const library = createUserMotionPresetLibrary([source])

    expect(library).toEqual({
      format: USER_MOTION_PRESET_FORMAT,
      schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
      presets: [source]
    })
    expect(library.presets[0]).not.toBe(source)
    expect(library.presets[0].motion).not.toBe(source.motion)
    expect(library.presets[0].motion.tracks).not.toBe(source.motion.tracks)
    expect(library.presets[0].motion.tracks[0].keyframes).not.toBe(
      source.motion.tracks[0].keyframes
    )

    library.presets[0].motion.tracks[0].keyframes[0].opacity = 0.5
    expect(source.motion.tracks[0].keyframes[0].opacity).toBe(0)
  })

  test('normalizes Unicode text and serializes with deterministic keys and whitespace', () => {
    const parsed = parseUserMotionPresetLibrary(
      rawLibrary([
        {
          ...userPreset(),
          name: '  Cafe\u0301 动效  ',
          description: '  中文说明  '
        }
      ])
    )
    expect(parsed.presets[0].name).toBe('Café 动效')
    expect(parsed.presets[0].description).toBe('中文说明')

    const first = serializeUserMotionPresetLibrary(parsed)
    const second = serializeUserMotionPresetLibrary(parseUserMotionPresetLibraryJson(first))
    expect(second).toBe(first)
    expect(first.indexOf('"format"')).toBeLessThan(first.indexOf('"schemaVersion"'))
    expect(first.indexOf('"description"')).toBeLessThan(first.indexOf('"category"'))
    expect(first).toContain('"motion"')
  })

  test('migrates schema v0 spec entries to current motion snapshots', () => {
    const legacy = {
      format: USER_MOTION_PRESET_FORMAT,
      schemaVersion: 0,
      presets: [
        {
          id: 'user-legacy',
          revision: 7,
          name: '旧版弹入',
          description: '兼容测试',
          spec: portableMotion(20)
        }
      ]
    }
    const parsed = parseUserMotionPresetLibrary(legacy)

    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.presets[0]).toMatchObject({
      id: 'user-legacy',
      revision: 7,
      name: '旧版弹入',
      category: 'custom',
      motion: portableMotion(20)
    })
    expect(serializeUserMotionPresetLibrary(legacy)).not.toContain('"spec"')
  })

  test('supports create, update, rename, remove, and immutable revisions', () => {
    const empty = createUserMotionPresetLibrary()
    const created = createUserMotionPreset(empty, {
      id: 'user-card-enter',
      name: ' 卡片进入 ',
      description: ' 第一版 ',
      category: 'entrance',
      motion: portableMotion()
    })
    expect(created.presets[0]).toMatchObject({
      id: 'user-card-enter',
      revision: 1,
      name: '卡片进入',
      description: '第一版'
    })

    const updated = updateUserMotionPreset(created, 'user-card-enter', {
      description: null,
      category: 'custom',
      motion: portableMotion(80)
    })
    expect(updated.presets[0].revision).toBe(2)
    expect(updated.presets[0].description).toBeUndefined()
    expect(updated.presets[0].category).toBe('custom')
    expect(updated.presets[0].motion.tracks[0].timing.delayMs).toBe(80)
    expect(created.presets[0].revision).toBe(1)

    const renamed = renameUserMotionPreset(updated, 'user-card-enter', '卡片轻入')
    expect(renamed.presets[0].name).toBe('卡片轻入')
    expect(renamed.presets[0].revision).toBe(2)
    expect(updateUserMotionPreset(renamed, 'user-card-enter', {})).toEqual(renamed)
    expect(removeUserMotionPreset(renamed, 'user-card-enter').presets).toEqual([])
  })

  test('instantiates a complete snapshot with user provenance and no shared state', () => {
    const preset = userPreset('user-soft-enter', '柔和进入', 12)
    const instance = instantiateUserMotionPreset(preset)

    expect(instance).toEqual({
      ...preset.motion,
      preset: { id: 'user-soft-enter', version: 12, parameters: {} }
    })
    expect(instance).not.toBe(preset.motion)
    expect(instance.tracks[0].keyframes).not.toBe(preset.motion.tracks[0].keyframes)
    instance.tracks[0].keyframes[0].opacity = 0.8
    expect(preset.motion.tracks[0].keyframes[0].opacity).toBe(0)
  })

  test('merges with explicit error, skip, and replace policies', () => {
    const base = createUserMotionPresetLibrary([
      userPreset('user-a', 'Preset A'),
      userPreset('user-b', 'Preset B')
    ])
    const conflicts = createUserMotionPresetLibrary([
      userPreset('user-a', 'Replacement A', 4),
      userPreset('user-c', 'preset b', 3)
    ])

    expect(() => mergeUserMotionPresetLibraries(base, conflicts)).toThrow(
      UserMotionPresetValidationError
    )
    expect(mergeUserMotionPresetLibraries(base, conflicts, 'skip')).toEqual(base)

    const replaced = mergeUserMotionPresetLibraries(base, conflicts, 'replace')
    expect(replaced.presets.map(({ id, revision }) => ({ id, revision }))).toEqual([
      { id: 'user-a', revision: 4 },
      { id: 'user-c', revision: 3 }
    ])
    expect(base.presets.map((preset) => preset.id)).toEqual(['user-a', 'user-b'])
  })

  test('rejects unsafe ids, duplicate normalized names, unknown fields, and stored provenance', () => {
    const invalidValues: unknown[] = [
      rawLibrary([{ ...userPreset(), id: 'fade' }]),
      rawLibrary([{ ...userPreset(), id: 'user-a/b' }]),
      rawLibrary([userPreset('user-a', '同名'), userPreset('user-b', '  同名  ')]),
      rawLibrary([userPreset('user-a', 'Case Name'), userPreset('user-b', 'case name')]),
      { ...(rawLibrary([]) as object), unknown: true },
      rawLibrary([{ ...userPreset(), unknown: true }]),
      rawLibrary([
        {
          ...userPreset(),
          motion: {
            ...portableMotion(),
            preset: { id: 'fade-in', version: 1, parameters: {} }
          }
        }
      ])
    ]

    for (const value of invalidValues) {
      expect(validateUserMotionPresetLibrary(value).success).toBe(false)
      expect(() => parseUserMotionPresetLibrary(value)).toThrow(UserMotionPresetValidationError)
    }
  })

  test('rejects custom prototypes and prototype-pollution fields', () => {
    const customPrototype = Object.assign(Object.create({ polluted: true }), {
      format: USER_MOTION_PRESET_FORMAT,
      schemaVersion: 1,
      presets: []
    })
    const pollutedJson = JSON.parse(
      '{"format":"openpencil-motion-presets","schemaVersion":1,"presets":[],"__proto__":{}}'
    )

    expect(() => parseUserMotionPresetLibrary(customPrototype)).toThrow(
      UserMotionPresetValidationError
    )
    expect(() => parseUserMotionPresetLibrary(pollutedJson)).toThrow(
      UserMotionPresetValidationError
    )
  })

  test('enforces revision, text, count, JSON byte, and future-schema limits', () => {
    const tooMany = Array.from({ length: USER_MOTION_PRESET_LIMITS.maxPresets + 1 }, (_, index) =>
      userPreset(`user-${index}`, `Preset ${index}`)
    )
    const invalidValues: unknown[] = [
      rawLibrary([{ ...userPreset(), revision: 0 }]),
      rawLibrary([{ ...userPreset(), revision: 1_001 }]),
      rawLibrary([{ ...userPreset(), name: ' ' }]),
      rawLibrary([{ ...userPreset(), name: '字'.repeat(65) }]),
      rawLibrary([{ ...userPreset(), description: '字'.repeat(257) }]),
      rawLibrary(tooMany),
      rawLibrary([], 2)
    ]
    for (const value of invalidValues) {
      expect(() => parseUserMotionPresetLibrary(value)).toThrow(UserMotionPresetValidationError)
    }

    const oversized = `${' '.repeat(USER_MOTION_PRESET_LIMITS.maxJsonBytes)}{}`
    expect(() => parseUserMotionPresetLibraryJson(oversized)).toThrow(
      UserMotionPresetValidationError
    )
  })

  test('rejects duplicate ids, missing presets, revision overflow, and invalid JSON', () => {
    expect(() =>
      parseUserMotionPresetLibrary(
        rawLibrary([userPreset('user-duplicate', 'One'), userPreset('user-duplicate', 'Two')])
      )
    ).toThrow(UserMotionPresetValidationError)
    expect(() => removeUserMotionPreset(createUserMotionPresetLibrary(), 'user-missing')).toThrow(
      UserMotionPresetValidationError
    )
    expect(() =>
      updateUserMotionPreset(
        createUserMotionPresetLibrary([userPreset('user-max', 'Max', 1_000)]),
        'user-max',
        { category: 'custom' }
      )
    ).toThrow(UserMotionPresetValidationError)
    expect(() => parseUserMotionPresetLibraryJson('{not json')).toThrow(
      UserMotionPresetValidationError
    )
  })

  test('does not share imported or merged snapshots with either source library', () => {
    const base = createUserMotionPresetLibrary([userPreset('user-base', 'Base')])
    const incoming = createUserMotionPresetLibrary([userPreset('user-new', 'New')])
    const merged = mergeUserMotionPresetLibraries(base, incoming)
    merged.presets[1].motion.tracks[0].keyframes[0].opacity = 0.4

    expect(incoming.presets[0].motion.tracks[0].keyframes[0].opacity).toBe(0)
    expect(base.presets[0].motion.tracks[0].keyframes[0].opacity).toBe(0)
  })
})
