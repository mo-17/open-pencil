import { describe, expect, test } from 'bun:test'

import { allRules, createLinter, presets, type LintConfig } from '@open-pencil/core/lint'
import { SceneGraph, type MotionSpec, type MotionTrack } from '@open-pencil/scene-graph'

import { generatedEffect } from '#tests/helpers/generated-effect'

const MOTION_RULE_IDS = [
  'motion-reduced-motion',
  'motion-target-capability',
  'motion-loop-safety',
  'motion-flashing',
  'motion-transform-bounds',
  'motion-long-timing',
  'motion-complexity-budget'
] as const

function track(overrides: Partial<MotionTrack> = {}): MotionTrack {
  const timing = { durationMs: 400, ...overrides.timing }
  return {
    id: 'entrance',
    trigger: 'mount',
    keyframes: [
      { offset: 0, opacity: 0, y: 24 },
      { offset: 1, opacity: 1, y: 0 }
    ],
    ...overrides,
    timing
  }
}

function lintMotion(
  motion: MotionSpec,
  rules: readonly string[] = MOTION_RULE_IDS,
  config?: LintConfig
) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('RECTANGLE', page.id, {
    name: 'Animated card',
    width: 160,
    height: 96,
    motion
  })
  return createLinter({ preset: 'recommended', rules: [...rules], config }).lintGraph(graph, [
    node.id
  ])
}

function spec(tracks: MotionTrack[], reducedMotion?: MotionSpec['reducedMotion']): MotionSpec {
  return {
    version: 1,
    tracks,
    ...(reducedMotion === undefined ? {} : { reducedMotion })
  }
}

describe('Motion lint rules', () => {
  test('registers every rule in recommended, strict, and accessibility presets', () => {
    for (const id of MOTION_RULE_IDS) {
      expect(allRules[id]).toBeDefined()
      expect(presets.recommended.rules[id]).not.toBeUndefined()
      expect(presets.strict.rules[id]).not.toBeUndefined()
      expect(presets.accessibility.rules[id]).not.toBeUndefined()
    }
    expect(presets.recommended.rules['motion-flashing']).toBe('error')
    expect(presets.strict.rules['motion-flashing']).toBe('error')
    expect(presets.accessibility.rules['motion-reduced-motion']).toBe('error')
  })

  test('requires an effective reduced-motion policy', () => {
    const missing = lintMotion(spec([track()]), ['motion-reduced-motion'])
    const allowed = lintMotion(spec([track()], 'allow'), ['motion-reduced-motion'])
    const reduced = lintMotion(spec([track()], 'reduce'), ['motion-reduced-motion'])
    const disabled = lintMotion(spec([track()], 'disable'), ['motion-reduced-motion'])

    expect(missing.messages).toHaveLength(1)
    expect(missing.messages[0].message).toContain('has no policy')
    expect(allowed.messages).toHaveLength(1)
    expect(allowed.messages[0].message).toContain('explicitly allows')
    expect(reduced.messages).toHaveLength(0)
    expect(disabled.messages).toHaveLength(0)
  })

  test('requires resolved final geometry for Boolean Motion targets', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const motion = spec([track()], 'reduce')
    const unresolved = graph.createNode('BOOLEAN_OPERATION', page.id, {
      name: 'Unresolved Boolean',
      motion
    })
    const resolved = graph.createNode('BOOLEAN_OPERATION', page.id, {
      name: 'Resolved Boolean',
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }],
      motion
    })
    const linter = createLinter({
      preset: 'recommended',
      rules: ['motion-target-capability']
    })

    const unresolvedResult = linter.lintGraph(graph, [unresolved.id])
    expect(unresolvedResult.messages).toHaveLength(1)
    expect(unresolvedResult.messages[0]).toMatchObject({
      ruleId: 'motion-target-capability',
      nodeId: unresolved.id
    })
    expect(unresolvedResult.messages[0]?.message).toContain('no resolved final geometry')
    expect(linter.lintGraph(graph, [resolved.id]).messages).toEqual([])
  })

  test('aggregates loop triggers and infinite iterations into one finding', () => {
    const result = lintMotion(
      spec(
        [
          track({ id: 'ambient', trigger: 'loop' }),
          track({ id: 'spinner', timing: { durationMs: 800, iterations: 'infinite' } })
        ],
        'reduce'
      ),
      ['motion-loop-safety']
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].message).toContain('"ambient"')
    expect(result.messages[0].message).toContain('"spinner"')
  })

  test('detects rapid substantial opacity reversals without flagging a normal fade', () => {
    const flashing = lintMotion(
      spec(
        [
          track({
            id: 'flash',
            keyframes: [
              { offset: 0, opacity: 1 },
              { offset: 0.33, opacity: 0 },
              { offset: 0.66, opacity: 1 },
              { offset: 1, opacity: 0 }
            ],
            timing: { durationMs: 400 }
          })
        ],
        'disable'
      ),
      ['motion-flashing']
    )
    const fade = lintMotion(spec([track()], 'reduce'), ['motion-flashing'])

    expect(flashing.messages).toHaveLength(1)
    expect(flashing.messages[0]).toMatchObject({
      ruleId: 'motion-flashing',
      severity: 'error'
    })
    expect(flashing.messages[0].message).toContain('7.5 transitions/s')
    expect(fade.messages).toHaveLength(0)
  })

  test('detects rapid high-contrast generated noise in recommended and accessibility presets', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const riskyEffect = generatedEffect('noise')
    riskyEffect.opacity = 1
    riskyEffect.params.intensity = 0.8
    riskyEffect.uniforms.time.frequencyHz = 2
    riskyEffect.uniforms.time.scale = 2
    const risky = graph.createNode('RECTANGLE', page.id, {
      name: 'Generated noise',
      generatedEffect: riskyEffect
    })

    for (const preset of ['recommended', 'accessibility'] as const) {
      const result = createLinter({ preset, rules: ['motion-flashing'] }).lintGraph(graph, [
        risky.id
      ])
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toMatchObject({
        ruleId: 'motion-flashing',
        severity: 'error',
        nodeId: risky.id
      })
      expect(result.messages[0].message).toContain('4.0 transitions/s')
    }

    const boundedRate = generatedEffect('noise')
    boundedRate.opacity = 1
    boundedRate.params.intensity = 1
    boundedRate.uniforms.time.frequencyHz = 3
    const lowContrast = generatedEffect('noise')
    lowContrast.opacity = 0.4
    lowContrast.params.intensity = 1
    lowContrast.uniforms.time.frequencyHz = 12
    graph.updateNode(risky.id, { generatedEffect: boundedRate })
    expect(
      createLinter({ preset: 'accessibility', rules: ['motion-flashing'] }).lintGraph(graph, [
        risky.id
      ]).messages
    ).toEqual([])
    graph.updateNode(risky.id, { generatedEffect: lowContrast })
    expect(
      createLinter({ preset: 'recommended', rules: ['motion-flashing'] }).lintGraph(graph, [
        risky.id
      ]).messages
    ).toEqual([])
  })

  test('reports displacement, rotation, and scale in one transform finding', () => {
    const result = lintMotion(
      spec(
        [
          track({
            id: 'dramatic',
            keyframes: [
              { offset: 0, x: -1_200, rotate: -540, scaleX: 4 },
              { offset: 1, x: 0, rotate: 0, scaleX: 1 }
            ]
          })
        ],
        'reduce'
      ),
      ['motion-transform-bounds']
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].message).toContain('1200px displacement')
    expect(result.messages[0].message).toContain('540deg rotation')
    expect(result.messages[0].message).toContain('4x scale')
  })

  test('includes motion paths and negative scale magnitude in transform bounds', () => {
    const result = lintMotion(
      {
        version: 2,
        reducedMotion: 'reduce',
        tracks: [
          track({
            id: 'path-scale',
            path: {
              points: [
                { x: 0, y: 0 },
                { x: 1_200, y: 0 }
              ]
            },
            keyframes: [
              { offset: 0, scaleX: -4, pathProgress: 0 },
              { offset: 1, scaleX: -1, pathProgress: 1 }
            ]
          })
        ]
      },
      ['motion-transform-bounds']
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].message).toContain('1200px displacement')
    expect(result.messages[0].message).toContain('4x scale')
  })

  test('aggregates excessive duration, delay, and finite playback', () => {
    const result = lintMotion(
      spec(
        [
          track({
            id: 'slow',
            timing: { durationMs: 12_000, delayMs: 7_000, iterations: 3 }
          })
        ],
        'reduce'
      ),
      ['motion-long-timing']
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].message).toContain('12000ms duration')
    expect(result.messages[0].message).toContain('7000ms delay')
    expect(result.messages[0].message).toContain('43000ms finite playback')
  })

  test('enforces configurable per-node track and keyframe budgets', () => {
    const tracks = Array.from({ length: 5 }, (_, index) =>
      track({
        id: `track-${index}`,
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 0.25, x: 4 },
          { offset: 0.5, x: 8 },
          { offset: 0.75, x: 12 },
          { offset: 1, x: 16 }
        ]
      })
    )
    const result = lintMotion(spec(tracks, 'reduce'), ['motion-complexity-budget'])
    const relaxed = lintMotion(spec(tracks, 'reduce'), ['motion-complexity-budget'], {
      rules: {
        'motion-complexity-budget': {
          severity: 'warning',
          options: { maxTracks: 5, maxKeyframes: 25 }
        }
      }
    })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].message).toContain('5 tracks and 25 keyframes')
    expect(relaxed.messages).toHaveLength(0)
  })

  test('keeps a bounded reduced-motion entrance clean across the complete rule set', () => {
    const result = lintMotion(spec([track()], 'reduce'))
    expect(result.messages).toEqual([])
  })
})
