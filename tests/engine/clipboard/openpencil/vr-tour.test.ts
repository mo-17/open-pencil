import { describe, expect, test } from 'bun:test'

import { buildOpenPencilClipboardHTML, parseOpenPencilClipboard } from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'
import {
  createVRTourModuleFrameOverrides,
  createVRTourSampleScenes,
  VR_TOUR_SAMPLE_ASSETS
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { SceneNode } from '@open-pencil/scene-graph'

import { captureClipboardSnapshot } from '#core/editor/clipboard/snapshot'

import { expectDefined } from '#tests/helpers/assert'

function sampleGraph() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const scenes = createVRTourSampleScenes('zh-CN')
  const node = graph.createNode(
    'FRAME',
    page.id,
    createVRTourModuleFrameOverrides({ locale: 'zh-CN', scenes })
  )
  // This test exercises only the clipboard carrier; integrity and decoding have
  // separate real-asset tests. Small bytes keep ordinary clipboard tests cheap.
  VR_TOUR_SAMPLE_ASSETS.forEach((sample, index) => {
    graph.images.set(sample.graphImageHash, new Uint8Array([index + 1, 2, 3]))
  })
  graph.images.set('unrelated-image', new Uint8Array([99]))
  return { graph, page, node, scenes }
}

function copy(graph: SceneGraph, node: SceneNode) {
  return expectDefined(
    parseOpenPencilClipboard(buildOpenPencilClipboardHTML([node], graph)),
    'OpenPencil clipboard'
  )
}

describe('VR sample image clipboard carrier', () => {
  test('actual copy retains VR bytes in both session snapshots and cross-process HTML', async () => {
    const { graph, node } = sampleGraph()
    const source = createEditor({ graph })
    source.select([node.id])
    const payload = await source.prepareCopy()
    const snapshot = expectDefined(payload.snapshot, 'snapshot')
    for (const transport of ['snapshot', 'html'] as const) {
      const target = createEditor()
      if (transport === 'snapshot') await target.pasteSnapshot(snapshot)
      else await target.pasteFromHTML(payload.html)
      const pasted = expectDefined(
        target.graph.getNode([...target.state.selectedIds][0]),
        'pasted tour'
      )
      expect(pasted.interactiveProps?.module).toEqual(node.interactiveProps?.module)
      for (const sample of VR_TOUR_SAMPLE_ASSETS) {
        expect(target.graph.images.get(sample.graphImageHash)).toEqual(
          graph.images.get(sample.graphImageHash)
        )
      }
      expect(target.graph.images.has('unrelated-image')).toBe(false)
      target.undo.undo()
      expect(target.graph.getNode(pasted.id)).toBeUndefined()
      target.undo.redo()
      expect(target.graph.getNode(pasted.id)?.interactiveProps?.module).toEqual(
        node.interactiveProps?.module
      )
    }
  })

  test('snapshot captures samples in an instance component dependency', () => {
    const { graph, page, node } = sampleGraph()
    const component = graph.createNode('COMPONENT', page.id)
    graph.reparentNode(node.id, component.id)
    const instance = graph.createNode('INSTANCE', page.id, { componentId: component.id })
    const snapshot = captureClipboardSnapshot(graph, [instance])
    expect(snapshot.componentDependencies).toHaveLength(1)
    expect([...snapshot.images.keys()]).toEqual(
      VR_TOUR_SAMPLE_ASSETS.map((sample) => sample.graphImageHash)
    )
  })

  test('new clipboard snapshots include copied VR sample images and isolate their bytes', () => {
    const { graph, node } = sampleGraph()
    const snapshot = captureClipboardSnapshot(graph, [node])
    expect([...snapshot.images.keys()]).toEqual(
      VR_TOUR_SAMPLE_ASSETS.map((sample) => sample.graphImageHash)
    )
    for (const sample of VR_TOUR_SAMPLE_ASSETS) {
      expect(snapshot.images.get(sample.graphImageHash)).toEqual(
        graph.images.get(sample.graphImageHash)
      )
      expect(snapshot.images.get(sample.graphImageHash)).not.toBe(
        graph.images.get(sample.graphImageHash)
      )
    }
    expect(snapshot.images.has('unrelated-image')).toBe(false)
  })

  test('copies referenced sample bytes alongside static VR scene configuration', () => {
    const { graph, node } = sampleGraph()
    const clipboard = copy(graph, node)
    expect([...clipboard.images.keys()]).toEqual(
      VR_TOUR_SAMPLE_ASSETS.map((sample) => sample.graphImageHash)
    )
    for (const sample of VR_TOUR_SAMPLE_ASSETS) {
      expect(clipboard.images.get(sample.graphImageHash)).toEqual(
        graph.images.get(sample.graphImageHash)
      )
    }
    expect(clipboard.nodes[0].interactiveProps?.module).toEqual(node.interactiveProps?.module)
    expect(clipboard.images.has('unrelated-image')).toBe(false)
  })

  test('collects only referenced samples in selected descendant modules', () => {
    const { graph, page, node, scenes } = sampleGraph()
    scenes[1].panoramaUrl = 'https://example.com/another-panorama.jpg'
    graph.updateNode(node.id, createVRTourModuleFrameOverrides({ scenes }))
    const clipboard = copy(graph, page)
    expect([...clipboard.images.keys()]).toEqual([VR_TOUR_SAMPLE_ASSETS[0].graphImageHash])
  })

  test('does not invent missing image bytes', () => {
    const { graph, node } = sampleGraph()
    graph.images.delete(VR_TOUR_SAMPLE_ASSETS[0].graphImageHash)
    expect([...copy(graph, node).images.keys()]).toEqual([VR_TOUR_SAMPLE_ASSETS[1].graphImageHash])
  })

  test.each(['pluginId', 'moduleType', 'configVersion', 'config', 'nodeType'])(
    'does not attach VR sample bytes for an invalid %s',
    (field) => {
      const { graph, node } = sampleGraph()
      const module = structuredClone(expectDefined(node.interactiveProps?.module, 'VR module'))
      if (field === 'pluginId') module.pluginId = 'example.other'
      if (field === 'moduleType') module.moduleType = 'other'
      if (field === 'configVersion') module.configVersion = 99
      if (field === 'config') module.config.unreviewed = true
      graph.updateNode(node.id, {
        interactiveProps: { module },
        ...(field === 'nodeType' ? { type: 'RECTANGLE' as const } : {})
      })
      expect(copy(graph, node).images.size).toBe(0)
    }
  )
})
