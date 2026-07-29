import { describe, expect, test } from 'bun:test'

import {
  createFigmaNativeMotionApplyRequest,
  createFigmaNativeMotionPlan,
  diffFigmaNativeMotion,
  encodeFigmaMotionSharedClearEnvelope,
  encodeFigmaMotionSharedEnvelope,
  importFigmaNativeMotion,
  inspectFigmaNativeMotion,
  type FigmaNativeMotionPlan,
  type FigmaNativeMotionSnapshot
} from '@open-pencil/fig'
import type { MotionSpec, MotionTrack } from '@open-pencil/scene-graph'

function motion(
  trackOverrides: Partial<MotionTrack> = {},
  specOverrides: Partial<MotionSpec> = {}
): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: 'entrance',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0, x: -12 },
          { offset: 1, opacity: 1, x: 0 }
        ],
        timing: { durationMs: 400 },
        ...trackOverrides
      }
    ],
    ...specOverrides
  }
}

function snapshotFromPlan(
  plan: FigmaNativeMotionPlan,
  overrides: Partial<FigmaNativeMotionSnapshot> & {
    timelineDuration?: number
    owned?: boolean
  } = {}
): FigmaNativeMotionSnapshot {
  if (!plan.supported || plan.durationSeconds === undefined) throw new Error('unsupported fixture')
  const { timelineDuration, owned = false, ...snapshotOverrides } = overrides
  const manualKeyframeTracks = Object.fromEntries(
    plan.operations.map((operation) => [
      operation.field.name,
      {
        id: 'binding:' + operation.field.name,
        baseValue: structuredClone(operation.track.baseValue),
        keyframes: operation.track.keyframes.map((keyframe, index) => ({
          id: operation.field.name + ':' + String(index),
          timelinePosition: keyframe.timelinePosition,
          value: structuredClone(keyframe.value),
          easing: structuredClone(keyframe.easing ?? { type: 'LINEAR' as const })
        }))
      }
    ])
  )
  const ownershipRaw = owned
    ? JSON.stringify(createFigmaNativeMotionApplyRequest(plan).ownership)
    : ''
  return {
    animationStyles: [],
    manualKeyframeTracks,
    timelines: [
      {
        id: 'timeline:1',
        duration: timelineDuration ?? plan.durationSeconds
      }
    ],
    ownershipRaw,
    sharedMotionRaw: '',
    ...snapshotOverrides
  }
}

describe('@open-pencil/fig native Motion inspect/import/diff', () => {
  test('losslessly restores the authoritative shared mirror and verifies owned native state', () => {
    const original = motion(
      {
        keyframes: [
          { offset: 0, opacity: 0, x: -12, easing: 'ease-out' },
          { offset: 1, opacity: 1, x: 0 }
        ]
      },
      {
        reducedMotion: 'disable',
        preset: {
          id: 'travelEntrance',
          version: 3,
          parameters: { distance: 12, gentle: true }
        }
      }
    )
    const plan = createFigmaNativeMotionPlan(original, { nodeOpacity: 0.4 })
    const snapshot = snapshotFromPlan(plan, {
      owned: true,
      sharedMotionRaw: encodeFigmaMotionSharedEnvelope(original)
    })

    const imported = importFigmaNativeMotion(snapshot)

    expect(imported).toMatchObject({
      supported: true,
      source: 'shared-mirror',
      sharedMirror: 'motion',
      ownership: 'valid',
      nodeOpacity: 0.4
    })
    expect(imported.motion).toEqual(original)
    expect(imported.diagnostics).toEqual([])
  })

  test('imports foreign native FLOAT tracks with explicit canonical defaults and loss diagnostics', () => {
    const plan = createFigmaNativeMotionPlan(motion(), { nodeOpacity: 0.4 })
    const imported = importFigmaNativeMotion(snapshotFromPlan(plan))

    expect(imported).toMatchObject({
      supported: true,
      source: 'foreign-native',
      sharedMirror: 'none',
      ownership: 'none',
      nodeOpacity: 0.4
    })
    expect(imported.motion).toEqual({
      version: 1,
      tracks: [
        {
          id: 'figmaNative',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0, x: -12 },
            { offset: 1, opacity: 1, x: 0 }
          ],
          timing: {
            durationMs: 400,
            delayMs: 0,
            easing: 'ease',
            iterations: 1,
            direction: 'normal',
            fill: 'both'
          },
          exit: 'none'
        }
      ],
      reducedMotion: 'reduce'
    })
    expect(imported.diagnostics.map((entry) => entry.code)).toEqual([
      'defaulted-semantics',
      'foreign-native'
    ])
  })

  test('keeps export-import-export-import canonical parity', () => {
    const firstPlan = createFigmaNativeMotionPlan(
      motion({
        keyframes: [
          { offset: 0, opacity: 0.25, x: 0, easing: 'linear' },
          { offset: 0.5, opacity: 0.5, x: 10, easing: 'ease-in' },
          { offset: 1, opacity: 1, x: 20 }
        ],
        timing: { durationMs: 750 }
      }),
      { nodeOpacity: 0.8 }
    )
    const firstImport = importFigmaNativeMotion(snapshotFromPlan(firstPlan))
    if (!firstImport.motion || firstImport.nodeOpacity === null) {
      throw new Error('expected imported Motion fixture')
    }

    const secondPlan = createFigmaNativeMotionPlan(firstImport.motion, {
      nodeOpacity: firstImport.nodeOpacity
    })
    const secondImport = importFigmaNativeMotion(snapshotFromPlan(secondPlan))

    expect(secondImport.motion).toEqual(firstImport.motion)
    expect(secondImport.operations).toEqual(firstImport.operations)
  })

  test('imports exact owned readback without a shared mirror using explicit defaults', () => {
    const plan = createFigmaNativeMotionPlan(motion())
    const imported = importFigmaNativeMotion(snapshotFromPlan(plan, { owned: true }))

    expect(imported.supported).toBe(true)
    expect(imported.source).toBe('owned-native')
    expect(imported.ownership).toBe('valid')
    expect(imported.motion?.tracks[0]?.trigger).toBe('mount')
    expect(imported.diagnostics.map((entry) => entry.code)).toEqual(['defaulted-semantics'])
  })

  test('reports add, update, remove, timeline growth, and ownership changes', () => {
    const current = createFigmaNativeMotionPlan(
      motion({
        keyframes: [
          { offset: 0, x: 0, rotate: 0 },
          { offset: 1, x: 10, rotate: 20 }
        ]
      })
    )
    const desired = createFigmaNativeMotionPlan(
      motion({
        keyframes: [
          { offset: 0, opacity: 0, x: -20 },
          { offset: 1, opacity: 1, x: 0 }
        ],
        timing: { durationMs: 800 }
      })
    )

    const diff = diffFigmaNativeMotion(snapshotFromPlan(current, { owned: true }), desired)

    expect(diff).toMatchObject({
      compareOnly: true,
      supported: true,
      addFields: ['OPACITY'],
      updateFields: ['TRANSLATION_X'],
      removeFields: ['ROTATION'],
      timelineGrowth: {
        change: 'grow',
        currentDurationSeconds: 0.4,
        targetDurationSeconds: 0.8,
        deltaSeconds: 0.4
      },
      ownershipChange: 'update'
    })
  })

  test('reports an unchanged owned native plan without mutations', () => {
    const plan = createFigmaNativeMotionPlan(motion())
    const snapshot = snapshotFromPlan(plan, { owned: true })

    expect(diffFigmaNativeMotion(snapshot, plan)).toMatchObject({
      compareOnly: true,
      supported: true,
      addFields: [],
      updateFields: [],
      removeFields: [],
      timelineGrowth: {
        change: 'none',
        currentDurationSeconds: 0.4,
        targetDurationSeconds: 0.4,
        deltaSeconds: 0
      },
      ownershipChange: 'none',
      diagnostics: []
    })
  })

  test('honors an explicit shared clear instead of reviving stale native tracks', () => {
    const plan = createFigmaNativeMotionPlan(motion())
    const imported = importFigmaNativeMotion(
      snapshotFromPlan(plan, {
        owned: true,
        sharedMotionRaw: encodeFigmaMotionSharedClearEnvelope()
      })
    )

    expect(imported.supported).toBe(true)
    expect(imported.source).toBe('none')
    expect(imported.sharedMirror).toBe('cleared')
    expect(imported.motion).toBeNull()
    expect(imported.diagnostics.map((entry) => entry.code)).toContain('native-state-ignored')
  })

  test.each([
    [
      'unknown property',
      {
        manualKeyframeTracks: {
          FUTURE_PROPERTY: {
            id: 'binding:future',
            baseValue: { type: 'FLOAT', value: 0 },
            keyframes: []
          }
        }
      },
      'unknown-property'
    ],
    [
      'indexed track',
      {
        manualKeyframeTracks: {
          fills: {
            0: {
              id: 'binding:fill',
              baseValue: { type: 'FLOAT', value: 0 },
              keyframes: []
            }
          }
        }
      },
      'indexed-track'
    ],
    [
      'ambiguous timelines',
      {
        timelines: [
          { id: 'timeline:1', duration: 0.4 },
          { id: 'timeline:2', duration: 0.4 }
        ]
      },
      'ambiguous-timeline'
    ],
    [
      'animation style',
      {
        animationStyles: [{ id: 'style:1', styleId: 'fade', name: 'Fade' }]
      },
      'animation-styles'
    ]
  ] as const)('fails closed for %s native state', (_label, override, code) => {
    const snapshot: FigmaNativeMotionSnapshot = {
      animationStyles: [],
      manualKeyframeTracks: {},
      timelines: [],
      ownershipRaw: '',
      sharedMotionRaw: '',
      ...override
    }

    const inspected = inspectFigmaNativeMotion(snapshot)
    const diff = diffFigmaNativeMotion(snapshot, null)

    expect(inspected.supported).toBe(false)
    expect(inspected.diagnostics.map((entry) => entry.code)).toContain(code)
    expect(diff.supported).toBe(false)
    expect(diff.addFields).toEqual([])
    expect(diff.updateFields).toEqual([])
    expect(diff.removeFields).toEqual([])
  })

  test('fails closed for malformed ownership and shared metadata', () => {
    const plan = createFigmaNativeMotionPlan(motion())
    const invalidOwnership = importFigmaNativeMotion(
      snapshotFromPlan(plan, { ownershipRaw: '{"version":1}' })
    )
    const invalidMirror = importFigmaNativeMotion(
      snapshotFromPlan(plan, { sharedMotionRaw: '{"schema":"openpencil.motion","version":2}' })
    )

    expect(invalidOwnership.supported).toBe(false)
    expect(invalidOwnership.diagnostics.map((entry) => entry.code)).toContain('invalid-ownership')
    expect(invalidMirror.supported).toBe(false)
    expect(invalidMirror.diagnostics.map((entry) => entry.code)).toEqual(['invalid-shared-mirror'])
  })
})
