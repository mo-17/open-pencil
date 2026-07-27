import { describe, expect, test } from 'bun:test'

import { CORE_TOOLS, EXTENDED_TOOLS } from '@open-pencil/core'
import type { MotionSpec } from '@open-pencil/scene-graph'

import { getTool, setupToolTest } from '#tests/helpers/tools'

const motion: MotionSpec = {
  version: 1,
  tracks: [
    {
      id: 'entrance',
      trigger: 'mount',
      keyframes: [
        { offset: 0, opacity: 0, y: 12 },
        { offset: 1, opacity: 1, y: 0 }
      ],
      timing: { durationMs: 300 }
    }
  ]
}

interface AdapterResult {
  error?: string
  compatibility?: {
    canonical: { motionPresent: boolean; roundTrip: boolean; format: string }
    native: { supported: boolean; rawFigAuthoring: boolean; api: string }
  }
  durationSeconds?: number | null
  operations?: Array<{
    field: { name: string }
    track: { baseValue: { value: number }; keyframes: Array<{ value: { value: number } }> }
  }>
  issues?: Array<{ code: string }>
  script?: string | null
}

describe('get_figma_motion_adapter', () => {
  test('is registered as an extended-only codegen tool', () => {
    expect(EXTENDED_TOOLS.some((tool) => tool.name === 'get_figma_motion_adapter')).toBe(true)
    expect(CORE_TOOLS.some((tool) => tool.name === 'get_figma_motion_adapter')).toBe(false)
  })

  test('returns compatibility, operations, and a selection-based Plugin API script', () => {
    const { figma, graph } = setupToolTest()
    const rectangle = figma.createRectangle()
    graph.updateNode(rectangle.id, { motion, opacity: 0.6 })

    const result = getTool('get_figma_motion_adapter').execute(figma, {
      id: rectangle.id
    }) as AdapterResult

    expect(result.compatibility).toMatchObject({
      canonical: {
        format: 'MotionSpec v1 pluginData',
        motionPresent: true,
        roundTrip: true
      },
      native: {
        api: 'Figma Plugin API Motion Beta (2026-06-23)',
        supported: true,
        rawFigAuthoring: false
      }
    })
    expect(result.durationSeconds).toBe(0.3)
    expect(result.operations?.map((operation) => operation.field.name)).toEqual([
      'OPACITY',
      'TRANSLATION_Y'
    ])
    expect(result.operations?.[0]?.track.baseValue.value).toBe(0.6)
    expect(result.operations?.[0]?.track.keyframes.map((keyframe) => keyframe.value.value)).toEqual(
      [0, 0.6]
    )
    expect(result.script).toContain('figma.currentPage.selection')
    expect(result.script).not.toContain(rectangle.id)
  })

  test('reports unsupported semantics without emitting operations or a script', () => {
    const { figma, graph } = setupToolTest()
    const rectangle = figma.createRectangle()
    graph.updateNode(rectangle.id, {
      motion: {
        ...motion,
        tracks: [{ ...motion.tracks[0], trigger: 'hover' }]
      }
    })

    const result = getTool('get_figma_motion_adapter').execute(figma, {
      id: rectangle.id
    }) as AdapterResult

    expect(result.compatibility?.canonical.roundTrip).toBe(true)
    expect(result.compatibility?.native).toMatchObject({ supported: false, rawFigAuthoring: false })
    expect(result.operations).toEqual([])
    expect(result.issues?.map((issue) => issue.code)).toEqual(['trigger'])
    expect(result.script).toBeNull()
  })

  test('reports an absent MotionSpec and does not claim native compatibility', () => {
    const { figma } = setupToolTest()
    const rectangle = figma.createRectangle()

    const result = getTool('get_figma_motion_adapter').execute(figma, {
      id: rectangle.id
    }) as AdapterResult

    expect(result.compatibility?.canonical).toMatchObject({ motionPresent: false, roundTrip: true })
    expect(result.compatibility?.native.supported).toBe(false)
    expect(result.issues?.map((issue) => issue.code)).toEqual(['invalid-motion'])
    expect(result.script).toBeNull()
  })

  test('returns the standard node-not-found result', () => {
    const { figma } = setupToolTest()
    const result = getTool('get_figma_motion_adapter').execute(figma, {
      id: 'missing'
    }) as AdapterResult

    expect(result).toEqual({ error: 'Node "missing" not found' })
  })
})
