import { describe, expect, test } from 'bun:test'

import {
  MOTION_LIMITS,
  MOTION_PRESET_IDS,
  MOTION_PRESET_REGISTRY,
  MotionValidationError,
  SceneGraph,
  cloneMotionSpec,
  cloneNodeProps,
  createMotionPreset,
  expandMotionPreset,
  getMotionChannels,
  isMotionPresetId,
  isMotionSpec,
  parseMotionSpec,
  validateMotionSpec,
  type MotionPresetId,
  type MotionSpec,
  type MotionTrack
} from '@open-pencil/scene-graph'

function validTrack(id = 'track-1'): MotionTrack {
  return {
    id,
    trigger: 'mount',
    keyframes: [
      { offset: 0, opacity: 0, x: 0, y: 20, scaleX: 0.9, scaleY: 0.9, rotate: 0 },
      { offset: 1, opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 }
    ],
    timing: { durationMs: 300, delayMs: 0, easing: 'ease-out', iterations: 1 },
    exit: 'none'
  }
}

function validSpec(): MotionSpec {
  return { version: 1, tracks: [validTrack()], reducedMotion: 'reduce' }
}

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('MotionSpec v1 validation', () => {
  test('reports only the visual channels written by keyframes', () => {
    expect(
      getMotionChannels([
        { offset: 0, opacity: 0, y: 12 },
        { offset: 1, scaleX: 1 }
      ])
    ).toEqual({
      opacity: true,
      translate: true,
      scale: true,
      rotate: false
    })
  })

  test('strict parser returns a fresh typed copy', () => {
    const input = validSpec()
    const parsed = parseMotionSpec(input)

    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(parsed.tracks).not.toBe(input.tracks)
    expect(parsed.tracks[0].keyframes).not.toBe(input.tracks[0].keyframes)
    expect(parsed.tracks[0].timing).not.toBe(input.tracks[0].timing)
    expect(validateMotionSpec(input)).toEqual({ success: true, value: parsed })
    expect(isMotionSpec(input)).toBe(true)
  })

  test('accepts every documented numeric boundary', () => {
    const spec: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'boundary-track',
          trigger: 'loop',
          keyframes: [
            {
              offset: 0,
              opacity: MOTION_LIMITS.opacity.min,
              x: MOTION_LIMITS.translate.min,
              y: MOTION_LIMITS.translate.max,
              scaleX: MOTION_LIMITS.scale.min,
              scaleY: MOTION_LIMITS.scale.max,
              rotate: MOTION_LIMITS.rotate.min,
              easing: { type: 'cubicBezier', x1: 0, y1: -100, x2: 1, y2: 100 }
            },
            {
              offset: 1,
              opacity: MOTION_LIMITS.opacity.max,
              x: MOTION_LIMITS.translate.max,
              y: MOTION_LIMITS.translate.min,
              scaleX: MOTION_LIMITS.scale.max,
              scaleY: MOTION_LIMITS.scale.min,
              rotate: MOTION_LIMITS.rotate.max
            }
          ],
          timing: {
            durationMs: MOTION_LIMITS.durationMs.max,
            delayMs: MOTION_LIMITS.delayMs.max,
            easing: 'linear',
            iterations: MOTION_LIMITS.iterations.max,
            direction: 'alternate-reverse',
            fill: 'both'
          },
          exit: 'reset'
        }
      ],
      reducedMotion: 'allow'
    }

    expect(isMotionSpec(spec)).toBe(true)
    expect(parseMotionSpec(spec)).toEqual(spec)
  })

  test('rejects unknown fields, code-like data, invalid enums, and non-finite values', () => {
    const invalidValues: unknown[] = [
      { ...validSpec(), script: 'alert(1)' },
      {
        version: 1,
        tracks: [
          {
            ...validTrack(),
            keyframes: [{ offset: 0, filter: 'blur(4px)' }, { offset: 1 }]
          }
        ]
      },
      {
        version: 1,
        tracks: [{ ...validTrack(), trigger: ['javascript', 'alert(1)'].join(':') }]
      },
      { version: 1, tracks: [{ ...validTrack(), id: 'constructor' }] },
      { version: 1, tracks: [{ ...validTrack(), id: `a${'x'.repeat(64)}` }] },
      {
        version: 1,
        tracks: [
          {
            ...validTrack(),
            keyframes: [{ offset: 0 }, { offset: Number.NaN }, { offset: 1 }]
          }
        ]
      },
      {
        version: 1,
        tracks: [{ ...validTrack(), timing: { durationMs: Number.POSITIVE_INFINITY } }]
      },
      {
        version: 1,
        tracks: [
          {
            ...validTrack(),
            timing: {
              durationMs: 300,
              easing: { type: 'cubicBezier', x1: -0.01, y1: 0, x2: 1, y2: 0 }
            }
          }
        ]
      },
      {
        version: 1,
        tracks: [
          {
            ...validTrack(),
            timing: {
              durationMs: 300,
              easing: { type: 'cubicBezier', x1: 0, y1: -101, x2: 1, y2: 0 }
            }
          }
        ]
      },
      {
        version: 1,
        tracks: [validTrack()],
        preset: { id: 'fade-in', version: 1, parameters: { payload: 'alert(1)' } }
      }
    ]

    for (const value of invalidValues) {
      expect(validateMotionSpec(value).success).toBe(false)
      expect(isMotionSpec(value)).toBe(false)
      expect(() => parseMotionSpec(value)).toThrow(MotionValidationError)
    }
  })

  test('rejects values outside MotionSpec limits', () => {
    const invalidValues: unknown[] = [
      { version: 1, tracks: [{ ...validTrack(), timing: { durationMs: 0 } }] },
      { version: 1, tracks: [{ ...validTrack(), timing: { durationMs: 1, delayMs: 60_001 } }] },
      { version: 1, tracks: [{ ...validTrack(), timing: { durationMs: 1, iterations: 1_001 } }] },
      {
        version: 1,
        tracks: [
          {
            ...validTrack(),
            keyframes: [
              { offset: 0, x: -100_001 },
              { offset: 1, x: 0 }
            ]
          }
        ]
      },
      {
        version: 1,
        tracks: [{ ...validTrack(), keyframes: [{ offset: 0, scaleX: -0.01 }, { offset: 1 }] }]
      },
      {
        version: 1,
        tracks: [{ ...validTrack(), keyframes: [{ offset: 0, rotate: 36_001 }, { offset: 1 }] }]
      },
      {
        version: 1,
        tracks: [{ ...validTrack(), keyframes: [{ offset: 0, opacity: 1.01 }, { offset: 1 }] }]
      }
    ]

    for (const value of invalidValues) expect(isMotionSpec(value)).toBe(false)
  })

  test('enforces track, keyframe, ordering, and uniqueness limits', () => {
    const tooManyTracks = {
      version: 1,
      tracks: Array.from({ length: 9 }, (_, index) => validTrack(`track-${index}`))
    }
    const tooManyKeyframes = {
      version: 1,
      tracks: Array.from({ length: 8 }, (_, trackIndex) => ({
        ...validTrack(`track-${trackIndex}`),
        keyframes: [0, 0.25, 0.5, 0.75, 1].map((offset) => ({ offset }))
      }))
    }
    const invalidValues: unknown[] = [
      tooManyTracks,
      tooManyKeyframes,
      { version: 1, tracks: [{ ...validTrack(), keyframes: [{ offset: 0 }] }] },
      {
        version: 1,
        tracks: [{ ...validTrack(), keyframes: [{ offset: 0 }, { offset: 0.8 }, { offset: 0.5 }] }]
      },
      {
        version: 1,
        tracks: [{ ...validTrack(), keyframes: [{ offset: 0.1 }, { offset: 1 }] }]
      },
      { version: 1, tracks: [validTrack('duplicate'), validTrack('duplicate')] }
    ]

    for (const value of invalidValues) expect(validateMotionSpec(value).success).toBe(false)
  })
})

describe('built-in motion presets', () => {
  test('exports and validates all eight deterministic presets', () => {
    expect([...MOTION_PRESET_IDS]).toEqual([
      'fade-in',
      'slide-up',
      'scale-in',
      'bounce-in',
      'hover-lift',
      'press',
      'pulse',
      'float'
    ])

    for (const id of MOTION_PRESET_IDS) {
      const first = createMotionPreset(id)
      const second = createMotionPreset(id)
      expect(isMotionPresetId(id)).toBe(true)
      expect(isMotionSpec(first)).toBe(true)
      expect(first).toEqual(second)
      expect(first).not.toBe(second)
      expect(first.tracks).not.toBe(second.tracks)
      expect(first.tracks[0].keyframes).not.toBe(second.tracks[0].keyframes)
      expect(first.preset).toEqual({
        id,
        version: MOTION_PRESET_REGISTRY[id].version,
        parameters: first.preset?.parameters
      })
      expect(expandMotionPreset(first.preset)).toEqual(first)
      expect(expandMotionPreset(first.preset)).not.toBe(first)
    }
  })

  test('clamps supported parameters and records normalized provenance', () => {
    const slide = createMotionPreset('slide-up', {
      durationMs: -100,
      delayMs: 999_999,
      distance: 999_999
    })
    expect(slide.preset?.parameters).toEqual({
      durationMs: MOTION_LIMITS.durationMs.min,
      delayMs: MOTION_LIMITS.delayMs.max,
      distance: MOTION_LIMITS.translate.max
    })
    expect(slide.tracks[0].timing.durationMs).toBe(MOTION_LIMITS.durationMs.min)
    expect(slide.tracks[0].timing.delayMs).toBe(MOTION_LIMITS.delayMs.max)
    expect(slide.tracks[0].keyframes[0].y).toBe(MOTION_LIMITS.translate.max)

    const press = createMotionPreset('press', { intensity: 999 })
    expect(press.preset?.parameters.intensity).toBe(10)
    expect(press.tracks[0].keyframes[1].scaleX).toBeCloseTo(0.6)
  })

  test('rejects unsupported, non-finite, code-like, and unknown preset input', () => {
    expect(() => createMotionPreset('fade-in', { intensity: 2 })).toThrow(MotionValidationError)
    expect(() => createMotionPreset('fade-in', { durationMs: Number.NaN })).toThrow(
      MotionValidationError
    )
    expect(() =>
      expandMotionPreset({
        id: 'fade-in',
        version: 1,
        parameters: { durationMs: 'alert(1)' }
      })
    ).toThrow(MotionValidationError)
    expect(() => createMotionPreset('javascript' as MotionPresetId)).toThrow(MotionValidationError)
    expect(isMotionPresetId('javascript')).toBe(false)
  })

  test('preset instances never share mutable state', () => {
    const first = createMotionPreset('bounce-in')
    const second = createMotionPreset('bounce-in')
    first.tracks[0].keyframes[0].scaleX = 99
    if (first.preset) first.preset.parameters.intensity = 9

    expect(second.tracks[0].keyframes[0].scaleX).not.toBe(99)
    expect(second.preset?.parameters.intensity).toBe(1)
    expect(Object.isFrozen(MOTION_PRESET_REGISTRY)).toBe(true)
    expect(Object.isFrozen(MOTION_PRESET_REGISTRY['bounce-in'])).toBe(true)
  })
})

describe('SceneNode motion cloning', () => {
  test('cloneMotionSpec remains strict-parser compatible when easing is absent', () => {
    const source: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'plain',
          trigger: 'mount',
          keyframes: [{ offset: 0 }, { offset: 1 }],
          timing: { durationMs: 100 }
        }
      ]
    }
    const clone = cloneMotionSpec(source)

    expect(parseMotionSpec(clone)).toEqual(source)
    expect(Object.hasOwn(clone.tracks[0].keyframes[0], 'easing')).toBe(false)
    expect(Object.hasOwn(clone.tracks[0].timing, 'easing')).toBe(false)
  })

  test('cloneTree deep-copies the full MotionSpec', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Animated node',
      motion: createMotionPreset('bounce-in')
    })
    const clone = graph.cloneTree(node.id, pageId(graph))
    if (!clone || !node.motion || !clone.motion) throw new Error('Expected motion on both nodes')

    expect(clone.motion).toEqual(node.motion)
    expect(clone.motion).not.toBe(node.motion)
    expect(clone.motion.tracks).not.toBe(node.motion.tracks)
    expect(clone.motion.tracks[0].keyframes).not.toBe(node.motion.tracks[0].keyframes)
    expect(clone.motion.tracks[0].timing).not.toBe(node.motion.tracks[0].timing)
    expect(clone.motion.preset?.parameters).not.toBe(node.motion.preset?.parameters)

    clone.motion.tracks[0].keyframes[0].scaleX = 77
    expect(node.motion.tracks[0].keyframes[0].scaleX).not.toBe(77)
  })

  test('fig-import clone mode deep-copies motion while resetting source metadata', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Imported animated node',
      motion: createMotionPreset('slide-up')
    })
    node.source.format = 'fig'
    node.source.id = '8:1'
    const clone = cloneNodeProps(node, node.id, 'fig-import')
    if (!node.motion || !clone.motion) throw new Error('Expected cloned motion')

    expect(clone.motion).toEqual(node.motion)
    expect(clone.motion).not.toBe(node.motion)
    expect(clone.motion.tracks[0].keyframes).not.toBe(node.motion.tracks[0].keyframes)
    expect(clone.source?.format).toBeNull()
    clone.motion.tracks[0].keyframes[0].y = 999
    expect(node.motion.tracks[0].keyframes[0].y).not.toBe(999)
  })

  test('component root motion is inherited and deep-copied by instances and sync', () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', pageId(graph), {
      name: 'Animated component',
      motion: createMotionPreset('slide-up')
    })
    const instance = graph.createInstance(component.id, pageId(graph))
    if (!component.motion || !instance?.motion) throw new Error('Expected inherited root motion')

    expect(instance.motion).toEqual(component.motion)
    expect(instance.motion).not.toBe(component.motion)
    expect(instance.motion.tracks).not.toBe(component.motion.tracks)
    expect(instance.motion.tracks[0].keyframes).not.toBe(component.motion.tracks[0].keyframes)
    expect(instance.motion.preset?.parameters).not.toBe(component.motion.preset?.parameters)

    graph.updateNode(component.id, { motion: createMotionPreset('bounce-in') })
    graph.syncInstances(component.id)
    const syncedMotion = graph.getNode(instance.id)?.motion
    const componentMotion = graph.getNode(component.id)?.motion
    if (!syncedMotion || !componentMotion) throw new Error('Expected synced root motion')

    expect(syncedMotion).toEqual(componentMotion)
    expect(syncedMotion).not.toBe(componentMotion)
    syncedMotion.tracks[0].keyframes[0].scaleX = 77
    expect(componentMotion.tracks[0].keyframes[0].scaleX).not.toBe(77)

    graph.clearNodeFields(component.id, ['motion'])
    graph.syncInstances(component.id)
    const clearedInstance = graph.getNode(instance.id)
    expect(clearedInstance?.motion).toBeUndefined()
    expect(Object.hasOwn(clearedInstance ?? {}, 'motion')).toBe(false)

    graph.updateNode(component.id, { motion: createMotionPreset('fade-in') })
    graph.syncInstances(component.id)
    const staticComponent = graph.createNode('COMPONENT', pageId(graph), {
      name: 'Static component'
    })
    graph.swapInstanceComponent(instance.id, staticComponent.id)
    const swappedInstance = graph.getNode(instance.id)
    expect(swappedInstance?.motion).toBeUndefined()
    expect(Object.hasOwn(swappedInstance ?? {}, 'motion')).toBe(false)
  })

  test('nodes without motion retain the existing absent-field behavior', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), { name: 'Static node' })
    const clone = graph.cloneTree(node.id, pageId(graph))
    if (!clone) throw new Error('Expected cloned static node')

    expect(node.motion).toBeUndefined()
    expect(Object.hasOwn(node, 'motion')).toBe(false)
    expect(clone.motion).toBeUndefined()
    expect(Object.hasOwn(clone, 'motion')).toBe(false)
  })
})
