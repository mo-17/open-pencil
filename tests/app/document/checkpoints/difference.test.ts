import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { compareCheckpointGraphs } from '@/app/document/checkpoints/difference'
import { CHECKPOINT_LIMITS } from '@/app/document/checkpoints/types'

function pair() {
  const before = new SceneGraph()
  const after = new SceneGraph()
  after.nodes = structuredClone(before.nodes)
  after.rootId = before.rootId
  return { before, after }
}

describe('structured checkpoint difference', () => {
  test('reports hierarchy, authored properties, assets and metadata without source-cache noise', () => {
    const { before, after } = pair()
    const page = before.getPages()[0]
    const node = before.createNode('TEXT', page.id, { name: 'Title', text: 'Before' })
    after.nodes = structuredClone(before.nodes)
    after.updateNode(node.id, {
      text: 'After',
      pluginData: [{ pluginId: 'open-pencil', key: 'test/checkpoint', value: 'changed' }]
    })
    const samePage = after.getNode(page.id)
    if (samePage) {
      samePage.expanded = !page.expanded
      samePage.source.editedFields = ['name']
    }
    after.images.set('image', new Uint8Array([1]))
    after.documentColorSpace = 'display-p3'
    const result = compareCheckpointGraphs(before, after)
    expect(result.changed).toBe(1)
    expect(result.nodes[0]).toMatchObject({ id: node.id, kind: 'changed' })
    expect(result.nodes[0]?.fields).toContain('text')
    expect(result.nodes[0]?.fields).toContain('pluginData')
    expect(result.assets).toBe(true)
    expect(result.document).toBe(true)
  })

  test('bounds the displayed list while counting every added layer', () => {
    const { before, after } = pair()
    const page = after.getPages()[0]
    for (let i = 0; i < CHECKPOINT_LIMITS.maxDifferences + 1; i++)
      after.createNode('RECTANGLE', page.id)
    const result = compareCheckpointGraphs(before, after)
    expect(result.added).toBe(CHECKPOINT_LIMITS.maxDifferences + 1)
    expect(result.nodes).toHaveLength(CHECKPOINT_LIMITS.maxDifferences)
    expect(result.truncated).toBe(true)
  })
})
