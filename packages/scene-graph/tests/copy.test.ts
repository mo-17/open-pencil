import { describe, test, expect, spyOn } from 'bun:test'

import {
  SceneGraph,
  type Fill,
  type Stroke,
  type Effect,
  type StyleRun,
  type GeometryPath
} from '@open-pencil/scene-graph'
import {
  copyFill,
  copyFills,
  copyStroke,
  copyEffect,
  copyStyleRun,
  copyGeometryPaths,
  scaleGeometryPaths,
  createPaintNodeIdResolver
} from '@open-pencil/scene-graph/copy'
import { createDefaultSourceMetadata } from '@open-pencil/scene-graph/node-defaults'

import { expectDefined } from './helpers/assert'

test.each([100, 1000])('runtime paint remaps do not enumerate the %s-node graph', (count) => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const nodes = Array.from({ length: count }, (_, index) =>
    graph.createNode('RECTANGLE', page, {
      source: { ...createDefaultSourceMetadata(), id: `source-${index}` }
    })
  )
  const first = expectDefined(nodes[0]),
    second = expectDefined(nodes[1])
  const values = spyOn(graph.nodes, 'values')
  try {
    for (let index = 0; index < 10; index++)
      graph.remapClonedNodeReferences(new Map([[first.id, second.id]]), 'instance')
    expect(values).toHaveBeenCalledTimes(0)
    graph.updateNode(second.id, {
      fills: [
        {
          type: 'PATTERN',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          sourceNodeId: first.id
        }
      ]
    })
    graph.remapClonedNodeReferences(new Map([[first.id, second.id]]), 'instance')
    expect(graph.getNode(second.id)?.fills[0]?.sourceNodeId).toBe(second.id)
    expect(values).toHaveBeenCalledTimes(0)
  } finally {
    values.mockRestore()
  }
})

test('native paint aliases build one index per read operation and fresh operations see new identities', () => {
  const graph = new SceneGraph()
  const source = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    source: { ...createDefaultSourceMetadata(), id: 'native-source' }
  })
  const values = spyOn(graph.nodes, 'values')
  try {
    const resolve = createPaintNodeIdResolver(graph.nodes, new Map([[source.id, 'copy']]))
    expect(values).toHaveBeenCalledTimes(0)
    expect(resolve(source.id)).toBe('copy')
    expect(values).toHaveBeenCalledTimes(0)
    for (let index = 0; index < 10; index++) expect(resolve('native-source')).toBe('copy')
    expect(values).toHaveBeenCalledTimes(1)
    graph.updateNode(source.id, { source: { ...source.source, id: 'changed-native-source' } })
    const next = createPaintNodeIdResolver(graph.nodes, new Map([[source.id, 'next-copy']]))
    expect(next('native-source')).toBeUndefined()
    expect(next('changed-native-source')).toBe('next-copy')
    expect(values).toHaveBeenCalledTimes(2)
  } finally {
    values.mockRestore()
  }
})

test('native alias lookup retains runtime precedence and the first source identity', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const first = graph.createNode('RECTANGLE', page, {
    source: { ...createDefaultSourceMetadata(), id: 'duplicate-source' }
  })
  const second = graph.createNode('RECTANGLE', page, {
    source: { ...createDefaultSourceMetadata(), id: 'duplicate-source' }
  })
  const shadow = graph.createNode('RECTANGLE', page)
  graph.createNode('RECTANGLE', page, {
    source: { ...createDefaultSourceMetadata(), id: shadow.id }
  })
  const resolve = createPaintNodeIdResolver(graph.nodes, new Map([[second.id, 'copy']]))
  expect(resolve('duplicate-source')).toBeUndefined()
  expect(resolve(shadow.id)).toBeUndefined()
  const mapped = createPaintNodeIdResolver(graph.nodes, new Map([[first.id, 'first-copy']]))
  expect(mapped('duplicate-source')).toBe('first-copy')
})

test('cloneTree remaps pattern strokes and state strokes without sharing paint geometry', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const root = graph.createNode('FRAME', page)
  const tile = graph.createNode('RECTANGLE', root.id, { name: 'Tile' })
  const stroke: Stroke = {
    type: 'PATTERN',
    sourceNodeId: tile.id,
    color: { r: 1, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true,
    weight: 4,
    align: 'OUTSIDE',
    dashPattern: [4, 2],
    patternSpacing: { x: 2, y: 3 }
  }
  const painted = graph.createNode('RECTANGLE', root.id, {
    name: 'Paint',
    strokes: [stroke],
    stateOverrides: { hover: { strokes: [stroke] } },
    responsiveOverrides: { compact: { strokes: [stroke] } }
  })
  const clone = expectDefined(graph.cloneTree(root.id, page))
  const children = graph.getChildren(clone.id)
  const clonedTile = expectDefined(children.find((node) => node.name === 'Tile'))
  const clonedPaint = expectDefined(children.find((node) => node.name === 'Paint'))
  expect(clonedPaint.strokes).toEqual([{ ...stroke, sourceNodeId: clonedTile.id }])
  expect(clonedPaint.stateOverrides?.hover?.strokes?.[0]?.sourceNodeId).toBe(clonedTile.id)
  expect(clonedPaint.responsiveOverrides?.compact?.strokes?.[0]?.sourceNodeId).toBe(clonedTile.id)
  expect(painted.strokes[0].sourceNodeId).toBe(tile.id)
  expect(clonedPaint.strokes[0].dashPattern).not.toBe(stroke.dashPattern)
  expect(clonedPaint.strokes[0].patternSpacing).not.toBe(stroke.patternSpacing)
  graph.deleteNode(root.id)
  expect(graph.getNode(clonedPaint.strokes[0].sourceNodeId ?? '')).toBe(clonedTile)
})

describe('copy helpers — mutation isolation', () => {
  test('copyFill: mutating copy does not affect original', () => {
    const original: Fill = {
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true
    }
    const copy = copyFill(original)
    copy.color.r = 0
    copy.opacity = 0.5
    expect(original.color.r).toBe(1)
    expect(original.opacity).toBe(1)
  })

  test('copyFill: gradient stops are deep copied', () => {
    const original: Fill = {
      type: 'GRADIENT_LINEAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
      ],
      gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    }
    const copy = copyFill(original)
    expectDefined(copy.gradientStops?.[0], 'copied gradient stop').color.r = 0
    expectDefined(copy.gradientTransform, 'copied gradient transform').m00 = 99
    expect(expectDefined(original.gradientStops?.[0], 'original gradient stop').color.r).toBe(1)
    expect(expectDefined(original.gradientTransform, 'original gradient transform').m00).toBe(1)
  })

  /** A stroke is a paint, so its nested paint data copies as deeply as a fill's does. */
  test('copyStroke: dash pattern and nested paint data are independent', () => {
    const original: Stroke = {
      type: 'GRADIENT_LINEAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: 1,
      opacity: 1,
      visible: true,
      align: 'CENTER',
      dashPattern: [5, 3],
      gradientStops: [{ color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 }],
      gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    }
    const copy = copyStroke(original)
    expectDefined(copy.dashPattern, 'copied dash pattern').push(99)
    copy.color.g = 1
    expectDefined(copy.gradientStops?.[0], 'copied gradient stop').color.r = 0
    expectDefined(copy.gradientTransform, 'copied gradient transform').m00 = 99

    expect(original.dashPattern).toEqual([5, 3])
    expect(original.color.g).toBe(0)
    expect(expectDefined(original.gradientStops?.[0], 'original gradient stop').color.r).toBe(1)
    expect(expectDefined(original.gradientTransform, 'original gradient transform').m00).toBe(1)
  })

  test('copyEffect: offset and color are independent', () => {
    const original: Effect = {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offset: { x: 4, y: 4 },
      radius: 8,
      spread: 0,
      visible: true
    }
    const copy = copyEffect(original)
    copy.offset.x = 100
    copy.color.a = 1
    expect(original.offset.x).toBe(4)
    expect(original.color.a).toBe(0.5)
  })

  test('copyStyleRun: style object is independent', () => {
    const original: StyleRun = {
      start: 0,
      length: 5,
      style: { fontWeight: 700, fontSize: 24 }
    }
    const copy = copyStyleRun(original)
    copy.style.fontWeight = 400
    expect(original.style.fontWeight).toBe(700)
  })

  test('copyGeometryPaths: blobs and path fills are independent', () => {
    const original: GeometryPath[] = [
      {
        windingRule: 'NONZERO',
        commandsBlob: new Uint8Array([1, 2, 3]),
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
      }
    ]
    const copy = copyGeometryPaths(original)
    copy[0].commandsBlob[0] = 99
    if (copy[0].fills?.[0]) copy[0].fills[0].color.r = 0
    expect(original[0].commandsBlob[0]).toBe(1)
    expect(original[0].fills?.[0]?.color.r).toBe(1)
  })

  test('copyGeometryPaths and scaleGeometryPaths keep path-level fills', () => {
    // Resize snapshots use these helpers; dropping fills collapses multi-color
    // vectors to a single node fill (gray blob).
    const orange: Fill = {
      type: 'SOLID',
      color: { r: 1, g: 0.32, b: 0, a: 1 },
      opacity: 1,
      visible: true
    }
    const original: GeometryPath[] = [
      {
        windingRule: 'NONZERO',
        commandsBlob: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0]),
        fills: [orange]
      },
      { windingRule: 'EVENODD', commandsBlob: new Uint8Array([2, 3, 4]) }
    ]

    const copied = copyGeometryPaths(original)
    expect(copied[0]?.fills?.[0]?.color.r).toBeCloseTo(1, 2)
    expect(copied[1]?.fills).toBeUndefined()
    expectDefined(copied[0]?.fills?.[0], 'copied path fill').color.r = 0
    expect(original[0]?.fills?.[0]?.color.r).toBe(1)

    const scaled = scaleGeometryPaths(original, 0.5, 0.5)
    expect(scaled[0]?.fills?.[0]?.color.g).toBeCloseTo(0.32, 2)
    expect(scaled[0]?.commandsBlob).not.toBe(original[0]?.commandsBlob)
  })

  test('copyFills: array independence', () => {
    const originals: Fill[] = [
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
      { type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 0.5, visible: true }
    ]
    const copies = copyFills(originals)
    copies.push({ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true })
    copies[0].color.r = 0
    expect(originals).toHaveLength(2)
    expect(originals[0].color.r).toBe(1)
  })
})
