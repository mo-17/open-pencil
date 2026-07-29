import { describe, expect, test } from 'bun:test'

import {
  cloneMotionRecipe,
  instantiateMotionRecipe,
  isMotionRecipe,
  MOTION_RECIPE_FORMAT,
  MotionRecipeValidationError,
  parseMotionRecipe,
  validateMotionRecipe,
  type MotionRecipe
} from '@open-pencil/scene-graph'

function recipe(): MotionRecipe {
  return {
    format: MOTION_RECIPE_FORMAT,
    version: 1,
    id: 'cardEntrance',
    name: '卡片入场',
    description: '英雄内容与列表项的参数化入场配方',
    parameters: [
      { id: 'duration', defaultValue: 500, min: 200, max: 1_000 },
      { id: 'distance', defaultValue: -24, min: -100, max: 0 },
      { id: 'stagger', defaultValue: 80, min: 0, max: 500 }
    ],
    roles: [
      {
        id: 'hero',
        motion: {
          version: 1,
          tracks: [
            {
              id: 'heroFade',
              trigger: 'pageEnter',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 500 }
            }
          ],
          reducedMotion: 'reduce'
        },
        bindings: [
          {
            parameterId: 'duration',
            target: { kind: 'timing', trackId: 'heroFade', field: 'durationMs' }
          }
        ]
      },
      {
        id: 'item',
        motion: {
          version: 1,
          tracks: [
            {
              id: 'itemSlide',
              trigger: 'pageEnter',
              keyframes: [
                { offset: 0, opacity: 0, y: -24 },
                { offset: 1, opacity: 1, y: 0 }
              ],
              timing: { durationMs: 500, delayMs: 10 }
            }
          ]
        },
        bindings: [
          {
            parameterId: 'duration',
            target: { kind: 'timing', trackId: 'itemSlide', field: 'durationMs' }
          },
          {
            parameterId: 'distance',
            target: {
              kind: 'keyframe',
              trackId: 'itemSlide',
              keyframeIndex: 0,
              field: 'y'
            }
          }
        ],
        stagger: {
          stepMs: { parameterId: 'stagger' },
          direction: 'forward',
          rhythm: 'linear'
        }
      }
    ]
  }
}

describe('Motion Recipe v1', () => {
  test('strictly parses a portable recipe that embeds complete node-local MotionSpec snapshots', () => {
    const source = recipe()
    expect(parseMotionRecipe(source)).toEqual(source)
    expect(validateMotionRecipe(source)).toEqual({ success: true, value: source })
    expect(isMotionRecipe(source)).toBe(true)
  })

  test('deep clones motions, bindings, and stagger parameter references', () => {
    const source = recipe()
    const copy = cloneMotionRecipe(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.roles).not.toBe(source.roles)
    expect(copy.roles[0]?.motion).not.toBe(source.roles[0]?.motion)
    expect(copy.roles[1]?.bindings?.[0]?.target).not.toBe(source.roles[1]?.bindings?.[0]?.target)
    expect(copy.roles[1]?.stagger).not.toBe(source.roles[1]?.stagger)
    expect(copy.roles[1]?.stagger?.stepMs).not.toBe(source.roles[1]?.stagger?.stepMs)
  })

  test('expands explicit role mappings, parameter overrides, and stagger deterministically', () => {
    const source = recipe()
    const input = {
      roleMapping: {
        item: ['0:20', '0:21', '0:22'],
        hero: ['0:10']
      },
      parameters: { duration: 700, distance: -40, stagger: 100 }
    }
    const first = instantiateMotionRecipe(source, input)
    const second = instantiateMotionRecipe(source, input)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      recipeId: 'cardEntrance',
      recipeVersion: 1,
      parameters: { duration: 700, distance: -40, stagger: 100 }
    })
    expect(first.assignments.map(({ roleId, nodeId }) => [roleId, nodeId])).toEqual([
      ['hero', '0:10'],
      ['item', '0:20'],
      ['item', '0:21'],
      ['item', '0:22']
    ])
    expect(first.assignments.map(({ motion }) => motion.tracks[0]?.timing.durationMs)).toEqual([
      700, 700, 700, 700
    ])
    expect(
      first.assignments.slice(1).map(({ motion }) => motion.tracks[0]?.timing.delayMs)
    ).toEqual([10, 110, 210])
    expect(
      first.assignments.slice(1).map(({ motion }) => motion.tracks[0]?.keyframes[0]?.y)
    ).toEqual([-40, -40, -40])
    expect(first.assignments[1]?.motion).not.toBe(first.assignments[2]?.motion)
    const mutableTrack = first.assignments[1]?.motion.tracks[0]
    if (!mutableTrack) throw new Error('Expected instantiated item track')
    mutableTrack.timing.durationMs = 999
    expect(first.assignments[2]?.motion.tracks[0]?.timing.durationMs).toBe(700)
    expect(source.roles[1]?.motion.tracks[0]?.timing.durationMs).toBe(500)
  })

  test('uses canonical defaults without requiring parameter overrides', () => {
    const result = instantiateMotionRecipe(recipe(), {
      roleMapping: { hero: ['0:10'], item: ['0:20', '0:21'] }
    })
    expect(result.parameters).toEqual({ duration: 500, distance: -24, stagger: 80 })
    expect(
      result.assignments.slice(1).map(({ motion }) => motion.tracks[0]?.timing.delayMs)
    ).toEqual([10, 90])
  })

  test('fails closed on future formats, unknown fields, unsafe ids, and malformed nested motion', () => {
    const source = recipe()
    const role = source.roles[0]
    if (!role) throw new Error('Expected recipe role')
    const cyclic = { ...source, cycle: null as unknown }
    cyclic.cycle = cyclic
    const customPrototype = Object.assign(Object.create({ inherited: true }), source)
    const invalid: unknown[] = [
      { ...source, version: 2 },
      { ...source, format: 'other-recipe' },
      { ...source, script: 'alert(1)' },
      { ...source, id: '__proto__' },
      cyclic,
      customPrototype,
      { ...source, roles: [role, { ...role }] },
      {
        ...source,
        roles: [{ ...role, motion: { ...role.motion, version: 99 } }, source.roles[1]]
      },
      {
        ...source,
        roles: [
          {
            ...role,
            motion: {
              ...role.motion,
              preset: { id: 'fade-in', version: 1, parameters: {} }
            }
          },
          source.roles[1]
        ]
      }
    ]
    for (const candidate of invalid) {
      expect(validateMotionRecipe(candidate).success).toBe(false)
      expect(() => parseMotionRecipe(candidate)).toThrow(MotionRecipeValidationError)
    }
  })

  test('rejects ambiguous, dangling, out-of-range, and unused parameter bindings', () => {
    const source = recipe()
    const item = source.roles[1]
    if (!item?.bindings) throw new Error('Expected item bindings')
    const duplicateBinding = { ...item.bindings[0] }
    const invalid: unknown[] = [
      {
        ...source,
        parameters: [...source.parameters, { id: 'unused', defaultValue: 1, min: 0, max: 2 }]
      },
      {
        ...source,
        parameters: source.parameters.map((parameter) =>
          parameter.id === 'duration' ? { ...parameter, min: 0 } : parameter
        )
      },
      {
        ...source,
        parameters: source.parameters.map((parameter) =>
          parameter.id === 'stagger' ? { ...parameter, max: 60_001 } : parameter
        )
      },
      {
        ...source,
        roles: [
          source.roles[0],
          {
            ...item,
            bindings: [...item.bindings, duplicateBinding]
          }
        ]
      },
      {
        ...source,
        roles: [
          source.roles[0],
          {
            ...item,
            bindings: [
              ...item.bindings,
              {
                parameterId: 'distance',
                target: {
                  kind: 'keyframe',
                  trackId: 'missing',
                  keyframeIndex: 0,
                  field: 'y'
                }
              }
            ]
          }
        ]
      },
      {
        ...source,
        roles: [
          source.roles[0],
          {
            ...item,
            stagger: { stepMs: { parameterId: 'missing' } }
          }
        ]
      }
    ]
    for (const candidate of invalid) expect(validateMotionRecipe(candidate).success).toBe(false)
  })

  test('requires complete, one-to-one explicit role mappings and bounded overrides', () => {
    const source = recipe()
    const invalidInputs = [
      { roleMapping: { hero: ['0:10'] } },
      { roleMapping: { hero: ['0:10'], item: ['0:20'], extra: ['0:30'] } },
      { roleMapping: { hero: ['0:10'], item: [] } },
      { roleMapping: { hero: ['0:10'], item: ['0:10'] } },
      {
        roleMapping: { hero: ['0:10'], item: ['0:20'] },
        parameters: { duration: 100 }
      },
      {
        roleMapping: { hero: ['0:10'], item: ['0:20'] },
        parameters: { unknown: 1 }
      }
    ]
    for (const input of invalidInputs) {
      expect(() => instantiateMotionRecipe(source, input as never)).toThrow(
        MotionRecipeValidationError
      )
    }
  })

  test('enforces recipe and expansion resource limits before producing assignments', () => {
    const source = recipe()
    expect(
      validateMotionRecipe({
        ...source,
        parameters: Array.from({ length: 17 }, (_, index) => ({
          id: `parameter${index}`,
          defaultValue: 0,
          min: 0,
          max: 1
        }))
      }).success
    ).toBe(false)
    expect(
      validateMotionRecipe({
        ...source,
        roles: Array.from({ length: 33 }, (_, index) => ({
          id: `role${index}`,
          motion: source.roles[0]?.motion
        }))
      }).success
    ).toBe(false)

    expect(() =>
      instantiateMotionRecipe(source, {
        roleMapping: {
          hero: ['0:10'],
          item: Array.from({ length: 512 }, (_, index) => `item:${index}`)
        }
      })
    ).toThrow(MotionRecipeValidationError)
  })
})
