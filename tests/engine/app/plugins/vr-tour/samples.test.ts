import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createEditor } from '@open-pencil/core/editor'
import {
  createLocalizedVRTourConfig,
  createVRTourModuleFrameOverrides,
  resolveVRTourModule,
  VR_TOUR_SAMPLE_ASSETS
} from '@open-pencil/core/plugins'

import { applyVRTourSamples } from '@/app/plugins/vr-tour/samples'

function fixture(locale = 'zh-CN') {
  const editor = createEditor()
  const config = createLocalizedVRTourConfig(locale)
  config.label = '我自己的看房标题'
  const node = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createVRTourModuleFrameOverrides(config)
  )
  const assets = VR_TOUR_SAMPLE_ASSETS.map((asset) => ({
    asset,
    bytes: new Uint8Array(readFileSync(join('packages/demos/vr-tour', asset.fileName)))
  }))
  return { editor, node, assets }
}

describe('VR samples become document-owned assets', () => {
  test('applies the complete sample pack with one atomic undo and preserves the user title', () => {
    const { editor, node, assets } = fixture()
    const unrelated = new Uint8Array([42])
    editor.graph.images.set('existing-image', unrelated)
    applyVRTourSamples(editor, node.id, 'zh-CN', assets)
    const resolved = resolveVRTourModule(editor.graph.getNode(node.id)?.interactiveProps?.module)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('Missing sample module')
    expect(resolved.config.label).toBe('我自己的看房标题')
    expect(resolved.config.locale).toBe('zh-CN')
    expect(resolved.config.scenes.map((scene) => scene.panoramaUrl)).toEqual(
      VR_TOUR_SAMPLE_ASSETS.map((asset) => asset.panoramaUrl)
    )
    expect(editor.graph.images.size).toBe(3)
    editor.undoAction()
    expect([...editor.graph.images.keys()]).toEqual(['existing-image'])
    editor.redoAction()
    expect(editor.graph.images.get('existing-image')).toBe(unrelated)
    for (const { asset, bytes } of assets)
      expect(editor.graph.images.get(asset.graphImageHash)).toBe(bytes)
  })

  test('undo and redo stay in the original document after a dynamic editor proxy switches', () => {
    const { editor, node, assets } = fixture()
    const original = editor.snapshotDocument()
    const other = createEditor()
    other.graph.createNode('RECTANGLE', other.state.currentPageId, { name: 'Other document' })
    other.graph.images.set('other-image', new Uint8Array([91]))
    const otherDocument = other.snapshotDocument()
    let activeEditor = editor
    // The app's active-store proxy resolves each property against the active tab.
    const proxy = new Proxy(editor, {
      get(_target, property) {
        return Reflect.get(activeEditor, property)
      }
    })
    applyVRTourSamples(proxy, node.id, 'zh-CN', assets)
    const applied = editor.snapshotDocument()

    activeEditor = other
    editor.undoAction()
    expect(editor.snapshotDocument()).toEqual(original)
    expect(other.snapshotDocument()).toEqual(otherDocument)
    expect(editor.graph.images.size).toBe(0)

    editor.redoAction()
    expect(editor.snapshotDocument()).toEqual(applied)
    expect(other.snapshotDocument()).toEqual(otherDocument)
    for (const { asset, bytes } of assets)
      expect(editor.graph.images.get(asset.graphImageHash)).toBe(bytes)
  })

  test('a Chinese editor preserves an explicitly English tour interface when applying samples', () => {
    const { editor, node, assets } = fixture('en')
    applyVRTourSamples(editor, node.id, 'zh-CN', assets)
    const resolved = resolveVRTourModule(editor.graph.getNode(node.id)?.interactiveProps?.module)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('Missing sample module')
    expect(resolved.config.locale).toBe('en')
    expect(resolved.config.label).toBe('我自己的看房标题')
    expect(resolved.config.scenes.map((scene) => scene.title)).toEqual([
      'Residential sample A',
      'Residential sample B'
    ])
    expect(resolved.config.scenes[0].hotspots[0].label).toBe('Switch to sample B')
  })

  test('rejects incomplete packs and bound viewers without changing document state', () => {
    const { editor, node, assets } = fixture()
    const original = structuredClone(node.interactiveProps)
    expect(() => applyVRTourSamples(editor, node.id, 'zh-CN', assets.slice(0, 1))).toThrow()
    expect(node.interactiveProps).toEqual(original)
    expect(editor.graph.images.size).toBe(0)
    editor.graph.updateNode(node.id, {
      bindings: { panoramaUrl: { kind: 'expr', expr: 'docState.selected.panorama_url' } }
    })
    expect(() => applyVRTourSamples(editor, node.id, 'zh-CN', assets)).toThrow()
    expect(editor.graph.images.size).toBe(0)
  })
})
