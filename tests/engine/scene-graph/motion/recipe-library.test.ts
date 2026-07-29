import { describe, expect, test } from 'bun:test'

import {
  MOTION_RECIPE_FORMAT,
  MOTION_RECIPE_LIBRARY_FORMAT,
  MOTION_RECIPE_LIBRARY_LIMITS,
  MotionRecipeLibraryValidationError,
  createMotionRecipeLibrary,
  mergeMotionRecipeLibraries,
  parseMotionRecipeLibraryJson,
  serializeMotionRecipeLibrary,
  type MotionRecipe,
  type MotionSpec
} from '@open-pencil/scene-graph'

function motion(version: 1 | 2 | 3): MotionSpec {
  return {
    version,
    tracks: [
      {
        id: `fade-v${version}`,
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 300 },
        ...(version === 3 ? { composition: { mode: 'replace' as const } } : {})
      }
    ]
  }
}

function recipe(id: string, version: 1 | 2 | 3): MotionRecipe {
  return {
    format: MOTION_RECIPE_FORMAT,
    version: 1,
    id,
    name: `Recipe ${id}`,
    parameters: [],
    roles: [{ id: 'target', motion: motion(version) }]
  }
}

describe('personal Motion recipe library', () => {
  test('round-trips complete v1, v2, and v3 snapshots without shared references', () => {
    const source = createMotionRecipeLibrary([
      recipe('motionV1', 1),
      recipe('motionV2', 2),
      recipe('motionV3', 3)
    ])
    const restored = parseMotionRecipeLibraryJson(serializeMotionRecipeLibrary(source))

    expect(restored).toEqual(source)
    expect(restored.recipes[0]).not.toBe(source.recipes[0])
    expect(restored.recipes[0]?.roles[0]?.motion).not.toBe(source.recipes[0]?.roles[0]?.motion)
    const mutableTrack = restored.recipes[0]?.roles[0]?.motion.tracks[0]
    if (!mutableTrack) throw new Error('Expected a restored Motion recipe track')
    mutableTrack.timing.durationMs = 999
    expect(source.recipes[0]?.roles[0]?.motion.tracks[0]?.timing.durationMs).toBe(300)
  })

  test('fails closed for future versions, unknown fields, duplicates, and oversized JSON', () => {
    const valid = createMotionRecipeLibrary([recipe('only', 1)])
    expect(() =>
      parseMotionRecipeLibraryJson(JSON.stringify({ ...valid, schemaVersion: 2 }))
    ).toThrow(/Unsupported/)
    expect(() =>
      parseMotionRecipeLibraryJson(JSON.stringify({ ...valid, unexpected: true }))
    ).toThrow(/Unknown/)
    expect(() =>
      parseMotionRecipeLibraryJson(
        JSON.stringify({
          format: MOTION_RECIPE_LIBRARY_FORMAT,
          schemaVersion: 1,
          recipes: [recipe('same', 1), recipe('same', 1)]
        })
      )
    ).toThrow(/Duplicate/)
    expect(() =>
      parseMotionRecipeLibraryJson(' '.repeat(MOTION_RECIPE_LIBRARY_LIMITS.maxJsonBytes + 1))
    ).toThrow(MotionRecipeLibraryValidationError)
  })

  test('merges conflicts only under an explicit policy', () => {
    const current = createMotionRecipeLibrary([recipe('same', 1)])
    const incoming = createMotionRecipeLibrary([recipe('same', 3), recipe('newRecipe', 2)])

    expect(() => mergeMotionRecipeLibraries(current, incoming)).toThrow(/conflict/)
    expect(
      mergeMotionRecipeLibraries(current, incoming, 'skip').recipes.map(({ id }) => id)
    ).toEqual(['same', 'newRecipe'])
    expect(
      mergeMotionRecipeLibraries(current, incoming, 'replace').recipes[0]?.roles[0]?.motion.version
    ).toBe(3)
    expect(() =>
      Reflect.apply(mergeMotionRecipeLibraries, undefined, [current, incoming, 'append'])
    ).toThrow(/Unknown Motion recipe merge policy/)
  })
})
