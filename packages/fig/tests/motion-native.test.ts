import { describe, expect, test } from 'bun:test'

import type { MotionSpec, MotionTrack } from '@open-pencil/scene-graph'

import {
  buildFigmaMotionPluginScript,
  createFigmaNativeMotionPlan,
  type FigmaNativeMotionIssue
} from '../src/motion-native'

function createTrack(overrides: Partial<MotionTrack> = {}): MotionTrack {
  return {
    id: 'entrance',
    trigger: 'mount',
    keyframes: [
      { offset: 0, opacity: 0, x: -12 },
      { offset: 1, opacity: 1, x: 0 }
    ],
    ...overrides,
    timing: { durationMs: 400, ...overrides.timing }
  }
}

function createSpec(
  trackOverrides: Partial<MotionTrack> = {},
  specOverrides: Partial<MotionSpec> = {}
): MotionSpec {
  return {
    version: 1,
    tracks: [createTrack(trackOverrides)],
    ...specOverrides
  }
}

function issueCodes(value: unknown): FigmaNativeMotionIssue['code'][] {
  return createFigmaNativeMotionPlan(value).issues.map((issue) => issue.code)
}

describe('@open-pencil/fig native Motion adapter', () => {
  test('converts opacity multipliers against the authored node opacity', () => {
    const plan = createFigmaNativeMotionPlan(
      createSpec({
        keyframes: [
          { offset: 0, opacity: 0.25 },
          { offset: 1, opacity: 1 }
        ]
      }),
      { nodeOpacity: 0.4 }
    )

    expect(plan.supported).toBe(true)
    expect(plan.durationSeconds).toBe(0.4)
    expect(plan.operations).toEqual([
      {
        field: { type: 'PROPERTY', name: 'OPACITY' },
        track: {
          baseValue: { type: 'FLOAT', value: 0.4 },
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT', value: 0.1 } },
            {
              timelinePosition: 0.4,
              value: { type: 'FLOAT', value: 0.4 },
              easing: {
                type: 'CUSTOM_CUBIC_BEZIER',
                easingFunctionCubicBezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }
              }
            }
          ]
        }
      }
    ])
  })

  test('uses stable transform channel order and identity defaults', () => {
    const plan = createFigmaNativeMotionPlan(
      createSpec({
        keyframes: [
          { offset: 0, x: 10, rotate: 45, scaleX: 2 },
          { offset: 1, y: 20, scaleY: 0.5 }
        ]
      })
    )

    expect(plan.operations.map((operation) => operation.field.name)).toEqual([
      'TRANSLATION_X',
      'TRANSLATION_Y',
      'ROTATION',
      'SCALE_X',
      'SCALE_Y'
    ])
    expect(
      plan.operations.map((operation) => ({
        base: operation.track.baseValue.value,
        values: operation.track.keyframes.map((keyframe) => keyframe.value.value)
      }))
    ).toEqual([
      { base: 0, values: [10, 0] },
      { base: 0, values: [0, 20] },
      { base: 0, values: [45, 0] },
      { base: 1, values: [2, 1] },
      { base: 1, values: [1, 0.5] }
    ])
  })

  test('shifts segment easing onto the arriving Figma keyframe and preserves cubic curves', () => {
    const plan = createFigmaNativeMotionPlan(
      createSpec({
        keyframes: [
          {
            offset: 0,
            x: 0,
            easing: { type: 'cubicBezier', x1: 0.12, y1: -0.4, x2: 0.8, y2: 1.3 }
          },
          { offset: 0.5, x: 25, easing: 'ease-in' },
          { offset: 1, x: 50 }
        ],
        timing: { durationMs: 750, easing: 'linear' }
      })
    )

    const keyframes = plan.operations[0]?.track.keyframes
    expect(keyframes).toEqual([
      { timelinePosition: 0, value: { type: 'FLOAT', value: 0 } },
      {
        timelinePosition: 0.375,
        value: { type: 'FLOAT', value: 25 },
        easing: {
          type: 'CUSTOM_CUBIC_BEZIER',
          easingFunctionCubicBezier: { x1: 0.12, y1: -0.4, x2: 0.8, y2: 1.3 }
        }
      },
      {
        timelinePosition: 0.75,
        value: { type: 'FLOAT', value: 50 },
        easing: { type: 'EASE_IN' }
      }
    ])
  })

  test('uses track easing when the departing keyframe has no override', () => {
    const plan = createFigmaNativeMotionPlan(
      createSpec({ timing: { durationMs: 250, easing: 'ease-out' } })
    )

    expect(plan.operations[0]?.track.keyframes[1]?.easing).toEqual({ type: 'EASE_OUT' })
  })

  test('retains non-native policy and preset provenance as plugin-data warnings', () => {
    const plan = createFigmaNativeMotionPlan(
      createSpec(
        {},
        {
          reducedMotion: 'reduce',
          preset: { id: 'fadeIn', version: 1, parameters: {} }
        }
      )
    )

    expect(plan.supported).toBe(true)
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'reduced-motion-plugin-data',
      'preset-provenance-plugin-data'
    ])
  })

  test.each([
    ['trigger', { trigger: 'hover' }],
    ['delay', { timing: { durationMs: 400, delayMs: 25 } }],
    ['iterations', { timing: { durationMs: 400, iterations: 2 } }],
    ['direction', { timing: { durationMs: 400, direction: 'reverse' } }],
    ['fill', { timing: { durationMs: 400, fill: 'forwards' } }],
    ['exit', { exit: 'reset' }]
  ] as const)('rejects unsupported %s semantics without partial operations', (code, overrides) => {
    const plan = createFigmaNativeMotionPlan(createSpec(overrides as Partial<MotionTrack>))

    expect(plan.supported).toBe(false)
    expect(plan.operations).toEqual([])
    expect(plan.issues.map((issue) => issue.code)).toContain(code)
  })

  test('rejects multiple tracks instead of silently choosing one', () => {
    const first = createTrack()
    const second = createTrack({ id: 'second' })
    const plan = createFigmaNativeMotionPlan({ version: 1, tracks: [first, second] })

    expect(plan.supported).toBe(false)
    expect(plan.operations).toEqual([])
    expect(plan.issues).toEqual([
      {
        code: 'track-count',
        message: 'Figma native export currently requires exactly one Motion track'
      }
    ])
  })

  test('returns invalid-motion for malformed or empty track arrays', () => {
    expect(issueCodes(null)).toEqual(['invalid-motion'])
    expect(issueCodes({ version: 1, tracks: [] })).toEqual(['invalid-motion'])
    expect(issueCodes({ version: 1, tracks: [{ id: '__proto__' }] })).toEqual(['invalid-motion'])
  })

  test('rejects a valid track with no Figma-native animated channel', () => {
    const plan = createFigmaNativeMotionPlan(
      createSpec({ keyframes: [{ offset: 0 }, { offset: 1 }] })
    )

    expect(plan.supported).toBe(false)
    expect(plan.operations).toEqual([])
    expect(plan.issues.map((issue) => issue.code)).toEqual(['empty-channels'])
  })

  test('builds a deterministic selection-only script with guarded beta API access', () => {
    const plan = createFigmaNativeMotionPlan(createSpec())
    const first = buildFigmaMotionPluginScript(plan)
    const second = buildFigmaMotionPluginScript(plan)

    expect(first).toBe(second)
    expect(first).toContain('selection.length !== 1')
    expect(first).toContain("typeof node.applyManualKeyframeTrack !== 'function'")
    expect(first).toContain("typeof node.removeManualKeyframeTrack !== 'function'")
    expect(first).toContain("typeof node.setTimelineDuration !== 'function'")
    expect(first).toContain('timeline.duration < 0.4')
    expect(first).not.toContain('figma.getNodeByIdAsync')
    expect(first).not.toContain('setPluginData')
    expect(first).not.toContain('eval(')
  })

  test('replaces slide-up with fade-in without leaving supported tracks or animation styles', () => {
    const slidePlan = createFigmaNativeMotionPlan(
      createSpec({
        keyframes: [
          { offset: 0, opacity: 0, y: 24 },
          { offset: 1, opacity: 1, y: 0 }
        ]
      })
    )
    const fadePlan = createFigmaNativeMotionPlan(
      createSpec({
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ]
      })
    )

    expect(slidePlan.operations.map((operation) => operation.field.name)).toEqual([
      'OPACITY',
      'TRANSLATION_Y'
    ])
    expect(fadePlan.operations.map((operation) => operation.field.name)).toEqual(['OPACITY'])

    const script = buildFigmaMotionPluginScript(fadePlan)
    const cleanupStart = script.indexOf('const supportedFields =')
    const applyStart = script.indexOf('const operations =')
    const cleanup = script.slice(cleanupStart, applyStart)
    expect(cleanup).toContain('"name": "TRANSLATION_Y"')
    expect(cleanup).not.toContain('"name": "WIDTH"')
    expect(cleanup).toContain('node.removeManualKeyframeTrack(field)')
    expect(cleanup).toContain('node.removeAnimationStyle(animationStyle.id)')
    expect(script).toContain("typeof node.removeAnimationStyle !== 'function'")
    expect(script.indexOf('node.removeManualKeyframeTrack(field)')).toBeLessThan(
      script.indexOf('node.applyManualKeyframeTrack(operation.field')
    )
  })

  test('quotes an optional stable node id instead of interpolating executable code', () => {
    const plan = createFigmaNativeMotionPlan(createSpec())
    const nodeId = `123:456'); throw new Error('injected`
    const script = buildFigmaMotionPluginScript(plan, { nodeId })

    expect(script).toContain(`figma.getNodeByIdAsync(${JSON.stringify(nodeId)})`)
    expect(script).not.toContain('figma.currentPage.selection')
  })

  test('does not generate a script for a failed compatibility plan', () => {
    const plan = createFigmaNativeMotionPlan(createSpec({ trigger: 'click' }))
    expect(() => buildFigmaMotionPluginScript(plan)).toThrow(
      'Cannot build a Figma Motion script for an unsupported plan'
    )
  })
})
