import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/core'

import { parseFixture, VALID_NODE_TYPES } from '#tests/helpers/fig-fixtures'
import { collectAllNodes } from '#tests/helpers/fig-traversal'
import { heavy } from '#tests/helpers/test-utils'

const HEAVY_FIXTURE_TIMEOUT_MS = 180_000

setDefaultTimeout(HEAVY_FIXTURE_TIMEOUT_MS)

heavy.serial('parse heavy .fig files', () => {
  describe.serial('material3.fig', () => {
    let graph: SceneGraph | undefined
    let nodes: SceneNode[] = []

    beforeAll(
      async () => {
        graph = await parseFixture('material3.fig', { populate: 'none' })
        nodes = collectAllNodes(graph)
      },
      { timeout: HEAVY_FIXTURE_TIMEOUT_MS }
    )

    afterAll(
      () => {
        nodes = []
        graph = undefined
        Bun.gc(true)
      },
      { timeout: HEAVY_FIXTURE_TIMEOUT_MS }
    )

    test('parses with pages and nodes', { timeout: HEAVY_FIXTURE_TIMEOUT_MS }, () => {
      expect(graph).toBeInstanceOf(SceneGraph)
      expect(graph?.getPages().length ?? 0).toBeGreaterThan(0)
      expect(nodes.length).toBeGreaterThan(0)
    })

    test('contains COMPONENT nodes', { timeout: HEAVY_FIXTURE_TIMEOUT_MS }, () => {
      expect(nodes.some((node) => node.type === 'COMPONENT')).toBe(true)
    })

    test('has no unmapped node types', { timeout: HEAVY_FIXTURE_TIMEOUT_MS }, () => {
      const invalid = nodes.filter((node) => !VALID_NODE_TYPES.has(node.type))
      expect(invalid.map((node) => `${node.name}: ${node.type}`)).toEqual([])
    })

    test('has valid fill colors', { timeout: HEAVY_FIXTURE_TIMEOUT_MS }, () => {
      for (const node of nodes) {
        for (const fill of node.fills) {
          if (fill.type === 'SOLID') {
            const { r, g, b, a } = fill.color
            expect(r).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThanOrEqual(1)
            expect(g).toBeGreaterThanOrEqual(0)
            expect(g).toBeLessThanOrEqual(1)
            expect(b).toBeGreaterThanOrEqual(0)
            expect(b).toBeLessThanOrEqual(1)
            expect(a).toBeGreaterThanOrEqual(0)
            expect(a).toBeLessThanOrEqual(1)
          }
        }
      }
    })
  })

  describe.serial('nuxtui.fig', () => {
    let graph: SceneGraph | undefined
    let nodes: SceneNode[] = []

    beforeAll(
      async () => {
        graph = await parseFixture('nuxtui.fig', { populate: 'none' })
        nodes = collectAllNodes(graph)
      },
      { timeout: HEAVY_FIXTURE_TIMEOUT_MS }
    )

    afterAll(
      () => {
        nodes = []
        graph = undefined
        Bun.gc(true)
      },
      { timeout: HEAVY_FIXTURE_TIMEOUT_MS }
    )

    test('parses with pages and nodes', { timeout: HEAVY_FIXTURE_TIMEOUT_MS }, () => {
      expect(graph).toBeInstanceOf(SceneGraph)
      expect(graph?.getPages().length ?? 0).toBeGreaterThan(0)
      expect(nodes.length).toBeGreaterThan(0)
    })

    test('has no unmapped node types', { timeout: HEAVY_FIXTURE_TIMEOUT_MS }, () => {
      const invalid = nodes.filter((node) => !VALID_NODE_TYPES.has(node.type))
      expect(invalid.map((node) => `${node.name}: ${node.type}`)).toEqual([])
    })

    test('has valid fill colors', { timeout: HEAVY_FIXTURE_TIMEOUT_MS }, () => {
      for (const node of nodes) {
        for (const fill of node.fills) {
          if (fill.type === 'SOLID') {
            expect(fill.color.r).toBeGreaterThanOrEqual(0)
            expect(fill.color.r).toBeLessThanOrEqual(1)
          }
        }
      }
    })
  })
})
