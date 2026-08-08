import { describe, expect, test } from 'bun:test'

import { SceneGraph, createLinter, type MotionSpec } from '@open-pencil/core'

describe('createLinter', () => {
  test('reports default names and empty frames', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Frame 1', width: 100, height: 100 })

    const result = createLinter({ preset: 'recommended' }).lintGraph(graph, [frame.id])
    const ruleIds = result.messages.map((message) => message.ruleId)

    expect(ruleIds).toContain('no-default-names')
    expect(ruleIds).toContain('no-empty-frames')
  })

  test('reports color contrast issues for low-contrast text', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Card',
      width: 200,
      height: 80,
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } }]
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Label',
      width: 80,
      height: 20,
      text: 'Hello',
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0.8, g: 0.8, b: 0.8 } }]
    })

    const result = createLinter({ preset: 'recommended' }).lintGraph(graph, [frame.id])
    expect(result.messages.some((message) => message.ruleId === 'color-contrast')).toBe(true)
  })

  test('bounds graph traversal and issue collection without recursive stack growth', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    let parentId = page.id
    for (let index = 0; index < 2_000; index++) {
      parentId = graph.createNode('FRAME', parentId, {
        name: `Frame ${index + 1}`,
        width: 100,
        height: 100
      }).id
    }

    const result = createLinter({
      preset: 'recommended',
      limits: { maxNodes: 100, maxMessages: 10, maxDepth: 64 }
    }).lintGraph(graph)

    expect(result.truncated).toBe(true)
    expect(result.visitedNodeCount).toBe(65)
    expect(result.messages.length).toBeLessThanOrEqual(10)
  })

  test('rejects invalid resource limits', () => {
    expect(() => createLinter({ limits: { maxNodes: 0 } })).toThrow(
      'Lint limits must be positive integers'
    )
  })

  test('caps per-node payloads before cloning them into the lint graph', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Oversized payload',
      text: 'abcdef',
      fills: Array.from({ length: 6 }, () => ({
        type: 'SOLID' as const,
        visible: true,
        opacity: 1,
        color: { r: 1, g: 1, b: 1 }
      }))
    })
    for (let index = 0; index < 6; index++) {
      graph.createNode('FRAME', frame.id, { name: `Child ${index}` })
    }

    const result = createLinter({
      preset: 'recommended',
      limits: {
        maxChildrenPerNode: 2,
        maxStyleEntriesPerNode: 2,
        maxTextCodePoints: 2
      }
    }).lintGraph(graph, [frame.id])

    expect(result.truncated).toBe(true)
    expect(result.visitedNodeCount).toBe(3)
  })

  test('fails partial instead of cloning malformed unbounded motion payloads', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Untrusted motion' })
    frame.motion = {
      version: 1,
      tracks: Array.from({ length: 1_000 }, () => ({}))
    } as never
    frame.boundVariables = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`binding-${index}`, `variable-${index}`])
    )

    const result = createLinter({
      preset: 'accessibility',
      limits: {
        maxBoundVariablesPerNode: 8,
        maxStructuredPayloadNodes: 64,
        maxStructuredMembersPerContainer: 16
      }
    }).lintGraph(graph, [frame.id])

    expect(result.truncated).toBe(true)
    expect(result.visitedNodeCount).toBe(1)
  })

  test('shares aggregate capture budgets across nodes', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const motion: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'entrance',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0, y: 8 },
            { offset: 1, opacity: 1, y: 0 }
          ],
          timing: { durationMs: 200 }
        }
      ]
    }
    const fills = Array.from({ length: 2 }, () => ({
      type: 'SOLID' as const,
      visible: true,
      opacity: 1,
      color: { r: 1, g: 1, b: 1 }
    }))
    const nodes = ['First', 'Second'].map((name) =>
      graph.createNode('TEXT', page.id, {
        name,
        text: 'abcd',
        fills,
        boundVariables: { one: 'variable-1', two: 'variable-2' },
        motion
      })
    )

    const result = createLinter({
      preset: 'accessibility',
      rules: ['motion-reduced-motion'],
      limits: {
        maxStyleEntriesPerNode: 2,
        maxTotalStyleEntries: 3,
        maxTextCodePoints: 16,
        maxTotalTextCodePoints: 5,
        maxBoundVariablesPerNode: 2,
        maxTotalBoundVariables: 3,
        maxStructuredPayloadNodes: 64,
        maxTotalStructuredPayloadNodes: 28,
        maxStructuredMembersPerContainer: 16
      }
    }).lintGraph(
      graph,
      nodes.map(({ id }) => id)
    )

    expect(result.truncated).toBe(true)
    expect(result.visitedNodeCount).toBe(2)
    expect(result.messages.filter(({ ruleId }) => ruleId === 'motion-reduced-motion')).toHaveLength(
      1
    )
  })
})
