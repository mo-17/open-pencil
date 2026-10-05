import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { expectDefined } from '#core-tests/helpers/assert'
import { readFixtureBytes, uint8ArrayToArrayBuffer } from '#core-tests/helpers/fig/fixtures'

import { exportFigFile, parseFigFile } from '@open-pencil/core'
import { renderJSX } from '@open-pencil/core/design-jsx'
import { reconcileRenderedLayers, sceneNodeToJSX } from '@open-pencil/design-jsx'
import { SceneGraph, type SceneNode, type Stroke } from '@open-pencil/scene-graph'
import { copyStrokes } from '@open-pencil/scene-graph/copy'

async function reopen(graph: SceneGraph): Promise<SceneGraph> {
  return parseFigFile(uint8ArrayToArrayBuffer(await exportFigFile(graph)))
}

function named(graph: SceneGraph, name: string): SceneNode {
  return expectDefined(
    [...graph.nodes.values()].find((node) => node.name === name),
    name
  )
}

async function editWidth(graph: SceneGraph, node: SceneNode): Promise<void> {
  const code = sceneNodeToJSX(node.id, graph).replace('w={100}', 'w={120}')
  const [rendered] = await renderJSX(graph, code, { parentId: expectDefined(node.parentId) })
  reconcileRenderedLayers(graph, [node.id], [expectDefined(rendered).id])
}

describe('Code edit persistence', () => {
  test.each([false, true])(
    'ancestor reversal retains the authored hierarchy and metadata, replacing root=%s',
    async (replaceRoot) => {
      const graph = new SceneGraph()
      const root = graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Root' })
      const a = graph.createNode('FRAME', root.id, {
        name: 'A',
        pluginData: [{ pluginId: 'foreign', key: 'tokens', value: 'A' }]
      })
      const b = graph.createNode('FRAME', a.id, {
        name: 'B',
        pluginData: [{ pluginId: 'foreign', key: 'tokens', value: 'B' }]
      })
      const removed = graph.createNode('RECTANGLE', a.id, { name: 'Removed' })
      const type = replaceRoot ? 'Group' : 'Frame'
      const [rendered] = await renderJSX(
        graph,
        `<${type} name="Root"><Frame name="B"><Frame name="A"><Rectangle name="Added" /></Frame></Frame></${type}>`
      )
      const { rootIds } = reconcileRenderedLayers(graph, [root.id], [expectDefined(rendered).id])
      const result = expectDefined(graph.getNode(expectDefined(rootIds[0])))
      expect(graph.getChildren(result.id).map((node) => node.id)).toEqual([b.id])
      expect(graph.getChildren(b.id).map((node) => node.id)).toEqual([a.id])
      expect(graph.getChildren(a.id).map((node) => node.name)).toEqual(['Added'])
      expect(a.parentId).toBe(b.id)
      expect(b.parentId).toBe(result.id)
      expect(a.pluginData).toContainEqual({ pluginId: 'foreign', key: 'tokens', value: 'A' })
      expect(b.pluginData).toContainEqual({ pluginId: 'foreign', key: 'tokens', value: 'B' })
      expect(graph.getNode(removed.id)).toBeUndefined()
      const saved = await reopen(graph)
      const savedRoot = named(saved, 'Root'),
        savedA = named(saved, 'A'),
        savedB = named(saved, 'B')
      expect(saved.getChildren(savedRoot.id).map((node) => node.id)).toEqual([savedB.id])
      expect(saved.getChildren(savedB.id).map((node) => node.id)).toEqual([savedA.id])
      expect(savedA.pluginData).toContainEqual({ pluginId: 'foreign', key: 'tokens', value: 'A' })
      expect(savedB.pluginData).toContainEqual({ pluginId: 'foreign', key: 'tokens', value: 'B' })
    }
  )

  test('imported foreign tokens survive a width edit, copy and save/reopen', async () => {
    const graph = new SceneGraph()
    const tokens = { pluginId: 'foreign-plugin', key: 'tokens', value: '{"keep":"me"}' }
    graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      name: 'Metadata',
      width: 100,
      height: 100,
      pluginData: [tokens]
    })
    const imported = await reopen(graph)
    const node = named(imported, 'Metadata')
    const before = structuredClone(node.pluginData)
    expect(before).toContainEqual(tokens)

    await editWidth(imported, node)
    expect(node.width).toBe(120)
    expect(node.pluginData).toEqual(before)
    const copy = expectDefined(imported.cloneTree(node.id, expectDefined(node.parentId)))
    expect(copy.pluginData).toEqual(before)
    expect(copy.pluginData).not.toBe(node.pluginData)
    const saved = named(await reopen(imported), 'Metadata')
    expect(saved.width).toBe(120)
    expect(saved.pluginData).toEqual(before)
  })

  test('a width edit retains unexpressed export/grid metadata and exact unchanged opacity', async () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      width: 100,
      height: 100,
      opacity: 0.333333,
      exportSettings: [{ format: 'png', scale: 2 }],
      layoutGrids: [{ pattern: 'GRID', sectionSize: 8, visible: true }]
    })
    const metadata = structuredClone({
      exportSettings: node.exportSettings,
      layoutGrids: node.layoutGrids
    })
    await editWidth(graph, node)
    expect(node).toMatchObject({ ...metadata, width: 120, opacity: 0.333333 })
  })

  test('removing an authored corner radius still resets it', async () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { cornerRadius: 12 })
    const code = sceneNodeToJSX(node.id, graph).replace(' rounded={12}', '')
    const [rendered] = await renderJSX(graph, code, { parentId: graph.getPages()[0].id })
    reconcileRenderedLayers(graph, [node.id], [expectDefined(rendered).id])
    expect(node.cornerRadius).toBe(0)
  })

  test('changing a layer type retains its foreign plugin data', async () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      pluginData: [{ pluginId: 'foreign', key: 'tokens', value: 'keep' }]
    })
    const [rendered] = await renderJSX(
      graph,
      sceneNodeToJSX(node.id, graph).replace('Rectangle', 'Ellipse')
    )
    const { rootIds } = reconcileRenderedLayers(graph, [node.id], [expectDefined(rendered).id])
    expect(graph.getNode(expectDefined(rootIds[0]))).toMatchObject({
      type: 'ELLIPSE',
      pluginData: node.pluginData
    })
  })

  test('replacing a parent retains unchanged children through reordering and save/reopen', async () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Parent',
      pluginData: [{ pluginId: 'foreign', key: 'tokens', value: 'root' }]
    })
    const child = graph.createNode('RECTANGLE', parent.id, {
      name: 'Child',
      pluginData: [{ pluginId: 'foreign', key: 'tokens', value: 'child' }],
      exportSettings: [{ format: 'png', scale: 2 }]
    })
    const removed = graph.createNode('RECTANGLE', parent.id, {
      name: 'Removed',
      pluginData: [{ pluginId: 'foreign', key: 'tokens', value: 'removed' }]
    })
    const last = graph.createNode('RECTANGLE', parent.id, { name: 'Last' })
    const code = `<Group name="Parent">${sceneNodeToJSX(last.id, graph)}<Rectangle name="Added" />${sceneNodeToJSX(child.id, graph)}</Group>`
    const [rendered] = await renderJSX(graph, code)
    const { rootIds } = reconcileRenderedLayers(graph, [parent.id], [expectDefined(rendered).id])
    const replacement = expectDefined(graph.getNode(expectDefined(rootIds[0])))
    expect(graph.getChildren(replacement.id).map((node) => node.name)).toEqual([
      'Last',
      'Added',
      'Child'
    ])
    expect(named(graph, 'Child')).toMatchObject({
      id: child.id,
      pluginData: child.pluginData,
      exportSettings: child.exportSettings
    })
    expect(named(graph, 'Last').id).toBe(last.id)
    expect(named(graph, 'Added').pluginData).toEqual([])
    expect(graph.getNode(removed.id)).toBeUndefined()
    const saved = await reopen(graph)
    expect(named(saved, 'Parent').pluginData).toContainEqual(parent.pluginData[0])
    expect(named(saved, 'Child').pluginData).toContainEqual(child.pluginData[0])
    expect(named(saved, 'Added').pluginData).not.toContainEqual(removed.pluginData[0])
  })

  test('a uniquely named child moves out of a deleted container without losing metadata', async () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Parent' })
    const oldContainer = graph.createNode('FRAME', parent.id, { name: 'Removed container' })
    const child = graph.createNode('RECTANGLE', oldContainer.id, {
      name: 'Moved child',
      pluginData: [{ pluginId: 'foreign', key: 'tokens', value: 'moved' }]
    })
    const [rendered] = await renderJSX(
      graph,
      `<Group name="Parent"><Frame name="New container">${sceneNodeToJSX(child.id, graph)}</Frame></Group>`
    )
    reconcileRenderedLayers(graph, [parent.id], [expectDefined(rendered).id])
    expect(named(graph, 'Moved child')).toMatchObject({
      id: child.id,
      pluginData: child.pluginData,
      parentId: named(graph, 'New container').id
    })
    expect(graph.getNode(oldContainer.id)).toBeUndefined()
    expect(named(await reopen(graph), 'Moved child').pluginData).toContainEqual(child.pluginData[0])
  })
})

const baseStroke: Stroke = {
  type: 'SOLID',
  color: { r: 1, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
  weight: 4,
  align: 'INSIDE'
}
const image = readFixtureBytes('vectorize/python_logo.png')
const imageHash = createHash('sha1').update(image).digest('hex')
const cases: [string, Stroke][] = [
  [
    'gradient',
    {
      ...baseStroke,
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
      ],
      gradientTransform: { m00: 1, m01: 0, m02: 0.25, m10: 0, m11: 1, m12: 0 },
      dashPattern: [4, 2],
      cap: 'ROUND',
      join: 'BEVEL'
    }
  ],
  [
    'image',
    {
      ...baseStroke,
      type: 'IMAGE',
      imageHash,
      imageScaleMode: 'FIT',
      imageTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    }
  ],
  ['blend mode', { ...baseStroke, blendMode: 'MULTIPLY', opacity: 0.5 }]
]

describe('Code edit stroke paints', () => {
  test.each(cases)('%s survives export, preview and save/reopen', async (_, stroke) => {
    const graph = new SceneGraph()
    graph.images.set(imageHash, image)
    graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      name: 'Paint',
      width: 100,
      height: 100,
      strokes: [stroke]
    })
    const imported = await reopen(graph)
    const node = named(imported, 'Paint')
    const expected = copyStrokes(node.strokes)
    expect(expected[0]?.type).toBe(stroke.type)
    const [projection] = await renderJSX(imported, sceneNodeToJSX(node.id, imported))
    const projected = expectDefined(projection)
    expect(imported.getNode(projected.id)?.strokes).toEqual(expected)
    imported.deleteNode(projected.id)
    await editWidth(imported, node)
    expect(node.strokes).toEqual(expected)
    expect(named(await reopen(imported), 'Paint')).toMatchObject({ width: 120, strokes: expected })
  })
})
